-- FLOW-102 review. A kept-out line with no bucket is in the excluded totals, not in
-- unassigned, so direct + shared + overhead + unassigned = expense still holds.
-- An unassigned loan payment is the usual case: interest and escrow are unassigned,
-- the principal is kept out. Invented data only, USD minor units.

begin;

select plan(5);

do $users$
begin
  perform tests.create_supabase_user('uko_owner', 'uko-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('uko_owner'), 'Example Kept Out LLC', false);

create temp table uko_ref (label text primary key, id uuid);
grant all on uko_ref to authenticated;
insert into uko_ref (label, id) select 'co', id from public.companies where name = 'Example Kept Out LLC';

insert into public.categories (company_id, name, kind, sort_order, is_default)
values ((select id from uko_ref where label = 'co'), 'Mortgage servicer', 'expense', 50, false);

insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values ((select id from uko_ref where label = 'co'), 'Example mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'USD');

-- A 1000.00 payment with no role and no project.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, category_id, description, user_assigned
)
values (
  (select id from uko_ref where label = 'co'), 'expense', 'expense', null, 'posted', 'USD',
  -100000, -100000, 100000, 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'uko:payment',
  (select k.id from public.categories k where k.company_id = (select id from uko_ref where label = 'co') and k.name = 'Mortgage servicer'),
  'uko:payment', true
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
where t.idempotency_key = 'uko:payment';

select tests.authenticate_as('uko_owner');

create temp table uko_out as
select x as usd
from jsonb_array_elements(public.get_dashboard(null, null, 'cash') -> 'by_currency') x
where x ->> 'currency' = 'USD';

select is((select (usd ->> 'unassigned_expense_minor')::bigint from uko_out), 90000::bigint,
  'interest and escrow are unassigned');
select is((select (usd ->> 'excluded_expense_minor')::bigint from uko_out), 10000::bigint,
  'the kept-out principal is in the excluded total');
select is((select (usd ->> 'expense_minor')::bigint from uko_out), 90000::bigint,
  'expense leaves the principal out');
select is(
  (select (usd ->> 'expense_minor')::bigint - (
     (usd ->> 'direct_minor')::bigint + (usd ->> 'shared_minor')::bigint
     + (usd ->> 'overhead_minor')::bigint + (usd ->> 'unassigned_expense_minor')::bigint)
   from uko_out),
  0::bigint,
  'direct + shared + overhead + unassigned = expense with a kept-out unassigned part'
);
select is(
  (select (usd ->> 'net_profit_minor')::bigint + (usd ->> 'unassigned_expense_minor')::bigint
     - (usd ->> 'unassigned_income_minor')::bigint + (usd ->> 'overhead_minor')::bigint
   from uko_out),
  0::bigint,
  'with no projects, net = unassigned income - unassigned expense - overhead'
);

select * from finish();
rollback;
