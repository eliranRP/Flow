-- FLOW-946. Gross-up split parts (decision 0206). A line's split by category can carry an
-- opposite-sign "gross-up" part: a real item of its category's kind that nets against the line
-- (a deposit minus a closing cost paid at closing, a payment plus a credit). It is NOT the
-- existing reversal/refund (an opposite-kind part with the same money sign). The signed sum of
-- the parts (a gross_up part negated) equals the line, and private.pnl_lines emits a gross_up
-- part with its category's sign, the opposite of a refund. Invented books only. USD amounts are
-- cents, ILS amounts are agorot.

begin;

select plan(37);

do $users$
begin
  perform tests.create_supabase_user('gru_owner', 'gru-owner@example.com');
  perform tests.create_supabase_user('gru_other', 'gru-other@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('gru_owner'), 'Example Gross LLC', false),
  (tests.get_supabase_uid('gru_other'), 'Example Rival LLC', false);

create temp table gru (label text primary key, id uuid);
grant all on gru to authenticated, service_role;
insert into gru (label, id) select 'co', id from public.companies where name = 'Example Gross LLC';
insert into gru (label, id) select 'other_co', id from public.companies where name = 'Example Rival LLC';

insert into public.projects (company_id, name, status)
select (select id from gru where label = 'co'), v.name, 'active'
from (values ('Alpha'), ('Beta'), ('Gamma'), ('Delta')) as v(name);
insert into public.projects (company_id, name, status)
values ((select id from gru where label = 'other_co'), 'Rival', 'active');
insert into gru (label, id) select lower(name), id from public.projects
where name in ('Alpha', 'Beta', 'Gamma', 'Delta', 'Rival');

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
select (select id from gru where label = 'co'), v.name, v.kind::public.category_kind, 90, false, v.excluded
from (values
  ('Build', 'expense', false),
  ('Closing', 'expense', false),
  ('Land', 'expense', true),
  ('Proceeds', 'income', false),
  ('Credit', 'income', false),
  ('Rent', 'income', false)
) as v(name, kind, excluded);
insert into public.categories (company_id, name, kind, sort_order, is_default)
values ((select id from gru where label = 'other_co'), 'Rival cost', 'expense', 90, false);
insert into gru (label, id)
select lower(replace(name, ' ', '_')), id from public.categories
where name in ('Build', 'Closing', 'Land', 'Proceeds', 'Credit', 'Rent', 'Rival cost');

-- Lines. Deposits use invoice_receipt so their income counts on both the cash and the invoiced
-- basis; the payment is an ordinary expense. All posted, no VAT, one month.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select (select id from gru where label = 'co'), v.direction::public.txn_direction, v.doc_kind::public.doc_kind,
  v.role::public.pnl_role, 'posted', v.currency,
  v.amount, v.amount, abs(v.amount), 0, 'source', '2026-06-10', '2026-06-10', 'manual', v.key,
  (select id from gru where label = v.project), (select id from gru where label = v.category), v.key, true
from (values
  ('gru:dep', 'income',  'invoice_receipt', null, 'USD',  97000, 'alpha', 'rent'),
  ('gru:pay', 'expense', 'expense',  'project', 'USD',  -5000, 'beta',  'build'),
  ('gru:exc', 'income',  'invoice_receipt', null, 'USD',  97000, 'gamma', 'rent'),
  ('gru:rev', 'income',  'invoice_receipt', null, 'USD',  97000, 'delta', 'rent'),
  ('gru:ils', 'income',  'invoice_receipt', null, 'ILS',   9700, 'alpha', 'rent')
) as v(key, direction, doc_kind, role, currency, amount, project, category);
insert into gru (label, id) select replace(idempotency_key, 'gru:', 'txn_'), id
from public.transactions where idempotency_key like 'gru:%';
-- A foreign line for the isolation checks.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
values ((select id from gru where label = 'other_co'), 'income', 'invoice_receipt', null, 'posted', 'USD',
  97000, 97000, 97000, 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'gru:foreign',
  (select id from gru where label = 'rival'), (select id from gru where label = 'rival_cost'), 'gru:foreign', true);
insert into gru (label, id) select 'txn_foreign', id from public.transactions where idempotency_key = 'gru:foreign';

-- An exact-amount part. gross_up marks a real item of its category's kind that nets against the line.
create function pg_temp.part(p_category text, p_amount bigint, p_project text default null, p_gross_up boolean default false)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'category_id', (select id from gru where label = p_category),
    'project_id', (select id from gru where label = p_project),
    'amount_minor', p_amount,
    'gross_up', p_gross_up
  )
$$;
grant execute on function pg_temp.part(text, bigint, text, boolean) to authenticated, service_role;

create function pg_temp.cur(p_basis text, p_currency text) returns jsonb
language sql
as $$
  select x from jsonb_array_elements(public.get_dashboard(null, null, p_basis) -> 'by_currency') x
  where x ->> 'currency' = p_currency
$$;
grant execute on function pg_temp.cur(text, text) to authenticated;

create function pg_temp.proj(p_project text, p_basis text, p_currency text) returns jsonb
language sql
as $$
  select x from jsonb_array_elements(
    public.get_project((select id from gru where label = p_project), p_basis) -> 'by_currency'
  ) x
  where x ->> 'currency' = p_currency
$$;
grant execute on function pg_temp.proj(text, text, text) to authenticated;

-- One category's amount in an expense/income breakdown by category (positive magnitude, signed
-- like the breakdown: a real item of the kind adds, its reduction subtracts).
create function pg_temp.bd(p_direction text, p_basis text, p_category text) returns bigint
language sql
as $$
  select (g ->> 'amount_minor')::bigint
  from jsonb_array_elements(public.get_breakdown(p_direction, null, null, 'category', p_basis) -> 'groups') g
  where g ->> 'key' = (select id::text from gru where label = p_category)
$$;
grant execute on function pg_temp.bd(text, text, text) to authenticated;

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('gru_owner'), (select id from gru where label = 'co'),
  'hash-gru-write', 'kid', array['write']::text[], '2099-01-01');
insert into gru (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-gru-write';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('gru_owner');
  tid uuid;
begin
  select id into tid from pg_temp.gru where label = p_label;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

select tests.authenticate_as('gru_owner');

-- ---------------------------------------------------------------------------
-- Refusals (v1 scope). The same-kind rejection is gone: a same-kind gross-up part is now a
-- CONTRA entry (FLOW-947, 0207), covered in gross_up_contra.test.sql.
-- ---------------------------------------------------------------------------
-- A gross_up part with no project.
select throws_ok(
  $$select public.save_line_split((select id from gru where label = 'txn_dep'),
    jsonb_build_array(pg_temp.part('proceeds', 100000), pg_temp.part('closing', 3000, null, true)))$$,
  'a gross-up part needs a project',
  'a gross-up part with no project is refused');
-- A gross_up part combined with a percent (v1: exact amount only).
select throws_ok(
  $$select public.save_line_split((select id from gru where label = 'txn_dep'), jsonb_build_array(
    pg_temp.part('proceeds', 100000),
    jsonb_build_object('category_id', (select id from gru where label = 'closing'),
      'project_id', (select id from gru where label = 'alpha'), 'percent', 3, 'gross_up', true)))$$,
  'validation', 'a gross-up part with a percent is refused');
-- Signed sum off by one cent.
select throws_ok(
  $$select public.save_line_split((select id from gru where label = 'txn_dep'),
    jsonb_build_array(pg_temp.part('proceeds', 100000), pg_temp.part('closing', 3001, 'alpha', true)))$$,
  'parts must sum to the line', 'a signed sum one cent short is refused');
-- Company isolation: another company's project / category.
select throws_ok(
  $$select public.save_line_split((select id from gru where label = 'txn_dep'),
    jsonb_build_array(pg_temp.part('proceeds', 100000), pg_temp.part('closing', 3000, 'rival', true)))$$,
  'project not found', 'another company''s project is refused');
select is((select count(*)::integer from public.line_splits), 0, 'nothing was written by the refusals');

-- ---------------------------------------------------------------------------
-- The gross-up deposit: gross proceeds (+income) minus a real closing cost (expense).
-- ---------------------------------------------------------------------------
select is(
  public.save_line_split((select id from gru where label = 'txn_dep'),
    jsonb_build_array(pg_temp.part('proceeds', 100000), pg_temp.part('closing', 3000, 'alpha', true))),
  jsonb_build_array(pg_temp.part('proceeds', 100000), pg_temp.part('closing', 3000, 'alpha', true)),
  'the gross-up deposit saves and returns its parts (gross_up marked)');
select is(public.get_line_split((select id from gru where label = 'txn_dep')) -> 'parts_match',
  'true'::jsonb, 'the signed parts match the line');
-- The closing cost is a REAL expense of its kind: it adds to the expense total, not reduces it.
select is((pg_temp.proj('alpha', 'cash', 'USD') ->> 'income_minor')::bigint, 100000::bigint,
  'Alpha gets the full gross proceeds as income');
select is((pg_temp.proj('alpha', 'cash', 'USD') ->> 'direct_minor')::bigint, 3000::bigint,
  'Alpha gets the closing cost as a real expense');
select is(pg_temp.bd('expense', 'cash', 'closing'), 3000::bigint,
  'the closing cost shows as a positive expense in the breakdown (not a refund)');

-- ---------------------------------------------------------------------------
-- The payment-side symmetry: a real cost (expense) plus a positive credit (+income).
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.save_line_split((select id from gru where label = 'txn_pay'),
    jsonb_build_array(pg_temp.part('build', 6000, 'beta'), pg_temp.part('credit', 1000, 'beta', true)))$$,
  'the payment with a positive credit saves');
select is((pg_temp.proj('beta', 'cash', 'USD') ->> 'direct_minor')::bigint, 6000::bigint,
  'Beta gets the full cost as a real expense');
select is((pg_temp.proj('beta', 'cash', 'USD') ->> 'income_minor')::bigint, 1000::bigint,
  'Beta gets the credit as real income');
select is(pg_temp.bd('income', 'cash', 'credit'), 1000::bigint,
  'the credit shows as positive income in the breakdown');

-- ---------------------------------------------------------------------------
-- A legacy reversal (opposite kind, same money sign) still REDUCES the other side: the contrast.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.save_line_split((select id from gru where label = 'txn_rev'),
    jsonb_build_array(pg_temp.part('proceeds', 94000), pg_temp.part('closing', 3000, 'delta')))$$,
  'a legacy reversal deposit (no gross_up) saves');
select is(pg_temp.bd('expense', 'cash', 'build'), 6000::bigint,
  'only the gross-up payment adds to Build; the reversal is on Closing');
-- The reversal closing part reduces expense (amount_net keeps the line''s income sign), so the
-- Closing breakdown nets the gross-up (+3000) and the reversal (-3000) to zero.
select is(coalesce(pg_temp.bd('expense', 'cash', 'closing'), 0::bigint), 0::bigint,
  'the reversal reduces Closing by the same 3000 the gross-up added');

-- ---------------------------------------------------------------------------
-- A kept-out gross-up part moves to the excluded totals of its kind (expense).
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.save_line_split((select id from gru where label = 'txn_exc'),
    jsonb_build_array(pg_temp.part('proceeds', 100000), pg_temp.part('land', 3000, 'gamma', true)))$$,
  'a gross-up deposit with a kept-out cost saves');
select is((pg_temp.cur('cash', 'USD') ->> 'excluded_expense_minor')::bigint, 3000::bigint,
  'the kept-out gross-up cost is in the excluded expense total');
select is((pg_temp.proj('gamma', 'cash', 'USD') ->> 'income_minor')::bigint, 100000::bigint,
  'Gamma still gets the full proceeds as income');

-- ---------------------------------------------------------------------------
-- Company totals, both bases, USD and ILS.
-- ---------------------------------------------------------------------------
-- USD income: proceeds 100000 (dep) + credit 1000 (pay) + proceeds 100000 (exc)
--           + proceeds 94000 (rev) = 295000.
-- USD expense (in P&L): closing 3000 (dep) + build 6000 (pay) - closing 3000 (rev reduction)
--                     + 0 (land kept out) = 6000.
select is((pg_temp.cur('cash', 'USD') ->> 'income_minor')::bigint, 295000::bigint,
  'USD income is the gross proceeds and the credit');
select is((pg_temp.cur('cash', 'USD') ->> 'expense_minor')::bigint, 6000::bigint,
  'USD expense is the real costs net of the reversal, kept-out cost excluded');
-- Expenses are basis-independent, so the gross-up cost reads the same on the invoiced basis.
select is((pg_temp.cur('invoiced', 'USD') ->> 'expense_minor')::bigint, 6000::bigint,
  'USD expense is identical on the invoiced basis');
select is((pg_temp.cur('invoiced', 'USD') ->> 'excluded_expense_minor')::bigint, 3000::bigint,
  'the kept-out gross-up cost is excluded on the invoiced basis too');
select is((pg_temp.cur('invoiced', 'USD') ->> 'income_minor')::bigint, 295000::bigint,
  'USD income is identical on the invoiced basis (invoice_receipt counts on both)');
-- projects_cash_month (the projects list) carries Alpha's USD cash net: the gross proceeds in
-- (100000) less the closing cost out (3000) = the 97000 that actually hit the bank.
select is(
  (select (c ->> 'net_minor')::bigint
   from jsonb_array_elements(public.projects_cash_month('2026-06-01') -> 'projects') p
   cross join jsonb_array_elements(p -> 'cash') c
   where p ->> 'id' = (select id::text from gru where label = 'alpha') and c ->> 'currency' = 'USD'),
  97000::bigint, 'projects_cash_month shows Alpha''s USD net of the gross-up deposit');

-- ---------------------------------------------------------------------------
-- ILS gross-up (currency carries through).
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.save_line_split((select id from gru where label = 'txn_ils'),
    jsonb_build_array(pg_temp.part('proceeds', 10000), pg_temp.part('closing', 300, 'alpha', true)))$$,
  'an ILS gross-up deposit splits');
select is((pg_temp.proj('alpha', 'cash', 'ILS') ->> 'income_minor')::bigint, 10000::bigint,
  'Alpha gets the ILS proceeds');
select is((pg_temp.proj('alpha', 'cash', 'ILS') ->> 'direct_minor')::bigint, 300::bigint,
  'Alpha gets the ILS closing cost as a real expense');
select is((pg_temp.proj('alpha', 'invoiced', 'ILS') ->> 'direct_minor')::bigint, 300::bigint,
  'the ILS gross-up cost is identical on the invoiced basis');

-- ---------------------------------------------------------------------------
-- The P&L drill-down tags the gross-up part so the "paid from deposit" tag can show.
-- ---------------------------------------------------------------------------
select is(
  (select r ->> 'gross_up'
   from jsonb_array_elements(
     public.get_breakdown_lines('expense', 'category', (select id::text from gru where label = 'closing'), 'USD') -> 'rows') r
   where r ->> 'transaction_id' = (select id::text from gru where label = 'txn_dep')),
  'true', 'the P&L drill-down marks the gross-up closing cost');
select is(
  (select r ->> 'gross_up'
   from jsonb_array_elements(
     public.get_breakdown_lines('expense', 'category', (select id::text from gru where label = 'closing'), 'USD') -> 'rows') r
   where r ->> 'transaction_id' = (select id::text from gru where label = 'txn_rev')),
  'false', 'a legacy reversal part is not marked gross-up');

-- ---------------------------------------------------------------------------
-- Undo through the MCP round-trips gross_up, with the same conflict check.
-- ---------------------------------------------------------------------------
select pg_temp.as_mcp('write');
-- A first gross-up split, then a different one; undo the second restores the first with gross_up.
select ok(
  public.mcp_split_line('gru-k1', (select id from gru where label = 'txn_pay'),
    jsonb_build_array(pg_temp.part('build', 7000, 'beta'), pg_temp.part('credit', 2000, 'beta', true)))
    -> 'data' ? 'parts',
  'MCP saves a new gross-up split on the payment');
select is(
  public.mcp_undo('gru-u1', 'line_split', (select id from gru where label = 'txn_pay')) -> 'data' ->> 'kind',
  'line_split', 'undo of the split succeeds');
select is(
  (select x ->> 'gross_up'
   from jsonb_array_elements(public.get_line_split((select id from gru where label = 'txn_pay')) -> 'parts') x
   where x ->> 'category_id' = (select id::text from gru where label = 'credit')),
  'true', 'undo restored the prior credit part with its gross_up flag');
select is(public.get_line_split((select id from gru where label = 'txn_pay')) -> 'parts_match',
  'true'::jsonb, 'the restored split still matches the line');

-- ---------------------------------------------------------------------------
-- Company isolation: a viewer of another company cannot read this split.
-- ---------------------------------------------------------------------------
select tests.authenticate_as('gru_other');
select is(public.get_line_split((select id from gru where label = 'txn_dep')), null,
  'another company''s owner cannot read the split');

select * from finish();
rollback;
