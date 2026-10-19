-- Client-role privilege guards (decision 0193). Every public table has RLS; no client role holds
-- TRUNCATE, TRIGGER or REFERENCES; anon executes nothing in public; role postgres's default
-- privileges in public grant nothing to authenticated or anon; and every SECURITY DEFINER function
-- in public that authenticated can execute is on the list below. A new client RPC is added to the
-- list in the same change that grants it; a revoked or dropped one leaves it. Invented data only.

begin;

set local search_path = public, extensions;

select plan(16);

create temp table pg_allowed (sig text primary key);
insert into pg_allowed (sig) values
    ('accept_invite(uuid)'),
    ('answer_push_prompt(boolean)'),
    ('answer_recurring_match(txn_direction,uuid,uuid,boolean)'),
    ('apply_starter_categories(text)'),
    ('approve_review_item(uuid,uuid,uuid,boolean,uuid,uuid,boolean)'),
    ('approve_split_review(uuid,uuid)'),
    ('attach_line_document(uuid,jsonb)'),
    ('cancel_invite(uuid)'),
    ('cash_month_lines(date,text,text,integer,integer)'),
    ('cash_month_to_day(date,integer)'),
    ('cash_months(integer,date)'),
    ('cash_year_months(integer,date)'),
    ('cash_years(date)'),
    ('clear_loan_split(uuid)'),
    ('collapse_split(uuid,uuid)'),
    ('company_pnl_basis()'),
    ('create_category(text,text,uuid)'),
    ('create_category(text,text)'),
    ('create_company(text,boolean)'),
    ('create_manual_entry(text,text,bigint,date,text,uuid,uuid,boolean)'),
    ('create_manual_line(text,bigint,date,text,uuid,uuid,text,text)'),
    ('decline_invite(uuid)'),
    ('delete_category(uuid)'),
    ('delete_loan(uuid)'),
    ('delete_project(uuid)'),
    ('delete_transaction(uuid)'),
    ('detach_line_document(uuid,text)'),
    ('disconnect_connector(connector_provider)'),
    ('disconnect_sumit()'),
    ('dismiss_invoice_match(uuid,uuid)'),
    ('dismiss_recurring_alert(text,text)'),
    ('expected_months(integer,uuid,date)'),
    ('forecast_overrides_for(text)'),
    ('get_breakdown_lines(text,text,text,text,date,date,text,boolean,integer,integer)'),
    ('get_breakdown(text,date,date,text,text)'),
    ('get_dashboard(date,date,text)'),
    ('get_notification_prefs()'),
    ('get_project_group(uuid,text,date,date)'),
    ('get_setup_suggestions(date)'),
    ('invite_member(text,text)'),
    ('jev_key_status()'),
    ('jev_suggestions(uuid[])'),
    ('link_invoice_payment(uuid,uuid)'),
    ('list_my_companies()'),
    ('list_team()'),
    ('mark_invite_seen(uuid)'),
    ('match_lines(jsonb,integer,text,text)'),
    ('mcp_add_loan(text,text,bigint,integer,integer,date,bigint,bigint,text,uuid,text,integer,integer)'),
    ('mcp_answer_recurring_match(text,text,uuid,uuid,boolean)'),
    ('mcp_assign_expense_split(text,uuid,jsonb,uuid)'),
    ('mcp_assign_expense(text,uuid,uuid,uuid,boolean)'),
    ('mcp_assign_expenses(text,jsonb)'),
    ('mcp_attach_document(text,uuid,jsonb)'),
    ('mcp_attach_loan_payment(text,uuid,uuid,jsonb)'),
    ('mcp_create_categories(text,jsonb)'),
    ('mcp_create_category(text,text,text,uuid)'),
    ('mcp_create_category(text,text,text)'),
    ('mcp_create_manual_entry(text,text,bigint,date,text,uuid,uuid,text,text)'),
    ('mcp_create_project_group(text,text)'),
    ('mcp_create_project(text,text,text,text,bigint)'),
    ('mcp_create_projects(text,jsonb)'),
    ('mcp_delete_category(text,uuid)'),
    ('mcp_delete_loan(text,uuid)'),
    ('mcp_delete_project(text,uuid)'),
    ('mcp_detach_loan_payment(text,uuid)'),
    ('mcp_dismiss_invoice_match(text,uuid,uuid)'),
    ('mcp_hide_category(text,uuid)'),
    ('mcp_invite_member(text,text,text)'),
    ('mcp_jev_accuracy(date,date)'),
    ('mcp_jev_status()'),
    ('mcp_jev_suggestions()'),
    ('mcp_link_invoice_payment(text,uuid,uuid)'),
    ('mcp_move_category_lines(text,uuid,uuid)'),
    ('mcp_remove_member(text,uuid)'),
    ('mcp_remove_project_forecast_row(text,uuid,text,text)'),
    ('mcp_rename_category(text,uuid,text)'),
    ('mcp_rename_company(text,text)'),
    ('mcp_reorder_loans(text,uuid[])'),
    ('mcp_reset_forecast(text,text)'),
    ('mcp_reset_project_forecast(text,uuid,text)'),
    ('mcp_restore_project_forecast_row(text,uuid,text,text)'),
    ('mcp_review_anomalies()'),
    ('mcp_set_cash_basis(text,text)'),
    ('mcp_set_category_cash(text,uuid,boolean)'),
    ('mcp_set_category_group(text,uuid,text)'),
    ('mcp_set_category_parent(text,uuid,uuid)'),
    ('mcp_set_category_pnl(text,uuid,boolean)'),
    ('mcp_set_category_rehab(text,uuid,boolean)'),
    ('mcp_set_company_currency(text,text)'),
    ('mcp_set_expense_category(text,uuid,uuid)'),
    ('mcp_set_forecast_item(text,text,text,jsonb)'),
    ('mcp_set_index_rate(text,text,date,integer)'),
    ('mcp_set_invoice_paid(text,uuid,boolean)'),
    ('mcp_set_jev_mode(text,boolean,text,numeric)'),
    ('mcp_set_line_cash(text,uuid,boolean)'),
    ('mcp_set_line_pace(text,uuid,text,uuid)'),
    ('mcp_set_line_pnl(text,uuid,boolean)'),
    ('mcp_set_line_recurring(text,uuid,boolean,uuid)'),
    ('mcp_set_line_usual_amount(text,uuid,bigint,uuid)'),
    ('mcp_set_lines_cash(text,jsonb)'),
    ('mcp_set_lines_pnl(text,jsonb)'),
    ('mcp_set_loan_index(text,uuid,text,integer)'),
    ('mcp_set_loan_rate(text,uuid,date,integer)'),
    ('mcp_set_member_role(text,uuid,text)'),
    ('mcp_set_overhead_project(text,uuid)'),
    ('mcp_set_project_forecast_edit(text,uuid,text,jsonb)'),
    ('mcp_set_project_group(text,uuid,uuid)'),
    ('mcp_set_project_investment(text,uuid,jsonb)'),
    ('mcp_split_line(text,uuid,jsonb)'),
    ('mcp_sync_bank_begin(text)'),
    ('mcp_sync_bank_finish(uuid,jsonb)'),
    ('mcp_sync_status(uuid)'),
    ('mcp_undo_batch(text,text)'),
    ('mcp_undo_jev_prefill(text,uuid)'),
    ('mcp_undo(text,text,uuid)'),
    ('mcp_update_loan(text,uuid,jsonb)'),
    ('mcp_update_project(text,uuid,jsonb)'),
    ('merge_category(uuid,uuid)'),
    ('missing_bills(date)'),
    ('move_category_lines(uuid,uuid)'),
    ('my_invites()'),
    ('party_charges(uuid,date)'),
    ('payment_recurring(uuid,date)'),
    ('project_cash_month_lines(uuid,date,text,text,integer,integer)'),
    ('project_cash_months(uuid,integer,date)'),
    ('project_forecast_edits_for(uuid,text)'),
    ('project_recurring_changes(uuid,date)'),
    ('projects_cash_month(date,date,uuid)'),
    ('push_subscribe(text,text,text,text)'),
    ('reassign_transaction(uuid,uuid,uuid)'),
    ('receipt_match(bigint,date,text)'),
    ('recurring_changes(date)'),
    ('recurring_party_line(text,uuid,text,date,uuid)'),
    ('recurring_schedule(date)'),
    ('recurring_this_month(date)'),
    ('remove_member(uuid)'),
    ('remove_project_forecast_row(uuid,text,text)'),
    ('rename_category(uuid,text)'),
    ('rename_company(uuid,text)'),
    ('reopen_invite(uuid)'),
    ('reopen_review(uuid)'),
    ('reorder_loans(uuid[])'),
    ('reset_forecast_month(text)'),
    ('reset_project_forecast(uuid,text)'),
    ('resolve_review(uuid,text,uuid,uuid,boolean,boolean)'),
    ('restore_category(uuid)'),
    ('restore_loan(uuid)'),
    ('restore_project_forecast_row(uuid,text,text)'),
    ('review_anomalies(uuid[])'),
    ('save_line_split(uuid,jsonb,boolean)'),
    ('save_loan_split(uuid,uuid,jsonb,boolean)'),
    ('set_after_overhead(boolean,uuid)'),
    ('set_cash_basis(text)'),
    ('set_category_cash(uuid,boolean)'),
    ('set_category_excluded_from_pnl(uuid,boolean)'),
    ('set_category_group(uuid,text)'),
    ('set_category_hidden(uuid,boolean)'),
    ('set_category_parent(uuid,uuid)'),
    ('set_category_rehab(uuid,boolean)'),
    ('set_company_currency(text)'),
    ('set_company_integration(boolean,text,numeric,text)'),
    ('set_forecast_item(text,text,jsonb)'),
    ('set_import_from(connector_provider,date)'),
    ('set_invoice_paid(uuid,boolean)'),
    ('set_member_role(uuid,text)'),
    ('set_notification_prefs(boolean,boolean,boolean)'),
    ('set_overhead_project(uuid)'),
    ('set_payment_amount(uuid,bigint,uuid)'),
    ('set_payment_pace(uuid,text,uuid)'),
    ('set_payment_recurring(uuid,boolean,uuid)'),
    ('set_project_forecast_edit(uuid,text,jsonb)'),
    ('set_project_group(uuid,uuid)'),
    ('set_project_investment(uuid,jsonb)'),
    ('set_transaction_cash(uuid,boolean)'),
    ('set_transaction_category(uuid,uuid,boolean)'),
    ('set_transaction_pnl(uuid,boolean)'),
    ('sumit_status()'),
    ('switch_company(uuid)'),
    ('undismiss_recurring_alert(text,text)'),
    ('undo_category_move(uuid)'),
    ('undo_jev_prefill(uuid)'),
    ('undo_project_forecast(uuid,jsonb)'),
    ('undo_reassign(uuid)'),
    ('upsert_project_group(uuid,text)'),
    ('upsert_project(uuid,text,bigint,text,text)');

create temp view pg_client_definers as
select p.oid::regprocedure::text as sig
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.prosecdef
  and has_function_privilege('authenticated', p.oid, 'execute');

-- RLS and table privileges.
select is(
  (select coalesce(array_agg(tablename::text order by tablename), '{}') from pg_tables
   where schemaname = 'public' and not rowsecurity),
  '{}'::text[],
  'every table in public has RLS enabled'
);
select is(
  (select coalesce(array_agg(tablename::text order by tablename), '{}') from pg_tables
   where schemaname = 'private' and not rowsecurity),
  '{}'::text[],
  'every table in private has RLS enabled'
);
select is(
  (select coalesce(array_agg(c.relname || ':' || r.role || ':' || pr.priv order by 1), '{}')
   from pg_class c
   cross join (values ('authenticated'), ('anon')) r(role)
   cross join (values ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')) pr(priv)
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_table_privilege(r.role, c.oid, pr.priv)),
  '{}'::text[],
  'no table or view in public grants TRUNCATE, TRIGGER or REFERENCES to authenticated or anon'
);
select is(
  (select coalesce(array_agg(privilege_type::text order by privilege_type), '{}')
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'forecast_overrides' and grantee in ('authenticated', 'anon')),
  array['SELECT'],
  'forecast_overrides: client roles may only read; writes go through definers'
);
select is(
  (select coalesce(array_agg(c.relname::text || ':' || r.role order by 1), '{}')
   from pg_class c
   cross join (values ('authenticated'), ('anon')) r(role)
   where c.oid in ('private.jev_run_lease'::regclass, 'private.loan_deletions'::regclass)
     and (has_table_privilege(r.role, c.oid, 'SELECT') or has_table_privilege(r.role, c.oid, 'INSERT')
       or has_table_privilege(r.role, c.oid, 'UPDATE') or has_table_privilege(r.role, c.oid, 'DELETE'))),
  '{}'::text[],
  'jev_run_lease and loan_deletions grant nothing to client roles'
);

-- Functions.
select is(
  (select count(*)::integer from pg_proc p
   where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')),
  0,
  'anon has no EXECUTE on any function in public'
);
select is(
  (select coalesce(array_agg(d.sig order by d.sig), '{}') from pg_client_definers d
   where d.sig not in (select sig from pg_allowed)),
  '{}'::text[],
  'every definer in public that authenticated can execute is on the allowlist'
);
select is(
  (select coalesce(array_agg(a.sig order by a.sig), '{}') from pg_allowed a
   where a.sig not in (select sig from pg_client_definers)),
  '{}'::text[],
  'every allowlisted definer exists and authenticated can execute it'
);
select is(
  (select coalesce(array_agg(f.sig order by f.sig), '{}')
   from (values
     ('public.approve_split_review(uuid)'),
     ('public.clear_loan_split_review(uuid)'),
     ('public.company_pnl(uuid, date, date, text)'),
     ('public.delete_project_group(uuid)'),
     ('public.map_budget_section(bigint, uuid, text)'),
     ('public.project_cash_years(uuid, date)'),
     ('public.project_cash_year_months(uuid, integer, date)'),
     ('public.push_unsubscribe(text)'),
     ('public.request_connector_refresh(public.connector_provider)'),
     ('public.save_split(uuid, jsonb)'),
     ('public.set_supplier_settings(uuid, boolean)')
   ) f(sig)
   where has_function_privilege('authenticated', f.sig::regprocedure, 'execute')
      or has_function_privilege('anon', f.sig::regprocedure, 'execute')),
  '{}'::text[],
  'the 11 RPCs the clients do not call are not executable by authenticated or anon'
);
select ok(
  has_function_privilege('authenticated', 'public.approve_split_review(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.get_dashboard(date, date, text)', 'execute')
  and has_function_privilege('authenticated', 'public.get_project_group(uuid, text, date, date)', 'execute'),
  'the RPCs the app calls in their place stay executable'
);

-- Default privileges: role postgres creates every object in public.
select is(
  (select coalesce(array_agg(a.defaclobjtype::text || ':' || g.grantee::regrole::text order by 1), '{}')
   from pg_default_acl a
   cross join lateral aclexplode(a.defaclacl) g
   where a.defaclrole = 'postgres'::regrole
     and a.defaclnamespace = 'public'::regnamespace
     and g.grantee in ('authenticated'::regrole, 'anon'::regrole)),
  '{}'::text[],
  'role postgres''s default privileges in public grant nothing to authenticated or anon'
);
select is(
  (select count(*)::integer from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relowner <> 'postgres'::regrole)
  + (select count(*)::integer from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proowner <> 'postgres'::regrole),
  0,
  'postgres owns every relation and function in public, so only its default privileges apply'
);

-- Deleting a company is not a REST write.
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public' and tablename = 'companies' and cmd = 'DELETE'),
  0,
  'companies has no delete policy'
);

do $users$
begin
  perform tests.create_supabase_user('pg_guard_owner', 'pg-guard-owner@example.com');
  perform tests.fixture_company('pg_guard_owner', 'Guard Example Co');
end
$users$;

select tests.authenticate_as('pg_guard_owner');
select is((select count(*)::integer from public.companies), 1, 'the owner reads their company');
select throws_ok(
  $$delete from public.companies$$,
  '42501',
  null,
  'the owner cannot delete their company through REST'
);
reset role;
select is(
  (select count(*)::integer from public.companies where name = 'Guard Example Co'),
  1,
  'the company is still there'
);

select * from finish();
rollback;
