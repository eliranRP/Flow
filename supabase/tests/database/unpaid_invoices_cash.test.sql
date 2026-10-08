-- FLOW-128: an unpaid supplier invoice stays out of the cash basis (decision 0118).
-- On the invoiced basis it counts by its document date. Every other expense keeps its date.

begin;

select plan(38);

do $users$
begin
  perform tests.create_supabase_user('ui_owner', 'ui-owner@example.com');
end
$users$;

create temp table ui_ref (label text primary key, id uuid);
grant all on ui_ref to authenticated;

create function pg_temp.cur(p jsonb, c text) returns jsonb
language sql immutable
as $$ select x from jsonb_array_elements(p -> 'by_currency') x where x ->> 'currency' = c $$;

create function pg_temp.proj(p jsonb, n text) returns jsonb
language sql immutable
as $$ select x from jsonb_array_elements(p -> 'projects') x where x ->> 'name' = n $$;

create function pg_temp.total(p jsonb, c text) returns bigint
language sql immutable
as $$ select (x ->> 'amount_minor')::bigint from jsonb_array_elements(p -> 'totals') x where x ->> 'currency' = c $$;

create function pg_temp.minor_sum(p jsonb, k text, c text) returns bigint
language sql immutable
as $$ select coalesce(sum((x ->> 'amount_minor')::bigint), 0)::bigint from jsonb_array_elements(p -> k) x where x ->> 'currency' = c $$;

create function pg_temp.other(p jsonb, c text) returns jsonb
language sql immutable
as $$ select x from jsonb_array_elements(p -> 'other_currencies') x where x ->> 'currency' = c $$;

create function pg_temp.cat_sum(p jsonb) returns bigint
language sql immutable
as $$ select coalesce(sum((x ->> 'amount_agorot')::bigint), 0)::bigint from jsonb_array_elements(p -> 'categories') x $$;

grant execute on function pg_temp.cur(jsonb, text), pg_temp.proj(jsonb, text), pg_temp.total(jsonb, text),
  pg_temp.cat_sum(jsonb), pg_temp.minor_sum(jsonb, text, text), pg_temp.other(jsonb, text) to authenticated;

select tests.authenticate_as('ui_owner');
select public.create_company('Example Renovations LLC', true);
select public.upsert_project(null, 'Site Alpha', null, 'active');
insert into ui_ref (label, id) select 'co', id from public.companies where name = 'Example Renovations LLC';
insert into ui_ref (label, id) select 'alpha', id from public.projects where name = 'Site Alpha';

reset role;

insert into ui_ref (label, id)
select 'cat', c.id
from public.categories c
where c.company_id = (select id from ui_ref where label = 'co')
  and c.kind = 'expense'
  and not c.excluded_from_pnl
  and c.loan_part is null
order by c.name
limit 1;

-- Invented, round amounts. The paid invoice is dated in June and paid in July.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select
  (select id from ui_ref where label = 'co'),
  'expense', v.doc_kind::public.doc_kind, 'project', 'posted', v.cur,
  v.amount, v.amount, abs(v.amount), 0, 'source',
  '2026-06-10', v.cash_date::date,
  'manual', 'ui:' || v.ikey,
  (select id from ui_ref where label = 'alpha'),
  (select id from ui_ref where label = 'cat'),
  v.ikey,
  true
from (values
  ('invoice', -6000, '2026-07-05', 'ILS', 'paid-invoice'),
  ('invoice', -4000, null,         'ILS', 'unpaid-invoice'),
  ('expense', -3000, '2026-06-10', 'ILS', 'bank-line'),
  ('invoice', -2000, null,         'USD', 'unpaid-usd'),
  ('expense', -1000, '2026-06-10', 'USD', 'bank-usd')
) as v(doc_kind, amount, cash_date, cur, ikey);

-- The rule itself.
select is(private.line_unpaid('expense', 'invoice', null), true, 'an expense invoice with no cash date is unpaid');
select is(private.line_unpaid('expense', 'credit', null), true, 'a supplier credit note with no cash date is unpaid');
select is(private.line_unpaid('expense', 'invoice', '2026-06-10'), false, 'a paid supplier invoice is not unpaid');
select is(private.line_unpaid('expense', 'expense', null), false, 'a bank or manual expense line is never unpaid');
select is(private.line_unpaid('income', 'invoice', null), false, 'income follows its own doc-kind rule, not this one');

select tests.authenticate_as('ui_owner');

-- Company totals.
select is((public.get_dashboard(null, null, 'cash') ->> 'expense_agorot')::bigint, 9000::bigint,
  'cash basis: paid invoice 6000 + bank line 3000; the unpaid invoice is out');
select is((public.get_dashboard(null, null, 'invoiced') ->> 'expense_agorot')::bigint, 13000::bigint,
  'invoiced basis: the unpaid invoice counts too');
select is((pg_temp.cur(public.get_dashboard(null, null, 'cash'), 'USD') ->> 'expense_minor')::bigint, 1000::bigint,
  'cash basis, USD: the unpaid invoice is out');
select is((pg_temp.cur(public.get_dashboard(null, null, 'invoiced'), 'USD') ->> 'expense_minor')::bigint, 3000::bigint,
  'invoiced basis, USD: the unpaid invoice counts');
select is((pg_temp.cur(public.get_dashboard(null, null, 'cash'), 'ILS') ->> 'count')::integer, 2,
  'cash basis: the unpaid invoice is not counted as a line either');
select is((public.get_dashboard('2026-06-01', '2026-06-30', 'cash') ->> 'expense_agorot')::bigint, 9000::bigint,
  'cash basis: a paid invoice keeps its document date');
select is((pg_temp.proj(public.get_dashboard(null, null, 'cash'), 'Site Alpha') ->> 'direct_agorot')::bigint, 9000::bigint,
  'cash basis: project direct cost leaves the unpaid invoice out');

select is((public.get_home() ->> 'net_profit_agorot')::bigint, -9000::bigint,
  'get_home (cash) leaves the unpaid invoice out');

-- Project card.
select is((public.get_project((select id from ui_ref where label = 'alpha'), 'cash') ->> 'direct_agorot')::bigint, 9000::bigint,
  'get_project cash: direct cost without the unpaid invoice');
select is((public.get_project((select id from ui_ref where label = 'alpha'), 'invoiced') ->> 'direct_agorot')::bigint, 13000::bigint,
  'get_project invoiced: direct cost with the unpaid invoice');
select is(pg_temp.cat_sum(public.get_project((select id from ui_ref where label = 'alpha'), 'cash')), 9000::bigint,
  'get_project cash: categories add up to direct cost');

-- Breakdown.
select is(pg_temp.total(public.get_breakdown('expense', null, null, 'category', 'cash'), 'ILS'), 9000::bigint,
  'get_breakdown cash: the unpaid invoice is out');
select is(pg_temp.total(public.get_breakdown('expense', null, null, 'category', 'invoiced'), 'ILS'), 13000::bigint,
  'get_breakdown invoiced: the unpaid invoice counts');

-- Paying the invoice brings it into the cash basis.
reset role;
update public.transactions set cash_date = '2026-07-20' where idempotency_key = 'ui:unpaid-invoice';
select tests.authenticate_as('ui_owner');
select is((public.get_dashboard(null, null, 'cash') ->> 'expense_agorot')::bigint, 13000::bigint,
  'once paid, the invoice counts on the cash basis');
select is(
  (public.get_home() ->> 'net_profit_agorot')::bigint, -13000::bigint,
  'get_home counts it once paid'
);

-- Every other read of the view: shared cost, foreign currency lists, kept-out lines and an
-- unpaid invoice filed to an income category (a reversal). Each assertion fails when its
-- read drops the unpaid filter.
reset role;
insert into public.categories (company_id, name, kind, sort_order, excluded_from_pnl)
select (select id from ui_ref where label = 'co'), v.name, v.kind::public.category_kind, 900, v.out
from (values ('UI kept out', 'expense', true), ('UI income', 'income', false), ('UI income out', 'income', true))
  as v(name, kind, out);
insert into ui_ref (label, id)
select 'out', id from public.categories
where company_id = (select id from ui_ref where label = 'co') and name = 'UI kept out';
insert into ui_ref (label, id)
select 'inc', id from public.categories
where company_id = (select id from ui_ref where label = 'co') and name = 'UI income';
insert into ui_ref (label, id)
select 'inc-out', id from public.categories
where company_id = (select id from ui_ref where label = 'co') and name = 'UI income out';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select
  (select id from ui_ref where label = 'co'),
  'expense', 'invoice', v.role::public.pnl_role, 'posted', v.cur,
  v.amount, v.amount, abs(v.amount), 0, 'source',
  '2026-06-10', null,
  'manual', 'ui:' || v.ikey,
  case when v.role = 'project' then (select id from ui_ref where label = 'alpha') end,
  (select id from ui_ref where label = v.cat),
  v.ikey,
  true
from (values
  ('shared', -800, 'ILS', 'cat', 'shared-ils'),
  ('shared', -700, 'USD', 'cat', 'shared-usd'),
  ('project', -500, 'ILS', 'out', 'kept-out-ils'),
  ('project', -300, 'ILS', 'inc', 'reversal-ils'),
  ('project', -200, 'ILS', 'inc-out', 'reversal-out')
) as v(role, amount, cur, cat, ikey);

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, (select id from ui_ref where label = 'alpha'), 10000, t.amount_net
from public.transactions t
where t.idempotency_key in ('ui:shared-ils', 'ui:shared-usd');

select tests.authenticate_as('ui_owner');

select is((public.get_project((select id from ui_ref where label = 'alpha'), 'cash') ->> 'shared_agorot')::bigint, 0::bigint,
  'get_project cash: an unpaid shared invoice is not shared cost');
select is((public.get_project((select id from ui_ref where label = 'alpha'), 'invoiced') ->> 'shared_agorot')::bigint, 800::bigint,
  'get_project invoiced: the unpaid shared invoice counts');
select is((pg_temp.cur(public.get_project((select id from ui_ref where label = 'alpha'), 'cash'), 'USD') ->> 'direct_minor')::bigint, 1000::bigint,
  'get_project cash, by_currency USD: direct cost without the unpaid invoice');
select is((pg_temp.cur(public.get_project((select id from ui_ref where label = 'alpha'), 'cash'), 'USD') ->> 'shared_minor')::bigint, 0::bigint,
  'get_project cash, by_currency USD: no unpaid shared cost');
select is(pg_temp.minor_sum(public.get_project((select id from ui_ref where label = 'alpha'), 'cash'), 'categories_by_currency', 'USD'), 1000::bigint,
  'get_project cash: categories_by_currency leaves the unpaid invoices out');
select is(pg_temp.minor_sum(public.get_project((select id from ui_ref where label = 'alpha'), 'cash'), 'excluded_categories_by_currency', 'ILS'), 0::bigint,
  'get_project cash: an unpaid kept-out invoice is not in excluded_categories_by_currency');
select is(pg_temp.minor_sum(public.get_project((select id from ui_ref where label = 'alpha'), 'invoiced'), 'excluded_categories_by_currency', 'ILS'), 500::bigint,
  'get_project invoiced: the unpaid kept-out invoice is listed');
select is((pg_temp.other(public.get_project((select id from ui_ref where label = 'alpha'), 'cash'), 'USD') ->> 'expense_minor')::bigint, -1000::bigint,
  'get_project cash, other_currencies: no unpaid direct or shared USD invoice');
select is((public.get_project((select id from ui_ref where label = 'alpha'), 'cash') ->> 'income_agorot')::bigint, 0::bigint,
  'get_project cash: an unpaid invoice in an income category is not income');
select is((public.get_project((select id from ui_ref where label = 'alpha'), 'invoiced') ->> 'income_agorot')::bigint, -300::bigint,
  'get_project invoiced: it counts as negative income');
select is(pg_temp.minor_sum(public.get_project((select id from ui_ref where label = 'alpha'), 'cash'), 'excluded_income_by_currency', 'ILS'), 0::bigint,
  'get_project cash: an unpaid invoice in a kept-out income category is not in excluded_income_by_currency');
select is(pg_temp.minor_sum(public.get_project((select id from ui_ref where label = 'alpha'), 'invoiced'), 'excluded_income_by_currency', 'ILS'), -200::bigint,
  'get_project invoiced: it is listed there');
select is((public.get_dashboard(null, null, 'cash') ->> 'income_agorot')::bigint, 0::bigint,
  'get_dashboard cash: the unpaid reversal is not income');
select is((pg_temp.cur(public.get_dashboard(null, null, 'cash'), 'ILS') ->> 'income_minor')::bigint, 0::bigint,
  'get_dashboard cash, by_currency: the unpaid reversal is not income');
select is((public.get_dashboard(null, null, 'cash') ->> 'excluded_expense_agorot')::bigint, 0::bigint,
  'get_dashboard cash: an unpaid kept-out invoice is not in excluded_*');
select is((public.get_dashboard(null, null, 'invoiced') ->> 'excluded_expense_agorot')::bigint, 500::bigint,
  'get_dashboard invoiced: the unpaid kept-out invoice is in excluded_*');
select is((pg_temp.other(public.get_dashboard(null, null, 'cash'), 'USD') ->> 'expense_minor')::bigint, -1000::bigint,
  'get_dashboard cash, other_currencies: no unpaid USD invoice');
select is((pg_temp.other(public.get_home(), 'USD') ->> 'expense_minor')::bigint, -1000::bigint,
  'get_home, other_currencies: no unpaid USD invoice');

select * from finish();
rollback;
