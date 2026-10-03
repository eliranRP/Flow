-- L1a review. Fill amount_original when amount_gross changes, and read SUMIT
-- status from the base table as security definer.
-- private.filed_today_rows(), list_review, and list_auto_assigned_today stay
-- until MCP 3b (20261003180000) merges.
-- CLI 2.118.0 runs each statement on its own. begin is first and commit is
-- last, so lock_timeout covers the trigger change.

begin;

set local lock_timeout = '5s';

create or replace function private.fill_amount_original()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.amount_original is null
     or (
       tg_op = 'UPDATE'
       and new.amount_gross is distinct from old.amount_gross
       and new.amount_original is not distinct from old.amount_original
     ) then
    new.amount_original := pg_catalog.abs(new.amount_gross);
  end if;
  return new;
end;
$$;

revoke all on function private.fill_amount_original() from public, anon, authenticated;
grant execute on function private.fill_amount_original() to service_role;

drop trigger transactions_fill_amount_original on public.transactions;
create trigger transactions_fill_amount_original
  before insert or update of amount_gross on public.transactions
  for each row execute function private.fill_amount_original();

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
        'next_attempt_at', c.next_attempt_at
      )
      from public.connector_connections c
      where c.provider = 'sumit'
        and c.company_id = private.current_company_id()
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

commit;
