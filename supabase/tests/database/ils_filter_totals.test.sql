-- FLOW-409 item 2. The shekel totals of get_home and get_project count only ILS lines: on both
-- bases, in a date range, for shared costs, and in the overhead weights. Dollar lines stay in
-- their own currency buckets. Invented data only. Amounts are agorot (cents for USD).
-- Every line is a paid invoice-receipt, so both bases count the same lines; the test is about
-- the currency filter, not the basis rules.

begin;

select plan(12);

do $users$
begin
  perform tests.create_supabase_user('ilf_owner', 'ilf-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('ilf_owner'), 'Example Shekel Filter LLC', false);

create temp table ilf (label text primary key, id uuid);
grant all on ilf to authenticated, service_role;
insert into ilf (label, id) select 'co', id from public.companies where name = 'Example Shekel Filter LLC';

insert into public.projects (company_id, name, status)
values
  ((select id from ilf where label = 'co'), 'Alpha', 'active'),
  ((select id from ilf where label = 'co'), 'Beta', 'active');
insert into ilf (label, id) select lower(name), id from public.projects
where company_id = (select id from ilf where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values
  ((select id from ilf where label = 'co'), 'Sales', 'income', 90, false, false),
  ((select id from ilf where label = 'co'), 'Costs', 'expense', 91, false, false);
insert into ilf (label, id) select lower(name), id from public.categories
where company_id = (select id from ilf where label = 'co') and name in ('Sales', 'Costs');

-- Income on each project in both currencies; Beta's dollars would tip the overhead weights.
-- Overhead and shared costs in both currencies. One July line is outside the June range.
insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, category_assigned, category_suggested, pnl_role
)
select
  (select id from ilf where label = 'co'), v.direction::public.txn_direction, 'invoice_receipt', 'posted', v.currency,
  v.amount, v.amount, abs(v.amount), 0, 'source', v.doc_date::date, v.doc_date::date, 'manual', v.ikey,
  (select id from ilf where label = v.project), (select id from ilf where label = v.category), v.ikey,
  true, true, false, v.role::public.pnl_role
from (values
  ('income', 'ILS', 1000000, 'alpha', 'sales', 'project', '2026-06-10', 'ilf:alpha_ils'),
  ('income', 'USD', 500000, 'alpha', 'sales', 'project', '2026-06-10', 'ilf:alpha_usd'),
  ('income', 'ILS', 1000000, 'beta', 'sales', 'project', '2026-06-11', 'ilf:beta_ils'),
  ('income', 'USD', 4500000, 'beta', 'sales', 'project', '2026-06-11', 'ilf:beta_usd'),
  ('income', 'ILS', 300000, 'alpha', 'sales', 'project', '2026-07-02', 'ilf:alpha_july'),
  ('expense', 'ILS', -200000, null, 'costs', 'overhead', '2026-06-12', 'ilf:overhead_ils'),
  ('expense', 'USD', -900000, null, 'costs', 'overhead', '2026-06-12', 'ilf:overhead_usd'),
  ('expense', 'ILS', -30000, null, 'costs', 'shared', '2026-06-13', 'ilf:shared_ils'),
  ('expense', 'USD', -70000, null, 'costs', 'shared', '2026-06-13', 'ilf:shared_usd')
) as v(direction, currency, amount, project, category, role, doc_date, ikey);

-- Both shared lines are allocated whole to Alpha.
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, (select id from ilf where label = 'alpha'), 10000, t.amount_net
from public.transactions t
where t.idempotency_key in ('ilf:shared_ils', 'ilf:shared_usd');

select tests.authenticate_as('ilf_owner');

-- get_home: shekel lines only (income 23000.00, overhead 2000.00, shared 300.00).
select is(
  (public.get_home()->>'net_profit_agorot')::bigint,
  2070000::bigint,
  'get_home: the shekel profit leaves out every dollar line');
select is(
  (select (item->>'income_minor')::bigint
   from jsonb_array_elements(public.get_home()->'other_currencies') item
   where item->>'currency' = 'USD'),
  5000000::bigint,
  'get_home: the dollar income stays in its own bucket');

-- get_project, all time, on both bases.
select is(
  (public.get_project((select id from ilf where label = 'alpha'), 'cash')->>'income_agorot')::bigint,
  1300000::bigint,
  'get_project cash: income counts only the shekel lines');
select is(
  (public.get_project((select id from ilf where label = 'alpha'), 'invoiced')->>'income_agorot')::bigint,
  1300000::bigint,
  'get_project invoiced: the same');
select is(
  (public.get_project((select id from ilf where label = 'alpha'), 'cash')->>'shared_agorot')::bigint,
  30000::bigint,
  'get_project: shared costs count only the shekel allocation');

-- get_project in a range.
select is(
  (public.get_project((select id from ilf where label = 'alpha'), 'cash', '2026-06-01', '2026-06-30')->>'income_agorot')::bigint,
  1000000::bigint,
  'get_project in a range: the shekel income in the range');
select is(
  (public.get_project((select id from ilf where label = 'alpha'), 'invoiced', '2026-06-01', '2026-06-30')->>'income_agorot')::bigint,
  1000000::bigint,
  'and on the invoiced basis');
select is(
  (select (item->>'income_minor')::bigint
   from jsonb_array_elements(
     public.get_project((select id from ilf where label = 'alpha'), 'cash', '2026-06-01', '2026-06-30')->'other_currencies') item
   where item->>'currency' = 'USD'),
  500000::bigint,
  'the range keeps the dollar income in its own bucket');

-- Overhead: shekel overhead split by shekel income (50/50 in June); with the dollars it would
-- be 1:9.
select is(
  (public.get_project((select id from ilf where label = 'alpha'), 'cash', '2026-06-01', '2026-06-30')->>'overhead_share_agorot')::bigint,
  100000::bigint,
  'overhead: Alpha''s share weighs only shekel income and counts only shekel overhead');
select is(
  (public.get_project((select id from ilf where label = 'beta'), 'invoiced', '2026-06-01', '2026-06-30')->>'overhead_share_agorot')::bigint,
  100000::bigint,
  'overhead: so does Beta''s, on the invoiced basis');
select is(
  (public.get_project((select id from ilf where label = 'alpha'), 'cash', '2026-06-01', '2026-06-30')->>'profit_after_overhead_agorot')::bigint,
  870000::bigint,
  'Alpha''s profit after overhead is shekels only');
select is(
  (select (item->>'expense_minor')::bigint
   from jsonb_array_elements(
     public.get_project((select id from ilf where label = 'alpha'), 'cash')->'other_currencies') item
   where item->>'currency' = 'USD'),
  -70000::bigint,
  'the dollar shared cost stays in the dollar bucket');

select * from finish();
rollback;
