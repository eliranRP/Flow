-- FLOW-705 (from the #160 review). Anomaly cases the first tests left out: a pending line, two
-- loans paid to the same lender, and the median of an even and an odd history.
-- Invented data only. Amounts are agorot.

begin;

select plan(9);

do $users$
begin
  perform tests.create_supabase_user('jac_owner', 'jac-owner@example.com');
end
$users$;

create temp table jac (label text primary key, id uuid);
grant all on jac to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.jac where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into jac (label, id) values ('co', tests.fixture_company('jac_owner', 'Example Anomaly LLC'));
insert into public.suppliers (company_id, name)
select pg_temp.id('co'), n from unnest(array['Example Pending', 'Example Lender', 'Example Even', 'Example Odd']) n;
insert into jac (label, id)
select case s.name when 'Example Pending' then 's_pending' when 'Example Lender' then 's_lender'
  when 'Example Even' then 's_even' else 's_odd' end, s.id
from public.suppliers s where s.company_id = pg_temp.id('co');

-- One line per row: label, supplier, date, amount, line status.
create or replace function pg_temp.line(p_label text, p_supplier text, p_date date, p_amount bigint,
  p_status text default 'posted')
returns void
language plpgsql
as $$
declare
  line uuid;
begin
  line := tests.fixture_line(pg_temp.id('co'), 'jac:' || p_label, p_amount, p_doc_date => p_date,
    p_line_status => p_status, p_doc_kind => 'expense');
  update public.transactions set supplier_id = pg_temp.id(p_supplier) where id = line;
  insert into pg_temp.jac (label, id) values (p_label, line);
end;
$$;

create or replace function pg_temp.kinds(p_label text)
returns text
language sql
as $$
  select coalesce(string_agg(e->>'kind', ',' order by e->>'kind'), '')
  from jsonb_array_elements(public.review_anomalies(array[pg_temp.id(p_label)])) e
  where (e->>'transaction_id')::uuid = pg_temp.id(p_label);
$$;
grant execute on function pg_temp.kinds(text) to authenticated, service_role;

create or replace function pg_temp.typical(p_label text)
returns bigint
language sql
as $$
  select (e->>'typical_amount_minor')::bigint
  from jsonb_array_elements(public.review_anomalies(array[pg_temp.id(p_label)])) e
  where (e->>'transaction_id')::uuid = pg_temp.id(p_label) and e->>'kind' = 'amount_spike';
$$;
grant execute on function pg_temp.typical(text) to authenticated, service_role;

-- A pending line. Three posted lines of 100.00 and one pending one of 5000.00 before a
-- line of 400.00: the pending line is not history, so 400.00 is a spike against 100.00.
select pg_temp.line('p1', 's_pending', '2026-01-10', 10000);
select pg_temp.line('p2', 's_pending', '2026-02-10', 10000);
select pg_temp.line('p3', 's_pending', '2026-03-10', 10000);
select pg_temp.line('p_pend', 's_pending', '2026-03-20', 500000, 'pending');
select pg_temp.line('p4', 's_pending', '2026-04-10', 40000);
-- A pending copy of a posted line two days later.
select pg_temp.line('p4_copy', 's_pending', '2026-04-12', 40000, 'pending');

-- Two loans with the same lender, each paid 1000.00 two days apart; then a second payment
-- of the first loan a day after its first.
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values
  (pg_temp.id('co'), 'Example loan A', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'ILS'),
  (pg_temp.id('co'), 'Example loan B', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'ILS');
insert into jac (label, id) select 'loan_' || right(name, 1), id from public.loans where company_id = pg_temp.id('co');
select pg_temp.line('la', 's_lender', '2026-05-01', 100000);
select pg_temp.line('lb', 's_lender', '2026-05-03', 100000);
select pg_temp.line('la2', 's_lender', '2026-05-02', 100000);

create or replace function pg_temp.attach(p_label text, p_loan text)
returns void
language sql
as $$
  insert into public.loan_splits (
    company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review
  )
  select pg_temp.id('co'), pg_temp.id(p_loan), pg_temp.id(p_label), v.part::public.loan_split_part, v.amount, v.amount,
    (select c.id from public.categories c where c.company_id = pg_temp.id('co') and c.loan_part = v.part::public.loan_split_part),
    false
  from (values ('interest', 70000), ('escrow', 20000), ('principal', 10000)) as v(part, amount);
$$;
select pg_temp.attach('la', 'loan_A');
select pg_temp.attach('lb', 'loan_B');
select pg_temp.attach('la2', 'loan_A');

-- An even history (100, 100, 400, 400): the median is the lower middle, 100.00. An odd one
-- (100, 200, 900): the middle, 200.00.
select pg_temp.line('e1', 's_even', '2026-01-05', 10000);
select pg_temp.line('e2', 's_even', '2026-02-05', 10000);
select pg_temp.line('e3', 's_even', '2026-03-05', 40000);
select pg_temp.line('e4', 's_even', '2026-04-05', 40000);
select pg_temp.line('e5', 's_even', '2026-05-05', 40000);
select pg_temp.line('o1', 's_odd', '2026-01-07', 10000);
select pg_temp.line('o2', 's_odd', '2026-02-07', 20000);
select pg_temp.line('o3', 's_odd', '2026-03-07', 90000);
select pg_temp.line('o4', 's_odd', '2026-04-07', 70000);

select tests.authenticate_as('jac_owner');

select is(pg_temp.kinds('p4'), 'amount_spike', 'a pending line is not history: 400.00 is a spike against 100.00');
select is(pg_temp.typical('p4'), 10000::bigint, 'the typical amount leaves the pending line out');
select ok(pg_temp.kinds('p4_copy') like '%duplicate%', 'a pending line is checked against posted lines');
select ok(pg_temp.kinds('p4') not like '%duplicate%', 'a posted line is not a duplicate of a pending copy');

select ok(pg_temp.kinds('lb') not like '%duplicate%', 'two loans'' payments to one lender are not duplicates');
select ok(pg_temp.kinds('la2') like '%duplicate%', 'two payments of the same loan days apart are');

select is(pg_temp.typical('e5'), 10000::bigint, 'an even history takes the lower middle as typical');
select is(pg_temp.typical('o4'), 20000::bigint, 'an odd history takes the middle');
select is(pg_temp.kinds('o4'), 'amount_spike', 'so 700.00 is a spike against 200.00');

select * from finish();
rollback;
