-- Settings shows the refresh row busy from server state. A connection is
-- syncing while sync_claimed_at is within the 15-minute claim window that
-- mercury-sync and sumit-sync use, so the busy row survives a reload, a new
-- tab, and reopening the app.
-- syncing is appended as the last view column, so create or replace keeps the
-- view, security_invoker, and its grants. The view is security invoker and
-- authenticated has column grants on connector_connections, so it also gets
-- select on sync_claimed_at. The key columns stay ungranted.
-- sumit_status() is rebuilt from 20261003235959 with readable_company_id(),
-- which 20261004010000 swapped in for viewers.
-- note_connector_failure clears the claim, so a failed run is not shown as
-- syncing for 15 minutes.

begin;

set local lock_timeout = '5s';

grant select (sync_claimed_at) on public.connector_connections to authenticated;

create or replace view public.connector_connection_status
with (security_invoker = true) as
select
  company_id,
  provider,
  (last_error is distinct from 'auth') as connected,
  last_sync_at,
  last_error,
  next_attempt_at,
  import_from,
  account_labels,
  (
    select count(*)::integer
    from public.connector_skips s
    where s.company_id = connector_connections.company_id
      and s.provider = connector_connections.provider
  ) as skip_count,
  (
    sync_claimed_at is not null
    and sync_claimed_at > pg_catalog.now() - interval '15 minutes'
  ) as syncing
from public.connector_connections;

revoke all on public.connector_connection_status from public, anon;
grant select on public.connector_connection_status to authenticated, service_role;

create or replace function public.sumit_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'connected', true,
        'sumit_company_id', nullif(c.settings->>'sumit_company_id', '')::bigint,
        'last_sync_at', c.last_sync_at,
        'last_error', case c.last_error
          when 'auth' then 'sumit_auth'
          when 'rejected' then 'sumit_rejected'
          else c.last_error
        end,
        'next_attempt_at', c.next_attempt_at,
        'syncing', (
          c.sync_claimed_at is not null
          and c.sync_claimed_at > pg_catalog.now() - interval '15 minutes'
        )
      )
      from public.connector_connections c
      where c.provider = 'sumit'
        and c.company_id = private.readable_company_id()
    ),
    jsonb_build_object(
      'connected', false,
      'sumit_company_id', null,
      'last_sync_at', null,
      'last_error', null,
      'next_attempt_at', null,
      'syncing', false
    )
  );
$$;

revoke all on function public.sumit_status() from public, anon;
grant execute on function public.sumit_status() to authenticated, service_role;

create or replace function public.note_connector_failure(
  p_company uuid,
  p_provider public.connector_provider,
  p_code text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  retry timestamptz;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_code is distinct from 'auth'
     and p_code is distinct from 'rejected'
     and p_code is distinct from 'rate_limited'
     and p_code is distinct from 'transient'
     and p_code is distinct from 'sync_sweep_empty'
     and p_code is distinct from 'sync_sweep_suspicious'
     and p_code is distinct from 'sync_page_cap' then
    raise exception 'unknown connector failure';
  end if;
  retry := case
    when p_code in ('transient', 'rate_limited', 'sync_page_cap') then pg_catalog.now() + interval '15 minutes'
    else null
  end;
  update public.connector_connections
  set last_error = p_code,
      next_attempt_at = case when p_code = 'auth' then null else coalesce(retry, next_attempt_at) end,
      sync_claimed_at = null
  where company_id = p_company
    and provider = p_provider;
  if not found then
    raise exception 'connector is not connected';
  end if;
  return retry;
end;
$$;

revoke all on function public.note_connector_failure(uuid, public.connector_provider, text) from public, anon, authenticated;
grant execute on function public.note_connector_failure(uuid, public.connector_provider, text) to service_role;

commit;
