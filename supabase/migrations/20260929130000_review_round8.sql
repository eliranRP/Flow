-- Round 8. A split keeps its category. SUMIT auth stops until reconnect. Rejections increment in one update.

create or replace function public.set_transaction_category(
  p_id uuid,
  p_category_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  direction public.txn_direction;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_shares jsonb;
  cat_kind text;
  undo_id uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select t.direction, t.project_id, t.category_id, t.pnl_role, t.user_assigned
  into direction, prior_project, prior_category, prior_role, prior_assigned
  from public.transactions t
  where t.id = p_id and t.company_id = cid and t.removed_at is null
  for update;
  if direction is null then
    raise exception 'transaction not found';
  end if;
  select c.kind::text into cat_kind
  from public.categories c
  where c.id = p_category_id and c.company_id = cid;
  if cat_kind is null then
    raise exception 'category not found';
  end if;
  if cat_kind is distinct from direction::text then
    raise exception 'category kind must match the direction';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  )), '[]'::jsonb)
  into prior_shares
  from public.allocations a
  where a.transaction_id = p_id;

  update public.transactions
  set category_id = p_category_id,
      user_assigned = true
  where id = p_id and company_id = cid;

  insert into public.reassign_undo (
    company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
    prior_user_assigned, prior_allocations, prior_review_id
  ) values (
    cid, p_id, prior_project, prior_category, prior_role,
    coalesce(prior_assigned, false), prior_shares, null
  )
  returning id into undo_id;
  return undo_id;
end;
$$;

revoke all on function public.set_transaction_category(uuid, uuid) from public, anon;
grant execute on function public.set_transaction_category(uuid, uuid) to authenticated, service_role;

-- One update. Auth clears the clock and does not add an attempt. A rejection adds one attempt and the matching wait.
create or replace function public.note_sumit_rejection(p_company uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempts integer;
  retry timestamptz;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_code = 'sumit_auth' then
    update public.sumit_connections
    set last_error = 'sumit_auth',
        next_attempt_at = null
    where company_id = p_company;
    return jsonb_build_object('code', 'sumit_auth');
  end if;
  if p_code is distinct from 'sumit_rejected' then
    raise exception 'unknown sumit code';
  end if;
  update public.sumit_connections
  set reject_attempts = reject_attempts + 1,
      last_error = 'sumit_rejected',
      next_attempt_at = now() + (
        case least(greatest(reject_attempts + 1, 1), 5)
          when 1 then interval '5 minutes'
          when 2 then interval '15 minutes'
          when 3 then interval '1 hour'
          when 4 then interval '6 hours'
          else interval '24 hours'
        end
      )
  where company_id = p_company
  returning reject_attempts, next_attempt_at into attempts, retry;
  if attempts is null then
    raise exception 'SUMIT is not connected';
  end if;
  return jsonb_build_object('code', 'sumit_rejected', 'attempts', attempts, 'retry_at', retry);
end;
$$;

revoke all on function public.note_sumit_rejection(uuid, text) from public, anon, authenticated;
grant execute on function public.note_sumit_rejection(uuid, text) to service_role;

-- Due rows only, so a page of backed-off companies cannot hide a company that is ready.
create or replace function public.list_due_refresh_requests(p_limit integer)
returns table (id bigint, company_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  return query
  select r.id, r.company_id
  from public.sumit_refresh_requests r
  left join public.sumit_connections c on c.company_id = r.company_id
  where r.claimed_at is null
    and (c.next_attempt_at is null or c.next_attempt_at <= now())
    and c.last_error is distinct from 'sumit_auth'
  order by r.requested_at
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

revoke all on function public.list_due_refresh_requests(integer) from public, anon, authenticated;
grant execute on function public.list_due_refresh_requests(integer) to service_role;

create or replace function public.sumit_status()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'connected', true,
        'sumit_company_id', s.sumit_company_id,
        'last_sync_at', s.last_sync_at,
        'last_error', s.last_error,
        'next_attempt_at', s.next_attempt_at
      )
      from public.sumit_connections s
      where s.company_id = (select private.current_company_id())
    ),
    jsonb_build_object(
      'connected', false,
      'sumit_company_id', null,
      'last_sync_at', null,
      'last_error', null,
      'next_attempt_at', null
    )
  );
$$;

revoke all on function public.sumit_status() from public, anon;
grant execute on function public.sumit_status() to authenticated, service_role;

-- The cron gate matches the drain: skip a company that is waiting, or that must reconnect.
create or replace function private.schedule_drain()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
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

  perform cron.schedule(
    'flow-sumit-drain',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url := coalesce(
          (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'flow_sync_url'
            limit 1
          ),
          'http://kong:8000/functions/v1/sumit-sync'
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
