-- Profit by month (decision 0129): get_profit_months adds up to company_pnl and get_project for
-- the same range, get_project and list_project_category take a range, and the overhead split
-- weights by the basis' own income (FLOW-409).

begin;

select plan(22);

do $users$
begin
  perform tests.create_supabase_user('pm_owner', 'pm-owner@example.com');
  perform tests.create_supabase_user('pm_other', 'pm-other@example.com');
end
$users$;

create temp table pm_ref (label text primary key, id uuid);
grant all on pm_ref to authenticated;

select tests.authenticate_as('pm_owner');
select public.create_company('Example Builders LLC', true);
select public.upsert_project(null, 'Site Alpha', null, 'active');
select public.upsert_project(null, 'Site Beta', null, 'active');
insert into pm_ref (label, id) select 'co', id from public.companies where name = 'Example Builders LLC';
insert into pm_ref (label, id) select 'alpha', id from public.projects where name = 'Site Alpha';
insert into pm_ref (label, id) select 'beta', id from public.projects where name = 'Site Beta';
insert into pm_ref (label, id)
select 'cat', c.id from public.categories c
where c.company_id = (select id from pm_ref where label = 'co')
  and c.kind = 'expense' and not c.excluded_from_pnl and c.loan_part is null
order by c.name
limit 1;

reset role;

-- Invented, round amounts. Alpha's July invoice is paid in August (a separate receipt), so the
-- bases put Alpha's income in different months.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select
  (select id from pm_ref where label = 'co'),
  v.dir::public.txn_direction, v.doc_kind::public.doc_kind, v.role::public.pnl_role, 'posted', v.currency,
  v.amount, v.amount, abs(v.amount), 0, 'source',
  v.doc_date::date, v.cash_date::date,
  'manual', 'pm:' || v.ikey,
  (select id from pm_ref where label = v.project),
  case when v.dir = 'expense' then (select id from pm_ref where label = 'cat') end,
  v.ikey,
  true
from (values
  ('income', 'invoice', null, 'ILS', 150000, '2026-07-15', null, 'alpha', 'alpha-invoice'),
  ('income', 'receipt', null, 'ILS', 100000, '2026-07-15', '2026-08-03', 'alpha', 'alpha-receipt'),
  ('income', 'invoice_receipt', null, 'ILS', 60000, '2026-08-20', '2026-08-20', 'alpha', 'alpha-ir'),
  ('expense', 'expense', 'project', 'ILS', -30000, '2026-07-10', '2026-07-10', 'alpha', 'alpha-july-cost'),
  ('expense', 'expense', 'project', 'ILS', -90000, '2026-08-05', '2026-08-05', 'alpha', 'alpha-august-cost'),
  ('income', 'invoice_receipt', null, 'ILS', 160000, '2026-09-02', '2026-09-02', 'beta', 'beta-ir'),
  ('expense', 'expense', 'project', 'ILS', -10000, '2026-09-03', '2026-09-03', 'beta', 'beta-cost'),
  ('expense', 'expense', 'shared', 'ILS', -20000, '2026-08-15', '2026-08-15', null, 'shared-cost'),
  ('expense', 'expense', 'overhead', 'ILS', -120000, '2026-08-25', '2026-08-25', null, 'overhead'),
  ('income', 'invoice_receipt', null, 'USD', 5000, '2026-09-10', '2026-09-10', 'alpha', 'alpha-usd'),
  ('income', 'invoice_receipt', null, 'ILS', 7000, '2026-09-12', '2026-09-12', null, 'unassigned-income')
) as v(dir, doc_kind, role, currency, amount, doc_date, cash_date, project, ikey);

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select (select id from pm_ref where label = 'co'),
  (select id from public.transactions where idempotency_key = 'pm:shared-cost'),
  (select id from pm_ref where label = v.p), v.bp, v.amount
from (values ('alpha', 7500, -15000), ('beta', 2500, -5000)) as v(p, bp, amount);

select tests.authenticate_as('pm_owner');

create temp table pm_sum as
select b.basis, c->>'currency' as currency,
  sum((c->>'income_minor')::bigint)::bigint as income_minor,
  sum((c->>'expense_minor')::bigint)::bigint as expense_minor,
  sum((c->>'profit_minor')::bigint)::bigint as profit_minor
from (values ('cash'), ('invoiced')) as b(basis)
cross join lateral jsonb_array_elements(public.get_profit_months('2026-07-01', '2026-09-30', b.basis) -> 'months') m
cross join lateral jsonb_array_elements(m -> 'by_currency') c
group by b.basis, c->>'currency';

create temp table pm_pnl as
select b.basis, c->>'currency' as currency,
  (c->>'income_minor')::bigint as income_minor,
  (c->>'expense_minor')::bigint as expense_minor,
  (c->>'net_profit_minor')::bigint as profit_minor
from (values ('cash'), ('invoiced')) as b(basis)
cross join lateral jsonb_array_elements(
  public.company_pnl((select id from pm_ref where label = 'co'), '2026-07-01', '2026-09-30', b.basis) -> 'by_currency'
) c;

select results_eq(
  'select basis, currency, income_minor, expense_minor, profit_minor from pm_sum order by 1, 2',
  'select basis, currency, income_minor, expense_minor, profit_minor from pm_pnl order by 1, 2',
  'company: the months add up to company_pnl for the range, per basis and currency'
);

select is(
  jsonb_path_query_array(public.get_profit_months('2026-07-01', '2026-09-30', 'cash') -> 'months', '$[*].month'),
  '["2026-09", "2026-08", "2026-07"]'::jsonb,
  'every month of the range, newest first'
);

select is(
  (public.get_profit_months('2026-07-01', '2026-09-30', 'cash') #>> '{months,1,by_currency,0,profit_minor}')::bigint,
  (public.company_pnl((select id from pm_ref where label = 'co'), '2026-08-01', '2026-08-31', 'cash') #>> '{by_currency,0,net_profit_minor}')::bigint,
  'company: one month matches company_pnl for that month'
);

select is(
  (public.get_profit_months('2026-07-01', '2026-09-30', 'cash') #>> '{months,2,by_currency,0,income_minor}')::bigint,
  0::bigint,
  'cash: the July invoice counts in August, when it was paid'
);

select is(
  (public.get_profit_months('2026-07-01', '2026-09-30', 'invoiced') #>> '{months,2,by_currency,0,income_minor}')::bigint,
  150000::bigint,
  'invoiced: the July invoice counts in July'
);

select is(
  jsonb_array_length(public.get_profit_months('2026-07-01', '2026-07-31', 'cash') #> '{months,0,by_currency}'),
  1,
  'a month with no lines still has its ILS row'
);

select is(
  public.get_profit_months('2026-08-10', '2026-09-05', 'cash') #>> '{months,1,from}',
  '2026-08-10',
  'a month cut by the range starts at the range'
);

-- One project.
create temp table pm_alpha as
select b.basis,
  (select sum((c->>'profit_minor')::bigint)::bigint
   from jsonb_array_elements(public.get_profit_months('2026-07-01', '2026-09-30', b.basis, (select id from pm_ref where label = 'alpha')) -> 'months') m
   cross join lateral jsonb_array_elements(m -> 'by_currency') c
   where c->>'currency' = 'ILS') as months_profit,
  (public.get_project((select id from pm_ref where label = 'alpha'), b.basis, '2026-07-01', '2026-09-30') ->> 'profit_agorot')::bigint as project_profit
from (values ('cash'), ('invoiced')) as b(basis);

select is((select months_profit from pm_alpha where basis = 'cash'), (select project_profit from pm_alpha where basis = 'cash'),
  'project, cash: the months add up to get_project for the range');
select is((select months_profit from pm_alpha where basis = 'invoiced'), (select project_profit from pm_alpha where basis = 'invoiced'),
  'project, invoiced: the months add up to get_project for the range');
select is((select project_profit from pm_alpha where basis = 'cash'), 25000::bigint,
  'project, cash: 160,000 income less 120,000 direct and 15,000 shared');

select is(
  (public.get_profit_months('2026-07-01', '2026-09-30', 'cash', (select id from pm_ref where label = 'alpha')) #>> '{months,0,by_currency,1,currency}'),
  'USD',
  'project: a second currency gets its own row after ILS'
);

-- get_project for one month agrees with company_pnl's project row for that month.
select is(
  (public.get_project((select id from pm_ref where label = 'alpha'), 'cash', '2026-08-01', '2026-08-31') ->> 'profit_agorot')::bigint,
  (select (p->>'profit_agorot')::bigint
   from jsonb_array_elements(public.company_pnl((select id from pm_ref where label = 'co'), '2026-08-01', '2026-08-31', 'cash') -> 'projects') p
   where p->>'id' = (select id::text from pm_ref where label = 'alpha')),
  'get_project for a month matches company_pnl''s project row'
);
select is(
  (public.get_project((select id from pm_ref where label = 'alpha'), 'invoiced', '2026-08-01', '2026-08-31') ->> 'income_agorot')::bigint,
  60000::bigint,
  'get_project, invoiced: only August''s invoice counts in August'
);
select is(
  jsonb_array_length(public.get_project((select id from pm_ref where label = 'alpha'), 'cash', '2026-08-01', '2026-08-31') -> 'transactions'),
  4,
  'get_project: the lines are the range''s lines'
);
select is(
  (public.get_project((select id from pm_ref where label = 'alpha'), 'cash', '2026-08-01', '2026-08-31') #>> '{categories,0,amount_agorot}')::bigint,
  105000::bigint,
  'get_project: the categories are the range''s'
);
select is(
  public.get_project((select id from pm_ref where label = 'alpha'), 'cash') -> 'transactions',
  public.get_project((select id from pm_ref where label = 'alpha'), 'cash', null, null) -> 'transactions',
  'the two-argument get_project is all time'
);

select is(
  (public.list_project_category((select id from pm_ref where label = 'alpha'), (select id from pm_ref where label = 'cat'), p_from => '2026-07-01', p_to => '2026-07-31') ->> 'total_agorot')::bigint,
  30000::bigint,
  'list_project_category: the range''s lines only'
);

-- Overhead: weights follow the basis (FLOW-409) and the range.
select is(
  (public.get_project((select id from pm_ref where label = 'alpha'), 'cash') ->> 'overhead_share_agorot')::bigint,
  60000::bigint,
  'cash: weighted by paid income, half each'
);
select is(
  (public.get_project((select id from pm_ref where label = 'alpha'), 'invoiced') ->> 'overhead_share_agorot')::bigint,
  70000::bigint,
  'invoiced: weighted by invoiced income'
);
select is(
  (public.get_profit_months('2026-07-01', '2026-09-30', 'cash', (select id from pm_ref where label = 'alpha')) #>> '{months,1,overhead_share_agorot}')::bigint,
  120000::bigint,
  'per month: August''s overhead follows August''s income, all Alpha''s'
);

select throws_ok(
  $$ select public.get_profit_months('2026-07-01', null, 'cash') $$,
  '22023', 'invalid range',
  'one date is refused'
);

select tests.authenticate_as('pm_other');
select is(
  public.get_profit_months('2026-07-01', '2026-09-30', 'cash', (select id from pm_ref where label = 'alpha')),
  null,
  'another company''s project is not found'
);

select * from finish();
rollback;
