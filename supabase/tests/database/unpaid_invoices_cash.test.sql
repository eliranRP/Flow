-- FLOW-128: an unpaid supplier invoice stays out of the cash basis (decision 0118).
-- On the invoiced basis it counts by its document date. Every other expense keeps its date.

begin;

select plan(20);

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

create function pg_temp.cat_sum(p jsonb) returns bigint
language sql immutable
as $$ select coalesce(sum((x ->> 'amount_agorot')::bigint), 0)::bigint from jsonb_array_elements(p -> 'categories') x $$;

grant execute on function pg_temp.cur(jsonb, text), pg_temp.proj(jsonb, text), pg_temp.total(jsonb, text),
  pg_temp.cat_sum(jsonb) to authenticated;

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

select * from finish();
rollback;
