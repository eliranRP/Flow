-- FLOW-978: a company's files go with it, and removed notes and files are kept 7 days (decision 0226).
-- - Deleting a company (public.delete_company) already deletes its transaction_files rows (they
--   cascade from companies). Its objects in the bucket transaction-files stay behind: SQL removes only
--   an object's row in storage.objects, never its bytes, so the bytes are deleted through the Storage
--   API. public.thread_files_to_purge lists the objects nothing points at any more:
--   - every object under a company folder whose company is gone, at once;
--   - an object no transaction_files row names, a day after it was uploaded (the row of a line
--     deleted since, or an upload the app or the sync never recorded; a day keeps an upload in flight).
--   mercury-sync, posted hourly by flow-thread-files-purge with {"kind":"purge-files"}, removes them
--   through the Storage API, which deletes the row and the bytes (supabase/functions/_shared/thread_purge.ts).
-- - Removed notes and files (removed_at) are kept 7 days for undo, then deleted for good by
--   private.expire_removed_thread_items(), nightly at 02:07 UTC (flow-thread-items-expire). A deleted
--   file's object then has no row, so the next purge removes its bytes.
-- - Missing pg_cron skips both jobs; missing pg_net, cron_secret or flow_sync_url skips the purge, with
--   a notice, like flow-push-evening.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- The names of the objects to remove through the Storage API, oldest first, as a JSON array.
-- Service role only (mercury-sync).
create function public.thread_files_to_purge(p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(o.name order by o.created_at, o.name), '[]'::jsonb)
  from (
    select o.name, o.created_at
    from storage.objects o
    where o.bucket_id = 'transaction-files'
      and not exists (select 1 from public.transaction_files f where f.storage_path = o.name)
      and (
        o.created_at < now() - interval '1 day'
        or not exists (select 1 from public.companies c where c.id = private.thread_folder_company(o.name))
      )
    order by o.created_at, o.name
    limit least(greatest(coalesce(p_limit, 0), 0), 1000)
  ) o;
$$;

revoke all on function public.thread_files_to_purge(integer) from public, anon, authenticated;
grant execute on function public.thread_files_to_purge(integer) to service_role;

comment on function public.thread_files_to_purge(integer) is
  'FLOW-978 (decision 0226): transaction-files objects no row names (a day after upload) or whose company is gone. mercury-sync removes them through the Storage API.';

-- Removed notes and files older than 7 days are deleted for good. A removed note's files stay on the
-- line (remove_transaction_note), so their note_id is cleared by its foreign key.
create function private.expire_removed_thread_items()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  files integer;
  notes integer;
begin
  delete from public.transaction_files f where f.removed_at < now() - interval '7 days';
  get diagnostics files = row_count;
  delete from public.transaction_notes n where n.removed_at < now() - interval '7 days';
  get diagnostics notes = row_count;
  return jsonb_build_object('files', files, 'notes', notes);
end;
$$;

revoke all on function private.expire_removed_thread_items() from public, anon, authenticated, service_role;

comment on function private.expire_removed_thread_items() is
  'FLOW-978 (decision 0226): removed notes and files are kept 7 days for undo, then deleted. Nightly (flow-thread-items-expire).';

-- flow-thread-items-expire nightly; flow-thread-files-purge hourly, posting mercury-sync.
create function private.schedule_thread_purge()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
  sync_url text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'flow-thread-items-expire skipped: pg_cron is missing';
    return;
  end if;
  if exists (select 1 from cron.job j where j.jobname = 'flow-thread-items-expire') then
    perform cron.unschedule('flow-thread-items-expire');
  end if;
  if exists (select 1 from cron.job j where j.jobname = 'flow-thread-files-purge') then
    perform cron.unschedule('flow-thread-files-purge');
  end if;

  perform cron.schedule(
    'flow-thread-items-expire',
    '7 2 * * *',
    $cron$ select private.expire_removed_thread_items(); $cron$
  );

  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'flow-thread-files-purge skipped: pg_net is missing';
    return;
  end if;
  begin
    execute $sql$
      select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1
    $sql$ into secret;
    execute $sql$
      select decrypted_secret from vault.decrypted_secrets where name = 'flow_sync_url' limit 1
    $sql$ into sync_url;
  exception
    when undefined_table or invalid_schema_name then
      secret := null;
      sync_url := null;
  end;
  if secret is null or btrim(secret) = '' or sync_url is null or btrim(sync_url) = '' then
    raise notice 'flow-thread-files-purge skipped: cron_secret or flow_sync_url is missing';
    return;
  end if;
  if position('/sumit-sync' in sync_url) = 0 then
    raise notice 'flow-thread-files-purge skipped: flow_sync_url does not end in /sumit-sync';
    return;
  end if;

  perform cron.schedule(
    'flow-thread-files-purge',
    '23 * * * *',
    $cron$
      select net.http_post(
        url := (
          select replace(decrypted_secret, '/sumit-sync', '/mercury-sync')
          from vault.decrypted_secrets
          where name = 'flow_sync_url'
          limit 1
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-flow-cron', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'cron_secret'
            limit 1
          )
        ),
        body := '{"kind":"purge-files"}'::jsonb
      )
      where exists (select 1 from storage.objects o where o.bucket_id = 'transaction-files');
    $cron$
  );
end;
$$;

revoke all on function private.schedule_thread_purge() from public, anon, authenticated;
grant execute on function private.schedule_thread_purge() to service_role;

do $schedule$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform private.schedule_thread_purge();
end
$schedule$;

comment on function public.delete_company(uuid, text) is
  'Decision 0194: the owner deletes the company and all of its data, after typing its name. The user stays. Its files in transaction-files are removed within the hour (FLOW-978, thread_files_to_purge).';

commit;
