-- FLOW-1306: public.loan_schedule_rows and public.loan_schedule_meta follow every write to loans and loan_rates in the
-- same transaction, and equal private.loan_schedule of the loan's terms; a closed loan has none, a deleted loan's rows
-- cascade away; RLS reads them as the loans (another company's member sees nothing) and authenticated cannot write.
-- The function's own answers are pinned by the shared vectors (vectors_loan_schedule.test.sql).
-- Invented loans, fixed dates, @example.com only.

begin;

select plan(32);

do $users$
begin
  perform tests.create_supabase_user('f1306_owner', 'owner1306@example.com');
  perform tests.create_supabase_user('f1306_other', 'other1306@example.com');
end
$users$;

create temp table f1306 (label text primary key, id uuid);
grant all on f1306 to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
set search_path = ''
as $$
  select id from pg_temp.f1306 where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- The stored rows of a loan in the vectors' shape, so they compare with private.loan_schedule(...) -> 'rows'.
create or replace function pg_temp.stored(p_loan uuid)
returns jsonb
language sql
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'period', r.period,
    'dueDate', to_char(r.due_date, 'YYYY-MM-DD'),
    'interestMinor', r.interest_minor,
    'escrowMinor', r.escrow_minor,
    'principalMinor', r.principal_minor,
    'paymentMinor', r.payment_minor,
    'balanceMinor', r.balance_minor
  ) order by r.period), '[]'::jsonb)
  from public.loan_schedule_rows r
  where r.loan_id = p_loan;
$$;
grant execute on function pg_temp.stored(uuid) to authenticated, service_role;

-- The terms of the test's loan A1 as JSON, with the given term, payment and rates.
create or replace function pg_temp.terms(p_term integer, p_payment bigint, p_rates jsonb default '[]')
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_build_object(
    'principalMinor', 12000000, 'annualRatePpm', 60000, 'termMonths', p_term, 'startDate', '2026-01-31',
    'paymentMinor', p_payment, 'escrowMinor', 5000, 'kind', 'amortizing', 'rates', p_rates
  );
$$;

do $setup$
declare
  a uuid;
  b uuid;
  loan uuid;
begin
  a := tests.fixture_company('f1306_owner', 'Example Holdings 1306');
  b := tests.fixture_company('f1306_other', 'Sample Rentals 1306');
  insert into pg_temp.f1306 values ('a', a), ('b', b);
  insert into public.loans (
    company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency
  )
  values (a, 'Example Mortgage 1306', 12000000, 60000, 24, '2026-01-31',
    private.loan_schedule_payment(12000000, 60000, 24) + 5000, 5000, 'USD')
  returning id into loan;
  insert into pg_temp.f1306 values ('a1', loan);
  insert into public.loans (
    company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency
  )
  values (b, 'Sample Loan 1306', 5000000, 48000, 12, '2026-03-01',
    private.loan_schedule_payment(5000000, 48000, 12), 0, 'USD')
  returning id into loan;
  insert into pg_temp.f1306 values ('b1', loan);
  insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor,
    escrow_minor, currency, kind)
  values (a, 'Example Demand Loan 1306', 3000000, 50000, null, '2026-01-01', null, 0, 'USD', 'demand')
  returning id into loan;
  insert into pg_temp.f1306 values ('a_demand', loan);
end
$setup$;

-- A loan's insert.
select is(
  (select state from public.loan_schedule_meta where loan_id = pg_temp.id('a1')),
  'built',
  'insert: the new loan''s schedule is built'
);
select is(
  pg_temp.stored(pg_temp.id('a1')),
  private.loan_schedule(pg_temp.terms(24, private.loan_schedule_payment(12000000, 60000, 24) + 5000)) -> 'rows',
  'insert: the stored rows equal private.loan_schedule of its terms'
);
select is(
  (select array[to_char(min(due_date), 'YYYY-MM-DD'), to_char(max(due_date) filter (where period = 2), 'YYYY-MM-DD'),
    max(balance_minor) filter (where period = 24)::text]
   from public.loan_schedule_rows where loan_id = pg_temp.id('a1')),
  array['2026-01-31', '2026-02-28', '0'],
  'insert: 24 rows from the start date, the 31st capped in February, the last one clearing the loan'
);
select is(
  (select array[state, coalesce(error, '-')] from public.loan_schedule_meta where loan_id = pg_temp.id('a_demand')),
  array['none', '-'],
  'insert: a demand loan has a meta row and no schedule'
);
select is(
  (select count(*)::integer from public.loan_schedule_rows where loan_id = pg_temp.id('a_demand')),
  0,
  'insert: a demand loan has no rows'
);

-- A rate added.
insert into public.loan_rates (company_id, loan_id, effective_date, annual_rate_ppm)
values (pg_temp.id('a'), pg_temp.id('a1'), '2026-07-01', 72000);
insert into pg_temp.f1306 select 'rate', id from public.loan_rates where loan_id = pg_temp.id('a1');
select is(
  pg_temp.stored(pg_temp.id('a1')),
  private.loan_schedule(pg_temp.terms(24, private.loan_schedule_payment(12000000, 60000, 24) + 5000,
    '[{"effectiveDate": "2026-07-01", "annualRatePpm": 72000}]')) -> 'rows',
  'rate added: the rows equal the schedule with the rate'
);
select ok(
  (select interest_minor from public.loan_schedule_rows where loan_id = pg_temp.id('a1') and period = 7)
    > (select div(balance_minor * 60000, 12000000) + 1 from public.loan_schedule_rows
       where loan_id = pg_temp.id('a1') and period = 6),
  'rate added: July''s interest is at the higher rate'
);

-- A rate changed.
update public.loan_rates set annual_rate_ppm = 30000 where id = pg_temp.id('rate');
select is(
  pg_temp.stored(pg_temp.id('a1')),
  private.loan_schedule(pg_temp.terms(24, private.loan_schedule_payment(12000000, 60000, 24) + 5000,
    '[{"effectiveDate": "2026-07-01", "annualRatePpm": 30000}]')) -> 'rows',
  'rate changed: the rows follow the new rate'
);
update public.loan_rates set effective_date = '2026-10-01' where id = pg_temp.id('rate');
select is(
  pg_temp.stored(pg_temp.id('a1')),
  private.loan_schedule(pg_temp.terms(24, private.loan_schedule_payment(12000000, 60000, 24) + 5000,
    '[{"effectiveDate": "2026-10-01", "annualRatePpm": 30000}]')) -> 'rows',
  'rate changed: the rows follow the new date'
);

-- A rate deleted.
delete from public.loan_rates where id = pg_temp.id('rate');
select is(
  pg_temp.stored(pg_temp.id('a1')),
  private.loan_schedule(pg_temp.terms(24, private.loan_schedule_payment(12000000, 60000, 24) + 5000)) -> 'rows',
  'rate deleted: the rows are the loan''s own terms again'
);

-- A term changed.
update public.loans
set term_months = 36, payment_minor = private.loan_schedule_payment(12000000, 60000, 36) + 5000
where id = pg_temp.id('a1');
select is(
  pg_temp.stored(pg_temp.id('a1')),
  private.loan_schedule(pg_temp.terms(36, private.loan_schedule_payment(12000000, 60000, 36) + 5000)) -> 'rows',
  'term changed: the rows equal the schedule of the new terms'
);
select is(
  (select count(*)::integer from public.loan_schedule_rows where loan_id = pg_temp.id('a1')),
  36,
  'term changed: 36 rows'
);
select is(
  (select terms_hash from public.loan_schedule_meta where loan_id = pg_temp.id('a1')),
  md5((pg_temp.terms(36, private.loan_schedule_payment(12000000, 60000, 36) + 5000)
    || '{"interestOnlyMonths": null, "amortizationMonths": null}')::text),
  'term changed: terms_hash is the hash of the new terms'
);
-- A payment below the term's annuity: an implicit balloon, kept in the meta row.
update public.loans set payment_minor = 300000 where id = pg_temp.id('a1');
-- The ratio is compared as a double: this session's extra_float_digits may print it shorter.
select ok(
  (select m.balloon_minor = (s.b ->> 'amountMinor')::bigint and m.balloon_ratio = (s.b ->> 'ratioToPayment')::double precision
   from public.loan_schedule_meta m, (select private.loan_schedule(pg_temp.terms(36, 300000)) -> 'balloon' as b) s
   where m.loan_id = pg_temp.id('a1')),
  'term changed: a balloon is stored as the schedule gives it'
);
select ok(
  (select balloon_minor > 300000 from public.loan_schedule_meta where loan_id = pg_temp.id('a1')),
  'term changed: the balloon is above the regular payment'
);

-- An update of no term column does not rebuild (the trigger's column list and when clause).
delete from public.loan_schedule_rows where loan_id = pg_temp.id('a1');
update public.loans set name = 'Example Mortgage 1306 renamed', sort_order = 3 where id = pg_temp.id('a1');
select is(
  (select count(*)::integer from public.loan_schedule_rows where loan_id = pg_temp.id('a1')),
  0,
  'a name change does not rebuild the schedule'
);
update public.loans set payment_minor = private.loan_schedule_payment(12000000, 60000, 36) + 5000
where id = pg_temp.id('a1');
select is(
  (select count(*)::integer from public.loan_schedule_rows where loan_id = pg_temp.id('a1')),
  36,
  'a payment change rebuilds it'
);

-- Terms the schedule refuses: the meta row holds the code and there are no rows. The payment check trigger would
-- refuse this payment first; it is off for this one write, in this transaction only.
alter table public.loans disable trigger loans_payment_covers_interest;
update public.loans set payment_minor = 50000 where id = pg_temp.id('a1');
alter table public.loans enable trigger loans_payment_covers_interest;
select is(
  (select array[state, error] from public.loan_schedule_meta where loan_id = pg_temp.id('a1')),
  array['refused', 'payment_below_interest'],
  'refused terms: the meta row holds the error code'
);
select is(
  (select count(*)::integer from public.loan_schedule_rows where loan_id = pg_temp.id('a1')),
  0,
  'refused terms: no rows'
);
update public.loans set payment_minor = private.loan_schedule_payment(12000000, 60000, 36) + 5000
where id = pg_temp.id('a1');

-- A loan closed, then opened again.
update public.loans set status = 'closed', closed_on = '2026-06-30' where id = pg_temp.id('a1');
select is(
  (select array[state, (select count(*) from public.loan_schedule_rows where loan_id = pg_temp.id('a1'))::text]
   from public.loan_schedule_meta where loan_id = pg_temp.id('a1')),
  array['none', '0'],
  'loan closed: no schedule and no rows'
);
update public.loans set status = 'open', closed_on = null where id = pg_temp.id('a1');
select is(
  (select array[state, (select count(*) from public.loan_schedule_rows where loan_id = pg_temp.id('a1'))::text]
   from public.loan_schedule_meta where loan_id = pg_temp.id('a1')),
  array['built', '36'],
  'loan opened again: built'
);

-- RLS: the owner reads its loans' rows, another company's member reads none of them, and nobody writes.
select tests.authenticate_as('f1306_owner');
select is(
  (select count(*)::integer from public.loan_schedule_rows where loan_id = pg_temp.id('a1')),
  36,
  'RLS: the owner reads its loan''s rows'
);
select is(
  (select count(*)::integer from public.loan_schedule_meta),
  2,
  'RLS: the owner reads its two loans'' meta rows and not the other company''s'
);
select throws_ok(
  format($q$insert into public.loan_schedule_rows (company_id, loan_id, period, due_date, interest_minor, escrow_minor,
    principal_minor, payment_minor, balance_minor) values (%L, %L, 99, '2030-01-01', 0, 0, 0, 0, 0)$q$,
    pg_temp.id('a'), pg_temp.id('a1')),
  '42501',
  null,
  'authenticated cannot insert schedule rows'
);
select throws_ok(
  format('update public.loan_schedule_rows set payment_minor = 1 where loan_id = %L', pg_temp.id('a1')),
  '42501',
  null,
  'authenticated cannot update schedule rows'
);
select throws_ok(
  format('delete from public.loan_schedule_meta where loan_id = %L', pg_temp.id('a1')),
  '42501',
  null,
  'authenticated cannot delete a meta row'
);
select tests.authenticate_as('f1306_other');
select is(
  (select count(*)::integer from public.loan_schedule_rows where company_id = pg_temp.id('a'))
    + (select count(*)::integer from public.loan_schedule_meta where company_id = pg_temp.id('a')),
  0,
  'RLS: another company''s member sees none of company A''s schedule'
);
select is(
  (select count(*)::integer from public.loan_schedule_rows),
  12,
  'RLS: that member sees its own loan''s 12 rows'
);
select tests.clear_authentication();
reset role;

select ok(
  has_function_privilege('authenticated', 'private.loan_schedule(jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'private.loan_schedule_rebuild(uuid)', 'execute')
    and not has_function_privilege('anon', 'private.loan_schedule(jsonb)', 'execute'),
  'authenticated may run the pure schedule, not the rebuild; anon neither'
);

-- A loan deleted: its rates go with it (a rate's delete finds no loan to rebuild) and its rows cascade.
insert into public.loan_rates (company_id, loan_id, effective_date, annual_rate_ppm)
values (pg_temp.id('a'), pg_temp.id('a1'), '2026-09-01', 66000);
delete from public.loans where id = pg_temp.id('a1');
select is(
  (select count(*)::integer from public.loan_schedule_rows where loan_id = pg_temp.id('a1'))
    + (select count(*)::integer from public.loan_schedule_meta where loan_id = pg_temp.id('a1')),
  0,
  'loan deleted: its rows and meta row are gone'
);
select is(
  (select count(*)::integer from public.loan_schedule_rows where loan_id = pg_temp.id('b1')),
  12,
  'loan deleted: another loan keeps its rows'
);

-- The rebuild of a loan that does not exist does nothing.
select lives_ok(
  format('select private.loan_schedule_rebuild(%L)', pg_temp.id('a1')),
  'a rebuild of a deleted loan does nothing'
);

select * from finish();
rollback;
