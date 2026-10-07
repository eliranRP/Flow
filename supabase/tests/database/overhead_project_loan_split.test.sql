-- FLOW-102 review. A split loan payment filed to the overhead project moves to overhead
-- part by part, like any other line on that project (decisions 0100, 0101).
-- Invented data only, USD minor units.

begin;

select plan(5);

do $users$
begin
  perform tests.create_supabase_user('ols_owner', 'ols-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('ols_owner'), 'Example Office Loan LLC', false);

create temp table ols_ref (label text primary key, id uuid);
grant all on ols_ref to authenticated;
insert into ols_ref (label, id) select 'co', id from public.companies where name = 'Example Office Loan LLC';

insert into public.projects (company_id, name, status)
values ((select id from ols_ref where label = 'co'), 'Office', 'active');
insert into ols_ref (label, id) select 'office', id from public.projects where name = 'Office'
  and company_id = (select id from ols_ref where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default)
values ((select id from ols_ref where label = 'co'), 'Mortgage servicer', 'expense', 50, false);

insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values ((select id from ols_ref where label = 'co'), 'Example office mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'USD');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
values (
  (select id from ols_ref where label = 'co'), 'expense', 'expense', 'project', 'posted', 'USD',
  -100000, -100000, 100000, 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'ols:payment',
  (select id from ols_ref where label = 'office'),
  (select k.id from public.categories k where k.company_id = (select id from ols_ref where label = 'co') and k.name = 'Mortgage servicer'),
  'ols:payment', true
);

insert into public.loan_splits (
  company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review
)
select
  t.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount,
  (select k.id from public.categories k where k.company_id = t.company_id and k.name = v.cat and k.kind = 'expense'),
  false
from public.transactions t
join public.loans l on l.company_id = t.company_id
join (values
  ('interest',  70000, 'ריבית משכנתא'),
  ('escrow',    20000, 'מסים וביטוח'),
  ('principal', 10000, 'תשלומי הלוואה')
) as v(part, amount, cat) on true
where t.idempotency_key = 'ols:payment';

select tests.authenticate_as('ols_owner');

create function pg_temp.usd() returns jsonb
language sql
as $$
  select x from jsonb_array_elements(public.get_dashboard(null, null, 'cash') -> 'by_currency') x
  where x ->> 'currency' = 'USD'
$$;
grant execute on function pg_temp.usd() to authenticated;

select is((pg_temp.usd() ->> 'direct_minor')::bigint, 90000::bigint,
  'before: interest and escrow are the office project''s direct cost');

select public.set_overhead_project((select id from ols_ref where label = 'office'));

select is((pg_temp.usd() ->> 'overhead_minor')::bigint, 90000::bigint,
  'interest and escrow move to overhead');
select is((pg_temp.usd() ->> 'direct_minor')::bigint, 0::bigint,
  'and out of direct');
select is((pg_temp.usd() ->> 'excluded_expense_minor')::bigint, 10000::bigint,
  'the principal stays kept out');
select is(
  (public.get_project((select id from ols_ref where label = 'office'), 'cash') -> 'categories_by_currency'),
  '[]'::jsonb,
  'the overhead project''s category list leaves the parts out'
);

select * from finish();
rollback;
