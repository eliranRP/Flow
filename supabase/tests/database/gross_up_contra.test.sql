-- FLOW-947. Gross-up CONTRA effect (decision 0207, extends 0206). A gross-up split part may now
-- carry EITHER category kind. The effect is derived from the category kind vs the line direction:
-- the OPPOSITE kind is a NORMAL real item (0206, unchanged); the SAME kind is a CONTRA entry that
-- reduces its own category (an expense category credits, an income category lowers income). Cash
-- and the signed sum do not change. Invented books only. USD amounts are cents, ILS are agorot.

begin;

select plan(35);

do $users$
begin
  perform tests.create_supabase_user('ctr_owner', 'ctr-owner@example.com');
  perform tests.create_supabase_user('ctr_other', 'ctr-other@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('ctr_owner'), 'Example Contra LLC', false),
  (tests.get_supabase_uid('ctr_other'), 'Example Rival LLC', false);

create temp table ctr (label text primary key, id uuid);
grant all on ctr to authenticated, service_role;
insert into ctr (label, id) select 'co', id from public.companies where name = 'Example Contra LLC';
insert into ctr (label, id) select 'other_co', id from public.companies where name = 'Example Rival LLC';

insert into public.projects (company_id, name, status)
select (select id from ctr where label = 'co'), v.name, 'active'
from (values ('Alpha'), ('Beta')) as v(name);
insert into public.projects (company_id, name, status)
values ((select id from ctr where label = 'other_co'), 'Rival', 'active');
insert into ctr (label, id) select lower(name), id from public.projects
where name in ('Alpha', 'Beta', 'Rival');

insert into public.categories (company_id, name, kind, sort_order, is_default)
select (select id from ctr where label = 'co'), v.name, v.kind::public.category_kind, 90, false
from (values
  ('Build', 'expense'),
  ('Taxes', 'expense'),
  ('Closing', 'expense'),
  ('Proceeds', 'income'),
  ('Rent', 'income'),
  ('OtherInc', 'income')
) as v(name, kind);
insert into public.categories (company_id, name, kind, sort_order, is_default)
values ((select id from ctr where label = 'other_co'), 'Rival cost', 'expense', 90, false);
insert into ctr (label, id)
select lower(replace(name, ' ', '_')), id from public.categories
where name in ('Build', 'Taxes', 'Closing', 'Proceeds', 'Rent', 'OtherInc', 'Rival cost');

-- Lines. Deposits use invoice_receipt so income counts on both the cash and the invoiced basis.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select (select id from ctr where label = 'co'), v.direction::public.txn_direction, v.doc_kind::public.doc_kind,
  v.role::public.pnl_role, 'posted', v.currency,
  v.amount, v.amount, abs(v.amount), 0, 'source', '2026-06-10', '2026-06-10', 'manual', v.key,
  (select id from ctr where label = v.project), (select id from ctr where label = v.category), v.key, true
from (values
  ('ctr:pay',  'expense', 'expense',         'project', 'USD', -139871, 'beta',  'build'),
  ('ctr:dep',  'income',  'invoice_receipt', null,      'USD',   97000, 'alpha', 'rent'),
  ('ctr:dep2', 'income',  'invoice_receipt', null,      'USD',   50000, 'alpha', 'proceeds'),
  ('ctr:ils',  'income',  'invoice_receipt', null,      'ILS',    9700, 'alpha', 'rent')
) as v(key, direction, doc_kind, role, currency, amount, project, category);
insert into ctr (label, id) select replace(idempotency_key, 'ctr:', 'txn_'), id
from public.transactions where idempotency_key like 'ctr:%';
-- A foreign line for the isolation check.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
values ((select id from ctr where label = 'other_co'), 'income', 'invoice_receipt', null, 'posted', 'USD',
  97000, 97000, 97000, 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'ctr:foreign',
  (select id from ctr where label = 'rival'), (select id from ctr where label = 'rival_cost'), 'ctr:foreign', true);
insert into ctr (label, id) select 'txn_foreign', id from public.transactions where idempotency_key = 'ctr:foreign';

-- An exact-amount part; the optional effect is included only when p_effect is passed.
create function pg_temp.part(p_category text, p_amount bigint, p_project text default null,
  p_gross_up boolean default false, p_effect text default null)
returns jsonb
language sql
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'category_id', (select id from ctr where label = p_category),
    'project_id', (select id from ctr where label = p_project),
    'amount_minor', p_amount,
    'gross_up', p_gross_up,
    'effect', p_effect
  ))
$$;
grant execute on function pg_temp.part(text, bigint, text, boolean, text) to authenticated, service_role;

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
    public.get_project((select id from ctr where label = p_project), p_basis) -> 'by_currency'
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
  where g ->> 'key' = (select id::text from ctr where label = p_category)
$$;
grant execute on function pg_temp.bd(text, text, text) to authenticated;

-- The same, for one currency (a category that has lines in more than one currency has a group per
-- currency in the breakdown).
create function pg_temp.bdc(p_direction text, p_basis text, p_category text, p_currency text) returns bigint
language sql
as $$
  select (g ->> 'amount_minor')::bigint
  from jsonb_array_elements(public.get_breakdown(p_direction, null, null, 'category', p_basis) -> 'groups') g
  where g ->> 'key' = (select id::text from ctr where label = p_category)
    and g ->> 'currency' = p_currency
$$;
grant execute on function pg_temp.bdc(text, text, text, text) to authenticated;

-- The derived effect on a line's part filed to a given category and project.
create function pg_temp.effect_of(p_line text, p_category text, p_project text) returns text
language sql
as $$
  select x ->> 'effect'
  from jsonb_array_elements(public.get_line_split((select id from ctr where label = p_line)) -> 'parts') x
  where x ->> 'category_id' = (select id::text from ctr where label = p_category)
    and x ->> 'project_id' = (select id::text from ctr where label = p_project)
$$;
grant execute on function pg_temp.effect_of(text, text, text) to authenticated;

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('ctr_owner'), (select id from ctr where label = 'co'),
  'hash-ctr-write', 'kid', array['write']::text[], '2099-01-01');
insert into ctr (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-ctr-write';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('ctr_owner');
  tid uuid;
begin
  select id into tid from pg_temp.ctr where label = p_label;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

select tests.authenticate_as('ctr_owner');

-- ===========================================================================
-- Headline: a payment with a normal cost (Build) and, on the SAME side, a normal Taxes cost plus
-- a CONTRA Taxes credit. The Taxes category nets to a +601.29 CREDIT, Other income is 0, and the
-- company net is unchanged vs the two-sided version that puts the 850.77 on Other income.
-- (A third normal part keeps the signed sum positive, so the split is valid; the credit is on its
--  own category.)
-- ===========================================================================

-- Two-sided version first: Build 2000 cost + Taxes 249.48 cost + Other income 850.77 (gross-up,
-- opposite kind on a payment: income-on-"+" NORMAL, a regression).
select lives_ok(
  $$select public.save_line_split((select id from ctr where label = 'txn_pay'), jsonb_build_array(
    pg_temp.part('build', 200000, 'beta'),
    pg_temp.part('taxes', 24948, 'beta'),
    pg_temp.part('otherinc', 85077, 'alpha', true)))$$,
  'the two-sided split (gross-up income on a payment) saves');
select is(pg_temp.bd('expense', 'cash', 'build'), 200000::bigint, 'two-sided: Build is a 2000 expense');
select is(pg_temp.bd('expense', 'cash', 'taxes'), 24948::bigint, 'two-sided: Taxes is a 249.48 expense');
select is(pg_temp.bd('income', 'cash', 'otherinc'), 85077::bigint,
  'two-sided: income-on-"+" is NORMAL — Other income gets 850.77 (regression)');
select is(pg_temp.effect_of('txn_pay', 'otherinc', 'alpha'), 'normal',
  'the opposite-kind gross-up part derives effect normal');
select is((pg_temp.cur('cash', 'USD') ->> 'income_minor')::bigint, 232077::bigint,
  'two-sided USD income = Other income 850.77 + the two whole deposits (970 + 500)');
select is((pg_temp.cur('cash', 'USD') ->> 'expense_minor')::bigint, 224948::bigint,
  'two-sided USD expense = Build 2000 + Taxes 249.48');

-- The CONTRA version: move the 850.77 onto the SAME Taxes category as a contra credit.
select lives_ok(
  $$select public.save_line_split((select id from ctr where label = 'txn_pay'), jsonb_build_array(
    pg_temp.part('build', 200000, 'beta'),
    pg_temp.part('taxes', 24948, 'beta'),
    pg_temp.part('taxes', 85077, 'alpha', true)))$$,
  'the contra split (same-kind gross-up on the payment) saves');
select is(pg_temp.bd('expense', 'cash', 'taxes'), -60129::bigint,
  'Taxes nets to a +601.29 CREDIT (a negative expense): 249.48 cost minus the 850.77 contra credit');
select is(pg_temp.bd('expense', 'cash', 'build'), 200000::bigint, 'Build is unchanged at 2000');
select is(coalesce(pg_temp.bd('income', 'cash', 'otherinc'), 0::bigint), 0::bigint,
  'Other income is 0 in the contra version');
select is(pg_temp.effect_of('txn_pay', 'taxes', 'alpha'), 'contra',
  'the same-kind gross-up part derives effect contra');
select is(public.get_line_split((select id from ctr where label = 'txn_pay')) -> 'parts_match',
  'true'::jsonb, 'the signed parts still match the line (cash unchanged)');
select is((pg_temp.cur('cash', 'USD') ->> 'income_minor')::bigint, 147000::bigint,
  'contra USD income = the two whole deposits only (Other income gone)');
select is((pg_temp.cur('cash', 'USD') ->> 'expense_minor')::bigint, 139871::bigint,
  'contra USD expense = Build 2000 minus the Taxes 601.29 credit');
-- Company net is unchanged: two-sided 232077-224948 = 7129; contra 147000-139871 = 7129.
select is(
  (pg_temp.cur('cash', 'USD') ->> 'income_minor')::bigint - (pg_temp.cur('cash', 'USD') ->> 'expense_minor')::bigint,
  7129::bigint, 'the company USD net is unchanged vs the two-sided version');
-- Expenses are basis-independent, so the Taxes credit reads the same on the invoiced basis.
select is((pg_temp.cur('invoiced', 'USD') ->> 'expense_minor')::bigint, 139871::bigint,
  'the contra USD expense is identical on the invoiced basis');

-- ===========================================================================
-- Refusals and the explicit effect.
-- ===========================================================================
-- An explicit effect that disagrees with the derived value is refused.
select throws_ok(
  $$select public.save_line_split((select id from ctr where label = 'txn_pay'), jsonb_build_array(
    pg_temp.part('build', 200000, 'beta'),
    pg_temp.part('taxes', 24948, 'beta'),
    pg_temp.part('taxes', 85077, 'alpha', true, 'normal')))$$,
  'validation', 'an explicit effect that does not match the derived value is refused');
-- An explicit effect that matches is accepted.
select lives_ok(
  $$select public.save_line_split((select id from ctr where label = 'txn_pay'), jsonb_build_array(
    pg_temp.part('build', 200000, 'beta'),
    pg_temp.part('taxes', 24948, 'beta'),
    pg_temp.part('taxes', 85077, 'alpha', true, 'contra')))$$,
  'an explicit effect that matches the derived value is accepted');
-- A gross-up part still needs its own project.
select throws_ok(
  $$select public.save_line_split((select id from ctr where label = 'txn_pay'), jsonb_build_array(
    pg_temp.part('build', 200000, 'beta'),
    pg_temp.part('taxes', 24948, 'beta'),
    pg_temp.part('closing', 85077, null, true)))$$,
  'a gross-up part needs a project', 'a gross-up part with no project is still refused');
-- A gross-up part with a percent is still refused (v1: exact amount only).
select throws_ok(
  $$select public.save_line_split((select id from ctr where label = 'txn_pay'), jsonb_build_array(
    pg_temp.part('build', 200000, 'beta'),
    pg_temp.part('taxes', 24948, 'beta'),
    jsonb_build_object('category_id', (select id from ctr where label = 'taxes'),
      'project_id', (select id from ctr where label = 'alpha'), 'percent', 3, 'gross_up', true)))$$,
  'validation', 'a gross-up part with a percent is still refused');

-- ===========================================================================
-- A deposit with a "−" CONTRA part in an income category lowers that income.
-- ===========================================================================
select lives_ok(
  $$select public.save_line_split((select id from ctr where label = 'txn_dep'), jsonb_build_array(
    pg_temp.part('proceeds', 100000, 'alpha'),
    pg_temp.part('rent', 3000, 'beta', true)))$$,
  'a deposit income-contra saves (proceeds 1000 minus a 30 contra on Rent)');
select is(pg_temp.bdc('income', 'cash', 'rent', 'USD'), -3000::bigint,
  'the contra income part LOWERS Rent by 30 (a negative income)');
select is(pg_temp.effect_of('txn_dep', 'rent', 'beta'), 'contra',
  'the same-kind income gross-up part derives effect contra');

-- ===========================================================================
-- Regression: expense-on-"−" (a gross-up expense on a deposit) stays NORMAL (a real cost).
-- ===========================================================================
select lives_ok(
  $$select public.save_line_split((select id from ctr where label = 'txn_dep2'), jsonb_build_array(
    pg_temp.part('proceeds', 53000, 'alpha'),
    pg_temp.part('closing', 3000, 'beta', true)))$$,
  'a deposit with a normal gross-up expense cost saves');
select is(pg_temp.bd('expense', 'cash', 'closing'), 3000::bigint,
  'expense-on-"−" is NORMAL — Closing is a real 30 cost, not a credit');
select is(pg_temp.effect_of('txn_dep2', 'closing', 'beta'), 'normal',
  'the opposite-kind expense gross-up part derives effect normal');

-- ===========================================================================
-- Cash == invoiced in ILS for a contra part, and the parts still sum to the bank line.
-- ===========================================================================
select lives_ok(
  $$select public.save_line_split((select id from ctr where label = 'txn_ils'), jsonb_build_array(
    pg_temp.part('proceeds', 10000, 'alpha'),
    pg_temp.part('rent', 300, 'beta', true)))$$,
  'an ILS deposit income-contra saves');
select is((pg_temp.cur('cash', 'ILS') ->> 'income_minor')::bigint,
  (pg_temp.cur('invoiced', 'ILS') ->> 'income_minor')::bigint,
  'the ILS income is identical on the cash and invoiced bases for the contra deposit');
-- projects_cash_month: Alpha's ILS cash is the gross proceeds in (10000); the contra credit (300)
-- reduces Beta, and the two sum to the 9700 that actually hit the bank.
select is(
  (select (c ->> 'net_minor')::bigint
   from jsonb_array_elements(public.projects_cash_month('2026-06-01') -> 'projects') p
   cross join jsonb_array_elements(p -> 'cash') c
   where p ->> 'id' = (select id::text from ctr where label = 'alpha') and c ->> 'currency' = 'ILS'),
  10000::bigint, 'projects_cash_month: Alpha''s ILS cash is the full gross proceeds');

-- ===========================================================================
-- Undo (MCP) restores the prior parts, effect and all, with the same conflict check.
-- ===========================================================================
select pg_temp.as_mcp('write');
select ok(
  public.mcp_split_line('ctr-k1', (select id from ctr where label = 'txn_dep'), jsonb_build_array(
    pg_temp.part('proceeds', 98000, 'alpha'),
    pg_temp.part('rent', 1000, 'beta', true)))
    -> 'data' ? 'parts',
  'MCP saves a new income-contra split on the deposit');
select is(
  public.mcp_undo('ctr-u1', 'line_split', (select id from ctr where label = 'txn_dep')) -> 'data' ->> 'kind',
  'line_split', 'undo of the split succeeds');
select is(pg_temp.effect_of('txn_dep', 'rent', 'beta'), 'contra',
  'undo restored the prior contra part (its derived effect is contra again)');
select is(public.get_line_split((select id from ctr where label = 'txn_dep')) -> 'parts_match',
  'true'::jsonb, 'the restored split still matches the line');

-- ===========================================================================
-- Company isolation: a viewer of another company cannot read this split.
-- ===========================================================================
select tests.authenticate_as('ctr_other');
select is(public.get_line_split((select id from ctr where label = 'txn_pay')), null,
  'another company''s owner cannot read the split');

select * from finish();
rollback;
