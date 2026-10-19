-- Client-role privileges: nothing new is granted by default, and grants the app does not use go.
-- A security review found that role postgres's default privileges in schema public gave
-- authenticated ALL on every new table (TRUNCATE, TRIGGER and REFERENCES included), on every new
-- sequence, and EXECUTE on every new function. Migrations revoke from public and anon only, so 194
-- definer functions ended up executable by authenticated, and a future table that forgot RLS or a
-- revoke would be open to every signed-in user (decision 0193).
-- - Default privileges for role postgres in public grant nothing to authenticated or anon. Existing
--   objects keep their grants; a new table, sequence or function needs an explicit grant
--   (CONTRIBUTING, Database privileges). supabase_admin's defaults are left alone: postgres cannot change
--   them, and supabase_admin owns nothing in public.
-- - No table or view in public grants TRUNCATE, TRIGGER or REFERENCES to authenticated or anon.
-- - public.forecast_overrides: authenticated keeps SELECT only (its one policy); writes go through
--   definers.
-- - public.companies: authenticated loses DELETE and the companies_delete policy goes. Deleting a
--   company becomes a confirmed action of its own, in a later change.
-- - 11 definer RPCs that neither the app nor flow-mcp calls lose EXECUTE for authenticated (and
--   public and anon). company_pnl is still reached through get_dashboard and get_project_group,
--   which were invoker functions; they become security definer with the same bodies (each checks
--   private.readable_company_id itself, and company_pnl checks it again).
-- - RLS is on, with no policy, for private.jev_run_lease and private.loan_deletions, like every
--   other private table. Neither has a client grant; only definers touch them.
begin;
set local lock_timeout = '5s';

alter default privileges for role postgres in schema public
  revoke all on tables from authenticated, anon;
alter default privileges for role postgres in schema public
  revoke all on sequences from authenticated, anon;
alter default privileges for role postgres in schema public
  revoke all on functions from authenticated, anon;

do $tables$
declare
  rel record;
begin
  for rel in
    select c.oid::regclass as name
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    execute format('revoke truncate, trigger, references on %s from authenticated, anon', rel.name);
  end loop;
end
$tables$;

revoke insert, update, delete on public.forecast_overrides from authenticated, anon;

drop policy companies_delete on public.companies;
revoke delete on public.companies from authenticated, anon;

alter function public.get_dashboard(date, date, text) security definer;
alter function public.get_project_group(uuid, text, date, date) security definer;

revoke all on function public.approve_split_review(uuid) from public, anon, authenticated;
revoke all on function public.clear_loan_split_review(uuid) from public, anon, authenticated;
revoke all on function public.company_pnl(uuid, date, date, text) from public, anon, authenticated;
revoke all on function public.delete_project_group(uuid) from public, anon, authenticated;
revoke all on function public.map_budget_section(bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.project_cash_years(uuid, date) from public, anon, authenticated;
revoke all on function public.project_cash_year_months(uuid, integer, date) from public, anon, authenticated;
revoke all on function public.push_unsubscribe(text) from public, anon, authenticated;
revoke all on function public.request_connector_refresh(public.connector_provider) from public, anon, authenticated;
revoke all on function public.save_split(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.set_supplier_settings(uuid, boolean) from public, anon, authenticated;

alter table private.jev_run_lease enable row level security;
alter table private.loan_deletions enable row level security;

commit;
