-- flow-sumit-drain used to fall back to http://kong:8000/functions/v1/sumit-sync
-- when Vault flow_sync_url was missing. The post-push check now rejects that
-- fallback and a literal cron header. The command reads both values from Vault.

create or replace function private.schedule_drain()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
  sync_url text;
begin
  if to_regclass('cron.job') is not null then
    begin
      perform cron.unschedule('flow-sumit-drain');
    exception
      when others then
        null;
    end;
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'flow-sumit-drain skipped: pg_cron or pg_net is missing';
    return;
  end if;

  begin
    execute $sql$
      select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1
    $sql$ into secret;
  exception
    when undefined_table or invalid_schema_name then
      secret := null;
  end;

  if secret is null or btrim(secret) = '' then
    raise notice 'flow-sumit-drain skipped: cron_secret is missing';
    return;
  end if;

  begin
    execute $sql$
      select decrypted_secret from vault.decrypted_secrets where name = 'flow_sync_url' limit 1
    $sql$ into sync_url;
  exception
    when undefined_table or invalid_schema_name then
      sync_url := null;
  end;

  if sync_url is null or btrim(sync_url) = '' then
    raise notice 'flow-sumit-drain skipped: flow_sync_url is missing';
    return;
  end if;

  perform cron.schedule(
    'flow-sumit-drain',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url := (
          select decrypted_secret
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
        body := '{}'::jsonb
      )
      where exists (
        select 1
        from public.sumit_refresh_requests r
        left join public.sumit_connections c on c.company_id = r.company_id
        where r.claimed_at is null
          and (c.next_attempt_at is null or c.next_attempt_at <= now())
          and c.last_error is distinct from 'sumit_auth'
      );
    $cron$
  );
exception
  when undefined_table or undefined_function then
    raise notice 'flow-sumit-drain skipped: %', sqlerrm;
end;
$$;

revoke all on function private.schedule_drain() from public, anon, authenticated;
grant execute on function private.schedule_drain() to service_role;

select private.schedule_drain();
