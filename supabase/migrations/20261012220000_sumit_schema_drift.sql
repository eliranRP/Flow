-- FLOW-510: the SUMIT sync's schema-drift check. When more than 1 in 20 of the CRM rows the sync
-- should read cannot be mapped (a field SUMIT renamed or retyped), or a page comes back without
-- its data or row list, sumit-sync stops before it writes, so the full sweep does not void the
-- documents those rows stand for. Below that share broken rows are dropped as before.
-- note_sync_failure records sync_schema_drift (Settings reads it from sumit_status) and holds the
-- next try 15 minutes, as for sync_failed and sync_page_cap.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function public.note_sync_failure(p_company uuid, p_code text)
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
  if p_code is distinct from 'sync_failed'
     and p_code is distinct from 'sync_page_cap'
     and p_code is distinct from 'sync_schema_drift' then
    raise exception 'unknown sync failure';
  end if;
  retry := now() + interval '15 minutes';
  update public.sumit_connections
  set last_error = p_code,
      next_attempt_at = retry
  where company_id = p_company;
  if not found then
    raise exception 'SUMIT is not connected';
  end if;
  return retry;
end;
$$;
revoke all on function public.note_sync_failure(uuid, text) from public, anon, authenticated;
grant execute on function public.note_sync_failure(uuid, text) to service_role;

commit;
