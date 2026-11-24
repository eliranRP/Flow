-- FLOW-1310: public.loan_outlooks, the Loans list's outlooks in one read.
-- - On fixture loans written like the shared vectors' (packages/shared/fixtures/vectors/loan-outlook), each loan's answer
--   equals the vector's expected: the figures app/src/screens/loan-outlook.ts gives (loan-outlook-vectors.test.ts runs
--   the same vectors through it). The balance comes from real payment splits, the schedule from the stored
--   loan_schedule_rows, so the read's own gathering is checked, not only the core (vectors_loan_outlook.test.sql).
-- - A demand loan, a closed one, one with a zero balance and one whose terms the schedule refuses are left out.
-- - FLOW-1258's late rule on a stored schedule: due 12-01, last paid 11-05: not late on 12-11, late on 12-12.
-- - FLOW-1264: an unsplit bank line that matches the payment counts as paid.
-- - p_today: the day boundary (a payment due 11-01 is next on 11-01 and not on 11-02); null is today in Israel.
-- - Another company's member sees none of the company's loans; anon is refused; the answer is jsonb absent = null.
-- Invented loans, fixed dates, @example.com only. Amounts are minor units.

begin;

select plan(23);

do $users$
begin
  perform tests.create_supabase_user('f1310_owner', 'owner1310@example.com');
  perform tests.create_supabase_user('f1310_other', 'other1310@example.com');
end
$users$;

create temp table f1310 (label text primary key, id uuid);
grant all on f1310 to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql set search_path = '' as $$
  select id from pg_temp.f1310 where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- The loan's answer for a day, without its id; null when the read leaves the loan out.
create function pg_temp.answer(p_label text, p_today date) returns jsonb language sql set search_path = '' as $$
  select o - 'loan_id'
  from jsonb_array_elements(public.loan_outlooks(p_today)) o
  where o ->> 'loan_id' = pg_temp.id(p_label)::text;
$$;
grant execute on function pg_temp.answer(text, date) to authenticated, service_role;

do $setup$
declare
  a uuid;
  b uuid;
  loan uuid;
  supplier uuid;
begin
  a := tests.fixture_company('f1310_owner', 'Example Holdings 1310');
  b := tests.fixture_company('f1310_other', 'Sample Rentals 1310');
  insert into pg_temp.f1310 values ('a', a), ('b', b);

  -- name, principal, rate ppm, term, start, payment, escrow, kind, interest only months, amortization months
  insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor,
    escrow_minor, currency, kind, interest_only_months, amortization_months)
  select a, v.name, v.principal, v.rate, v.term, v.start::date, v.payment, v.escrow, 'USD', v.kind::public.loan_kind, v.io, v.am
  from (values
    ('mortgage', 24000000, 62500, 360, '2025-01-01', 524000, 36300, 'amortizing', null::integer, null::integer),
    ('late_mortgage', 24000000, 62500, 360, '2025-01-01', 524000, 36300, 'amortizing', null, null),
    ('note', 10000000, 65000, 60, '2026-07-01', 63207, 0, 'balloon', null, 360),
    ('bridge', 21000000, 105000, 7, '2026-07-01', 183750, 0, 'interest_only', 7, null),
    ('fresh', 24000000, 62500, 360, '2026-10-01', 524000, 36300, 'amortizing', null, null),
    ('paid_down', 100000, 60000, 12, '2026-01-01', 8607, 0, 'amortizing', null, null),
    ('closed', 24000000, 62500, 360, '2025-01-01', 524000, 36300, 'amortizing', null, null),
    ('unsplit', 1200000, 60000, 24, ((now() at time zone 'Asia/Jerusalem')::date - 45)::text, 100000, 0, 'amortizing', null, null)
  ) v(name, principal, rate, term, start, payment, escrow, kind, io, am);
  -- A payment below the interest: the payment check would refuse it first, so it is off for this one insert (as in
  -- flow_1306_loan_schedule.test.sql); the schedule refuses it and its state is 'refused'.
  alter table public.loans disable trigger loans_payment_covers_interest;
  insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor,
    escrow_minor, currency, kind)
  values (a, 'refused', 24000000, 62500, 360, '2025-01-01', 100000, 36300, 'USD', 'amortizing');
  alter table public.loans enable trigger loans_payment_covers_interest;
  insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, start_date, escrow_minor, currency, kind)
  values (a, 'demand', 4000000, 60000, '2025-11-01', 0, 'USD', 'demand');
  insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor,
    escrow_minor, currency, kind)
  values (b, 'other_mortgage', 24000000, 62500, 360, '2025-01-01', 524000, 36300, 'USD', 'amortizing');
  insert into pg_temp.f1310 select l.name, l.id from public.loans l;

  -- A loan marked closed has no schedule rows (FLOW-1306): its status is changed after the insert.
  update public.loans set status = 'closed', closed_on = '2026-06-30' where name = 'closed';
  -- The day each was added, in Israel time (a late check with no payment reads it).
  update public.loans set created_at = '2026-09-02 12:00:00+00' where name = 'bridge';
  update public.loans set created_at = '2026-09-20 12:00:00+00' where name = 'fresh';
  update public.loans set created_at = '2025-01-02 12:00:00+00' where name in ('mortgage', 'late_mortgage', 'note', 'paid_down', 'refused');
  update public.loans set created_at = now() - interval '60 days' where name = 'unsplit';

  -- A payment of each part (a split needs all three), by loan: label, doc date, principal paid.
  create temp table f1310_pay (label text, doc_date date, principal bigint);
  insert into f1310_pay values
    ('mortgage', '2026-10-07', 6350000), ('late_mortgage', '2026-11-05', 6350000), ('note', '2026-10-01', 387960),
    ('paid_down', '2026-06-01', 100000),
    ('unsplit', (now() at time zone 'Asia/Jerusalem')::date - 60, 100000);
  insert into public.suppliers (company_id, name) values (a, 'Example Lender Servicing');
  select id into supplier from public.suppliers where company_id = a and name = 'Example Lender Servicing';
  perform tests.fixture_line(a, 'f1310:' || p.label, p.principal + 200, 'expense', null, null, p.doc_date, 'USD')
  from f1310_pay p;
  update public.transactions t set supplier_id = supplier
  where t.company_id = a and t.idempotency_key = 'f1310:unsplit';
  perform tests.loan_split(t.id, pg_temp.id(p.label), jsonb_build_array(
    jsonb_build_object('part', 'interest', 'amount_minor', 100, 'scheduled_minor', 100,
      'category_id', (select c.id from public.categories c where c.company_id = a and c.loan_part = 'interest' limit 1)),
    jsonb_build_object('part', 'escrow', 'amount_minor', 100, 'scheduled_minor', 100,
      'category_id', (select c.id from public.categories c where c.company_id = a and c.loan_part = 'escrow' limit 1)),
    jsonb_build_object('part', 'principal', 'amount_minor', p.principal, 'scheduled_minor', p.principal,
      'category_id', (select c.id from public.categories c where c.company_id = a and c.loan_part = 'principal' limit 1))))
  from f1310_pay p
  join public.transactions t on t.company_id = a and t.idempotency_key = 'f1310:' || p.label;
end
$setup$;

-- The balances the vectors have: 17,650,000 on the mortgages, 9,612,040 on the note, nothing paid on the bridge.
select is(
  (select array_agg(b.balance_minor order by l.name) from public.loan_balances b join public.loans l on l.id = b.loan_id
   where l.name in ('late_mortgage', 'mortgage', 'note', 'bridge')),
  array[21000000, 17650000, 17650000, 9612040]::bigint[],
  'the fixture balances come from the splits: the bridge 21,000,000, two mortgages 17,650,000, the note 9,612,040'
);

select tests.authenticate_as('f1310_owner');

-- Vector amortizing-next-from-today.
select is(
  pg_temp.answer('mortgage', '2026-10-09'),
  '{"next":{"due_date":"2026-11-01","amount_minor":524000,"escrow_minor":36300,"interest_minor":91927,"principal_minor":395773},"end_date":"2030-03-01","ahead_minor":6288000,"to_end_minor":21096698}'::jsonb,
  'the mortgage: next payment, the next 12, to the end, the end date (vector amortizing-next-from-today)'
);

-- Vector balloon-ends-at-the-term.
select is(
  pg_temp.answer('note', '2026-10-09'),
  '{"next":{"due_date":"2026-11-01","amount_minor":63207,"escrow_minor":0,"interest_minor":52065,"principal_minor":11142},"end_date":"2031-06-01","ahead_minor":758484,"to_end_minor":12425002}'::jsonb,
  'the balloon note (vector balloon-ends-at-the-term)'
);

-- Vector interest-only-whole-term-bridge.
select is(
  pg_temp.answer('bridge', '2026-10-09'),
  '{"next":{"due_date":"2026-11-01","amount_minor":183750,"escrow_minor":0,"interest_minor":183750,"principal_minor":0},"end_date":"2027-01-01","ahead_minor":21551250,"to_end_minor":21551250}'::jsonb,
  'the interest-only bridge note, added after its last past date so with no payment it is not late (vector interest-only-whole-term-bridge)'
);

-- Vector late-no-payment-added-before-the-date, on the stored schedule of a loan added on 2026-09-20.
select is(
  pg_temp.answer('fresh', '2026-11-22'),
  '{"next":{"due_date":"2026-12-01","amount_minor":524000,"escrow_minor":36300,"interest_minor":125000,"principal_minor":362700},"late_on":"2026-11-01","end_date":"2031-09-01","ahead_minor":6288000,"to_end_minor":29906169}'::jsonb,
  'a loan with no payment, added before its missed date, is late for it (FLOW-1263; vector late-no-payment-added-before-the-date)'
);

-- Vectors late-waits-out-the-grace-day-10 and late-after-the-grace-day-11: due 12-01, last paid 11-05.
select is(
  pg_temp.answer('late_mortgage', '2026-12-11'),
  '{"next":{"due_date":"2027-01-01","amount_minor":524000,"escrow_minor":36300,"interest_minor":91927,"principal_minor":395773},"end_date":"2030-05-01","ahead_minor":6288000,"to_end_minor":21096698}'::jsonb,
  'FLOW-1258: due 12-01, last payment 11-05: not late on 12-11, the tenth day (vector late-waits-out-the-grace-day-10)'
);
select is(
  pg_temp.answer('late_mortgage', '2026-12-12'),
  '{"next":{"due_date":"2027-01-01","amount_minor":524000,"escrow_minor":36300,"interest_minor":91927,"principal_minor":395773},"late_on":"2026-12-01","end_date":"2030-05-01","ahead_minor":6288000,"to_end_minor":21096698}'::jsonb,
  'FLOW-1258: late for 12-01 on 12-12 (vector late-after-the-grace-day-11)'
);

-- The day boundary: the last evening of October and the first minutes of November are two outlooks.
select is(
  pg_temp.answer('mortgage', '2026-10-31') -> 'next' ->> 'due_date',
  '2026-11-01',
  'on 10-31 the payment due 11-01 is next'
);
select is(
  pg_temp.answer('mortgage', '2026-11-01') -> 'next' ->> 'due_date',
  '2026-11-01',
  'on 11-01 the payment due that day is still next'
);
select is(
  pg_temp.answer('mortgage', '2026-11-02') -> 'next' ->> 'due_date',
  '2026-12-01',
  'on 11-02 the next payment is the one of 12-01'
);

select is(
  public.loan_outlooks(null),
  public.loan_outlooks((now() at time zone 'Asia/Jerusalem')::date),
  'a null p_today is today in Israel'
);

-- Left out: no schedule, nothing to pay, or terms the schedule refuses.
select is(
  (select array_agg(l.name order by l.name) from jsonb_array_elements(public.loan_outlooks('2026-10-09')) o
   join public.loans l on l.id = (o ->> 'loan_id')::uuid),
  array['bridge', 'fresh', 'late_mortgage', 'mortgage', 'note', 'unsplit']::text[],
  'the open loans with a payment ahead or a late date; a demand loan, a closed one, a paid-down one and a refused one are left out'
);
select is(
  (select state from public.loan_schedule_meta where loan_id = pg_temp.id('refused')) || ' ' ||
  (select state from public.loan_schedule_meta where loan_id = pg_temp.id('demand')) || ' ' ||
  (select state from public.loan_schedule_meta where loan_id = pg_temp.id('closed')),
  'refused none none',
  'a payment below the interest is refused by the schedule, and a demand loan and a closed loan have none'
);
select is(
  (select balance_minor from public.loan_balances where loan_id = pg_temp.id('paid_down')),
  0::bigint,
  'the paid-down loan has a zero balance, so no outlook'
);

-- FLOW-1264: the unsplit line counts as paid. The loan's dates run monthly from 45 days back; the latest one past the
-- 10 days of grace, with the one split payment 60 days back, is late.
select is(
  (pg_temp.answer('unsplit', (now() at time zone 'Asia/Jerusalem')::date)) ->> 'late_on',
  (select max(due_date)::text from public.loan_schedule_rows
   where loan_id = pg_temp.id('unsplit') and due_date < (now() at time zone 'Asia/Jerusalem')::date - 10),
  'with one old payment the loan is late for its latest date past the 10 days of grace'
);
select tests.clear_authentication();
reset role;
do $line$
begin
  perform tests.fixture_line(pg_temp.id('a'), 'f1310:unsplit-line', 100000, 'expense', null, null,
    (now() at time zone 'Asia/Jerusalem')::date - 3, 'USD');
  update public.transactions t set supplier_id = (select id from public.suppliers where company_id = pg_temp.id('a'))
  where t.idempotency_key = 'f1310:unsplit-line';
end
$line$;
select tests.authenticate_as('f1310_owner');
select is(
  (select last_on from public.loan_unsplit_payments where loan_id = pg_temp.id('unsplit')),
  (now() at time zone 'Asia/Jerusalem')::date - 3,
  'the unsplit bank line of the loan''s payment amount, from its lender, is found'
);
select is(
  (pg_temp.answer('unsplit', (now() at time zone 'Asia/Jerusalem')::date)) ? 'late_on',
  false,
  'the unsplit line counts as the loan''s payment: no late date'
);

-- The shape: one object per loan with its id, and no null in it.
select is(
  (select count(*) from jsonb_array_elements(public.loan_outlooks('2026-10-09')) o where o::text like '%null%'),
  0::bigint,
  'absent = null: no null in the answer'
);
select is(
  jsonb_typeof(public.loan_outlooks('2000-01-01')),
  'array',
  'the answer is a JSON array'
);

-- RLS: another company's member.
select tests.authenticate_as('f1310_other');
select is(
  (select array_agg(l.name) from jsonb_array_elements(public.loan_outlooks('2026-10-09')) o
   join public.loans l on l.id = (o ->> 'loan_id')::uuid),
  array['other_mortgage']::text[],
  'the other company''s member gets only their own loan'
);
select is(
  (select count(*) from jsonb_array_elements(public.loan_outlooks('2026-10-09')) o
   where (o ->> 'loan_id')::uuid in (select id from pg_temp.f1310 where label <> 'other_mortgage' and label not in ('a', 'b'))),
  0::bigint,
  'none of the first company''s loans is in it'
);

-- Grants: anon is refused; authenticated and service_role may execute it.
select tests.clear_authentication();
set local role anon;
select throws_ok('select public.loan_outlooks()', '42501', null, 'anon cannot execute loan_outlooks');
reset role;
select ok(
  has_function_privilege('authenticated', 'public.loan_outlooks(date)', 'execute')
  and has_function_privilege('service_role', 'public.loan_outlooks(date)', 'execute')
  and not has_function_privilege('anon', 'public.loan_outlooks(date)', 'execute')
  and not has_function_privilege('anon', 'private.loan_outlook_build(jsonb)', 'execute'),
  'execute for authenticated and service_role, not anon'
);

select * from finish();
rollback;
