-- FLOW-442. A loan payment's parts on the cash lists: each part row of cash_month_lines and
-- project_cash_month_lines carries its part and the whole payment (line_minor), so the לא נספר
-- ברווח list can say "קרן, out of the payment". Invented data only. Amounts are cents.

begin;

select plan(6);

select tests.create_supabase_user('clpl_owner', 'clpl-owner@example.com');

create temp table clpl (label text primary key, id uuid);
grant all on clpl to authenticated, service_role;

insert into clpl (label, id) values ('co', tests.fixture_company('clpl_owner', 'Example Loan Lines LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.clpl where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create or replace function pg_temp.cat(p_name text, p_kind text)
returns uuid
language sql
as $$
  select c.id from public.categories c
  where c.company_id = pg_temp.id('co') and c.name = p_name and c.kind = p_kind::public.category_kind;
$$;
grant execute on function pg_temp.cat(text, text) to authenticated, service_role;

insert into clpl (label, id) values ('harbor', tests.fixture_project(pg_temp.id('co'), 'Harbor'));
insert into clpl (label, id) values
  ('loan', tests.fixture_line(pg_temp.id('co'), 'clpl:loan', 150000, 'expense', pg_temp.id('harbor'),
    pg_temp.cat('אחר', 'expense'), '2026-06-12', p_pnl_role => null, p_doc_kind => 'expense'));

-- A 1,500.00 payment: 900.00 principal, 500.00 interest, 100.00 escrow.
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values (pg_temp.id('co'), 'Example mortgage', 12000000, 60000, 360, '2026-01-01', 150000, 10000, 'ILS');

insert into public.loan_splits (
  company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review
)
select pg_temp.id('co'), l.id, pg_temp.id('loan'), v.part::public.loan_split_part, v.amount, v.amount,
  pg_temp.cat(v.cat, 'expense'), false
from public.loans l
join (values
  ('principal', 90000, 'תשלומי הלוואה'),
  ('interest', 50000, 'ריבית משכנתא'),
  ('escrow', 10000, 'מסים וביטוח')
) as v(part, amount, cat) on true
where l.company_id = pg_temp.id('co');

create or replace function pg_temp.kept(p_page jsonb)
returns jsonb
language sql
as $$ select r from jsonb_array_elements(p_page -> 'rows') r where r ->> 'description' = 'clpl:loan'; $$;
grant execute on function pg_temp.kept(jsonb) to authenticated, service_role;

create or replace function pg_temp.part_row(p_page jsonb, p_part text)
returns jsonb
language sql
as $$ select r from jsonb_array_elements(p_page -> 'rows') r where r ->> 'description' = 'clpl:loan' and r ->> 'part' = p_part; $$;
grant execute on function pg_temp.part_row(jsonb, text) to authenticated, service_role;

select tests.authenticate_as('clpl_owner');

select is(
  pg_temp.kept(public.cash_month_lines('2026-06-01', 'not_in_profit')) ->> 'part',
  'principal',
  'the not-in-profit list''s loan row is the principal part'
);
select is(
  (pg_temp.kept(public.cash_month_lines('2026-06-01', 'not_in_profit')) ->> 'amount_minor')::bigint,
  90000::bigint,
  'its amount is the principal (positive on its side), so the list''s rows add up to its figure'
);
select is(
  (pg_temp.kept(public.cash_month_lines('2026-06-01', 'not_in_profit')) ->> 'line_minor')::bigint,
  150000::bigint,
  'line_minor is the whole payment'
);
select ok(
  pg_temp.kept(public.cash_month_lines('2026-06-01', 'not_in_profit')) -> 'parts' = 'null'::jsonb,
  'a loan part row names no split parts: the row is the part'
);
select is(
  (pg_temp.part_row(public.cash_month_lines('2026-06-01', 'out'), 'interest') ->> 'line_minor')::bigint,
  150000::bigint,
  'the interest part on יצא carries the whole payment too'
);
select is(
  (pg_temp.kept(public.project_cash_month_lines(pg_temp.id('harbor'), '2026-06-01', 'not_in_profit')) ->> 'line_minor')::bigint,
  150000::bigint,
  'the project''s not-in-profit list carries it as well'
);

select * from finish();
rollback;
