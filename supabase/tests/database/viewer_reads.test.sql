-- FLOW-507 / FLOW-315. A demo viewer reads the review queue, the skipped list, a transaction and
-- its bank details, the categories and search; the audit log stays the owner's. A guard fails
-- when a later redefinition scopes a viewer-facing read to the owner again.
-- Invented data only.

begin;

select plan(22);

do $users$
begin
  perform tests.create_supabase_user('vr_owner');
  perform tests.create_supabase_user('vr_viewer');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('vr_owner'), 'Viewer Reads Demo', true);

create temp table vr (label text primary key, id uuid);
grant all on vr to authenticated, service_role;
insert into vr (label, id) select 'co', id from public.companies where name = 'Viewer Reads Demo';

insert into public.categories (company_id, name, kind, sort_order, is_default)
values ((select id from vr where label = 'co'), 'Viewer Supplies', 'expense', 90, false);
insert into public.projects (company_id, name, status)
values ((select id from vr where label = 'co'), 'Viewer Site', 'active');
insert into vr (label, id) select 'project', id from public.projects where name = 'Viewer Site';
insert into vr (label, id) select 'supplies', id from public.categories where name = 'Viewer Supplies';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, source, line_status, idempotency_key, description
)
values
  ((select id from vr where label = 'co'), 'expense', 'expense', 'project',
   -1000, -1000, 1000, 0, 'unknown', current_date, 'manual', 'posted', 'vr:open', 'Viewer open line'),
  ((select id from vr where label = 'co'), 'expense', 'expense', 'project',
   -2000, -2000, 2000, 0, 'unknown', current_date, 'manual', 'posted', 'vr:skipped', 'Viewer skipped line');
-- A filed project line (FLOW-507 follow-up: the viewer's project page).
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, project_id, category_id,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, source, line_status, idempotency_key, description
)
values ((select id from vr where label = 'co'), 'expense', 'expense', 'project',
  (select id from vr where label = 'project'), (select id from vr where label = 'supplies'),
  -3000, -3000, 3000, 0, 'unknown', current_date, 'manual', 'posted', 'vr:filed', 'Viewer filed line');
insert into vr (label, id) select replace(idempotency_key, 'vr:', 'txn_'), id
from public.transactions where idempotency_key like 'vr:%';

insert into public.review_queue (company_id, transaction_id, status, reason, resolved_at)
values
  ((select id from vr where label = 'co'), (select id from vr where label = 'txn_open'), 'open', 'missing_project', null),
  ((select id from vr where label = 'co'), (select id from vr where label = 'txn_skipped'), 'skipped', 'missing_project', now());

insert into public.audit_log (company_id, actor_id, action, entity, entity_id)
select (select id from vr where label = 'co'), tests.get_supabase_uid('vr_owner'), 'test', 'transactions',
  (select id from vr where label = 'txn_open');

insert into public.company_viewers (user_id, company_id)
values (tests.get_supabase_uid('vr_viewer'), (select id from vr where label = 'co'));

select tests.authenticate_as('vr_viewer');

select is(jsonb_array_length(public.list_review()), 1, 'the viewer reads the review queue');
select is(jsonb_array_length(public.list_skipped_review()), 1, 'and the skipped list');
select isnt(public.get_transaction((select id from vr where label = 'txn_open')), null, 'and a transaction');
select is(
  jsonb_array_length(public.get_line_meta(array[(select id from vr where label = 'txn_open')])), 1,
  'and its bank details');
select ok(
  public.list_categories()::text like '%Viewer Supplies%',
  'and the categories');
select is((select count(*)::integer from public.audit_log), 0, 'the audit log stays the owner''s');
select is(public.get_project((select id from vr where label = 'project'))->>'name', 'Viewer Site',
  'and a project page');
select ok(
  public.get_project((select id from vr where label = 'project'))::text like '%Viewer Supplies%',
  'with its categories');
select is(
  jsonb_array_length(public.list_project_category(
    (select id from vr where label = 'project'), (select id from vr where label = 'supplies'))->'rows'),
  1, 'and the category drill-down');
select throws_ok(
  format('select public.reopen_review(%L::uuid)',
    (select id from public.review_queue where transaction_id = (select id from vr where label = 'txn_skipped'))),
  null, null, 'a viewer still cannot write');

select tests.authenticate_as('vr_owner');
select is(jsonb_array_length(public.list_review()), 1, 'the owner reads the review queue as before');
select is(public.get_project((select id from vr where label = 'project'))->>'name', 'Viewer Site',
  'and the project page');
select is((select count(*)::integer from public.audit_log), 1, 'and the audit log');

reset role;
-- FLOW-315: a stored card_last4 that isn't 4 digits is dropped on read.
update public.transactions set provider_meta = '{"card_last4": "12a4", "memo": "card 4111 1111 1111 1234"}'::jsonb
where id = (select id from vr where label = 'txn_open');
select tests.authenticate_as('vr_owner');
select is(
  public.get_line_meta(array[(select id from vr where label = 'txn_open')]) -> 0 ->> 'card_last4',
  null,
  'a card_last4 that is not 4 digits is not shown');
select is(
  public.get_line_meta(array[(select id from vr where label = 'txn_open')]) -> 0 ->> 'memo',
  'card ••1234',
  'a spaced card number in a memo is masked to its last 4');
reset role;
select is(
  private.mask_long_digits('acct 123-456-789-0123, ref 1234567, date 2026-10-08, phone 555-0100'),
  'acct ••0123, ref ••4567, date 2026-10-08, phone 555-0100',
  'long numbers keep their last 4; a date and a phone number stay');
select is(
  private.mask_long_digits('from 2026-10-08 2026-10-09'),
  'from 2026-10-08 2026-10-09',
  'a date range stays');

-- Guard: a read the app calls must scope to the readable company, or a viewer sees nothing.
-- mcp_* reads run on an owner's MCP token and stay owner-only.
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.provolatile = 's'
     and p.proname not like 'mcp\_%'
     and p.prosrc like '%current_company_id()%'
     and p.prosrc not like '%readable_company_id()%'),
  '{}'::text[],
  'no viewer-facing read is scoped to the owner only');
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.provolatile = 's'
     and p.proname not like 'mcp\_%'
     and p.prosrc like '%owner_id = (select auth.uid())%'),
  '{}'::text[],
  'no viewer-facing read finds the company by its owner');
-- The private read helpers those reads call. Excluded: the two company lookups themselves,
-- MCP-only helpers (mcp_*) and the owner's SUMIT connection rows.
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.prokind = 'f' and p.provolatile = 's'
     and p.proname not in ('current_company_id', 'readable_company_id', 'sumit_connection_rows')
     and p.proname not like 'mcp\_%'
     and p.prosrc like '%current_company_id()%'
     and p.prosrc not like '%readable_company_id()%'),
  '{}'::text[],
  'no private read helper is scoped to the owner only');
select is(
  (select qual from pg_policies where tablename = 'audit_log' and policyname = 'audit_log_select'),
  '(company_id = ( SELECT private.current_company_id() AS current_company_id))',
  'the audit log policy names the owner');

select is(
  (select confdeltype::text from pg_constraint where conname = 'mcp_batches_token_id_fkey'
   and conrelid = 'private.mcp_batches'::regclass),
  'c', 'MCP batch rows are deleted with their token (FLOW-205)');

select * from finish();
rollback;
