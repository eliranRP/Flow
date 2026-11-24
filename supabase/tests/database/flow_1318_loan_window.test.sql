-- FLOW-1318: the forecasts build each loan's payments only up to the last month asked (migration 20261123094208).
-- - private.loan_payments_window equals private.loan_payments_left (the full build loan_outlooks keeps) cut at the last
--   month, over generated loans: amortizing (paid at the annuity, above it, below it and far below it), interest-only
--   (to the end, and then amortizing), balloons, a zero rate; rate changes before, inside and after the window and
--   inside the interest-only months; terms the builder refuses; the books' balance as scheduled, above, below, the
--   principal, one agora, twice the schedule's and zero; many days of the loan's life and windows of 1, 5 and 12 months.
--   Null exactly when loan_payments_left is null or has no row in the window.
-- - The cases the window must catch by itself, one by one: a refusal at the first amortizing period just after the
--   window; a rate change inside the interest-only months, which gives that period a new payment and no refusal; a rate
--   change after the window, which takes the whole build.
-- - private.company_forecast_build (FLOW-1307's core) gives the same answer as before, 'totals' and 'rows', over the
--   same loans plus a demand loan, a closed one, one in another currency, one with nothing left, one of no project and
--   one with no term: its loans given as firstDue (the reads' new gather), as every due date (the old gather) and as
--   neither (its own schedule), against a copy of the build with the full loan_payments_left call put back.
-- - The new functions are not anon's; authenticated may execute them (the forecasts run as the caller).
-- Invented terms only; no table is read.

begin;

select plan(11);

-- The loans: invented terms of each shape. pay_rule: the payment's principal and interest is the annuity over
-- pay_months at the loan's rate, times pay_factor (the escrow is added on top); 'flat' takes pay_flat as it is.
create temp table shape (
  n integer primary key,
  kind text,
  principal bigint,
  rate integer,
  term integer,
  io integer,
  amort integer,
  escrow bigint,
  pay_months integer,
  pay_factor numeric,
  pay_flat bigint,
  start_date date,
  rates jsonb
);
insert into shape values
  (1, 'amortizing', 30000000, 72000, 360, null, null, 0, 360, 1, null, '2025-01-31', '[]'),
  (2, 'amortizing', 30000000, 72000, 360, null, null, 25000, 360, 1, null, '2025-03-15', '[{"effectiveDate":"2025-03-15","annualRatePpm":72000}]'),
  (3, 'amortizing', 22000000, 65000, 360, null, null, 0, 360, 1, null, '2025-02-10', '[{"effectiveDate":"2025-09-10","annualRatePpm":90000}]'),
  (4, 'amortizing', 22000000, 65000, 360, null, null, 15000, 360, 1, null, '2025-02-10', '[{"effectiveDate":"2027-08-01","annualRatePpm":50000},{"effectiveDate":"2028-08-01","annualRatePpm":110000}]'),
  (5, 'amortizing', 18000000, 80000, 240, null, null, 0, 240, 0.8, null, '2025-04-30', '[{"effectiveDate":"2026-02-28","annualRatePpm":95000}]'),
  (6, 'amortizing', 18000000, 80000, 120, null, null, 0, 600, 1, null, '2025-04-30', '[{"effectiveDate":"2025-09-30","annualRatePpm":60000}]'),
  (7, 'amortizing', 12000000, 70000, 360, null, null, 0, 360, 1.6, null, '2025-06-01', '[{"effectiveDate":"2026-12-01","annualRatePpm":85000}]'),
  (8, 'amortizing', 1200000, 90000, 12, null, null, 0, 12, 1, null, '2025-11-20', '[]'),
  (9, 'amortizing', 6000000, 0, 360, null, null, 0, 360, 1, null, '2025-01-05', '[{"effectiveDate":"2026-01-05","annualRatePpm":60000}]'),
  (10, 'interest_only', 25000000, 70000, 24, 24, null, 20000, null, null, 166000, '2025-05-09', '[{"effectiveDate":"2025-11-09","annualRatePpm":76000}]'),
  (11, 'interest_only', 20000000, 72000, 360, 12, null, 0, 348, 1, null, '2025-01-15', '[]'),
  (12, 'interest_only', 20000000, 72000, 360, 12, null, 0, 348, 1, null, '2025-01-15', '[{"effectiveDate":"2025-07-15","annualRatePpm":140000}]'),
  (13, 'interest_only', 9000000, 60000, 36, 6, null, 0, 30, 1, null, '2025-03-31', '[{"effectiveDate":"2026-11-30","annualRatePpm":70000}]'),
  (14, 'interest_only', 20000000, 72000, 360, 12, null, 0, 348, 1, null, '2025-01-15', '[{"effectiveDate":"2026-02-15","annualRatePpm":80000}]'),
  (15, 'balloon', 40000000, 97000, 60, null, 360, 0, 360, 1, null, '2025-04-02', '[]'),
  (16, 'balloon', 9000000, 70000, 84, null, 300, 30000, 300, 1, null, '2025-03-07', '[{"effectiveDate":"2027-03-07","annualRatePpm":75000},{"effectiveDate":"2029-03-07","annualRatePpm":65000}]'),
  (17, 'balloon', 9000000, 70000, 60, null, 360, 0, 360, 0.9, null, '2025-05-14', '[]'),
  (18, 'amortizing', 10000000, 70000, 360, null, null, 70000, null, null, 0, '2025-01-01', '[]'),
  (19, 'amortizing', 10000000, 70000, 360, null, null, 0, null, null, 29000, '2025-01-01', '[]'),
  (20, 'interest_only', 10000000, 70000, 24, 36, null, 0, 24, 1, null, '2025-01-01', '[]'),
  (21, 'amortizing', 10000000, 70000, 360, null, null, 0, 360, 1, null, '2025-01-01', '[{"effectiveDate":"2026-01-01","annualRatePpm":80000},{"effectiveDate":"2026-01-01","annualRatePpm":90000}]'),
  (22, 'amortizing', 15000000, 68000, 360, null, null, 0, 360, 1, null, '2025-01-31', '[{"effectiveDate":"2025-04-30","annualRatePpm":69000},{"effectiveDate":"2033-05-31","annualRatePpm":71000}]'),
  (23, 'interest_only', 20000000, 72000, 360, 24, null, 10000, 336, 1, null, '2025-02-20', '[]'),
  (24, 'balloon', 12000000, 0, 60, null, 360, 0, 360, 1, null, '2025-08-31', '[{"effectiveDate":"2026-08-31","annualRatePpm":90000}]');

create temp table loan as
select s.n, s.kind, s.io, s.start_date,
  jsonb_build_object(
    'principalMinor', s.principal, 'annualRatePpm', s.rate, 'termMonths', s.term,
    'startDate', to_char(s.start_date, 'YYYY-MM-DD'),
    'paymentMinor', s.escrow + coalesce(s.pay_flat,
      ceil(private.loan_schedule_payment(s.principal, s.rate, s.pay_months) * s.pay_factor)::bigint),
    'escrowMinor', s.escrow, 'kind', s.kind, 'interestOnlyMonths', s.io, 'amortizationMonths', s.amort,
    'rates', s.rates
  ) as terms,
  -- shiftMonths: the start's day, capped at the month's last day.
  array(select (s.start_date + make_interval(months => p - 1))::date from generate_series(1, s.term) p) as due
from shape s;
-- The loan's own schedule: its due dates and balances (none when the builder refuses the terms).
create temp table own (n integer primary key, due_dates text[], balance_minor bigint[]);
do $own$
declare
  l record;
  b record;
begin
  for l in select * from loan loop
    begin
      b := private.loan_schedule_build(l.terms);
      insert into own values (l.n, b.due_dates, b.balance_minor);
    exception when invalid_parameter_value then
      insert into own values (l.n, null, null);
    end;
  end loop;
end
$own$;

-- Every case: a loan, a day and the books' balance; then a window of 1, 5 or 12 months after the day's month.
create temp table cases as
select l.n, l.terms, d.today, b.bal, f.first_due, f.first_period, coalesce(o.due_dates::date[], l.due) as due
from loan l
join own o on o.n = l.n
cross join (values (-1, -3), (0, 0), (10, -3), (11, 2), (22, -3), (23, 2), (35, -3), (59, 2), (84, 0), (230, 0)) k(months, days)
cross join lateral (select (l.start_date + make_interval(months => k.months) + make_interval(days => k.days))::date as today) d
-- The first due date on or after today and its period, from the loan's own schedule (its terms' when refused).
cross join lateral (
  select u.due as first_due, u.period::integer as first_period
  from unnest(coalesce(o.due_dates::date[], l.due)) with ordinality u(due, period)
  where u.due >= d.today
  order by u.period
  limit 1
) f
cross join lateral (
  select coalesce(o.balance_minor[f.first_period - 1], (l.terms ->> 'principalMinor')::bigint) as scheduled
) s
cross join lateral (values (s.scheduled), (s.scheduled + s.scheduled / 33), (s.scheduled * 7 / 10), (1::bigint),
  (2 * s.scheduled), (0::bigint)) b(bal);

create temp table compared as
select c.n, c.today, c.bal, c.first_due, c.first_period, h.last_month,
  full_rest.due_dates as f_due, full_rest.interest_minor as f_interest, full_rest.principal_minor as f_principal,
  full_rest.escrow_minor as f_escrow,
  w.due_dates as w_due, w.interest_minor as w_interest, w.principal_minor as w_principal, w.escrow_minor as w_escrow
from cases c
cross join lateral private.loan_payments_left(c.terms, c.bal, c.today, c.due) full_rest
cross join lateral (
  select to_char(date_trunc('month', c.today) + make_interval(months => x), 'YYYY-MM') as last_month
  from (values (1), (5), (12)) v(x)
) h
cross join lateral private.loan_payments_window(c.terms, c.bal, c.first_due, c.first_period, h.last_month) w;

-- What the forecast reads of the full build: its rows due up to the last month, null when there are none.
create temp table expected as
select x.*,
  case when x.cut_due = '{}' then null else x.cut_due end as e_due,
  case when x.cut_due = '{}' then null else x.cut_interest end as e_interest,
  case when x.cut_due = '{}' then null else x.cut_principal end as e_principal,
  case when x.cut_due = '{}' then null else x.f_escrow end as e_escrow
from (
  select c.*,
    array(select u.d from unnest(c.f_due) with ordinality u(d, o) where left(u.d, 7) <= c.last_month order by u.o) as cut_due,
    array(select u.i from unnest(c.f_due, c.f_interest) with ordinality u(d, i, o) where left(u.d, 7) <= c.last_month order by u.o) as cut_interest,
    array(select u.p from unnest(c.f_due, c.f_principal) with ordinality u(d, p, o) where left(u.d, 7) <= c.last_month order by u.o) as cut_principal
  from compared c
) x;

select is(
  (select count(*) from expected e
   where e.w_due is distinct from e.e_due or e.w_interest is distinct from e.e_interest
      or e.w_principal is distinct from e.e_principal or e.w_escrow is distinct from e.e_escrow),
  0::bigint,
  'the window equals the full build cut at the last month, case by case'
);
select ok(
  (select count(*) > 3500
      and count(*) filter (where e.e_due is not null) > 2000
      and count(*) filter (where e.f_due is null and left(e.first_due::text, 7) <= e.last_month) > 500
      and count(*) filter (where e.f_due is not null and e.e_due is null) > 0
      and count(distinct e.n) filter (where e.e_due is not null) = 21
   from expected e),
  'the cases cover rows in the window, refusals, rows only after it, and every loan the builder takes'
);

-- One by one. Loan 11: 12 months of interest only from January 2025, then 348 amortizing; the books owe twice the
-- schedule's. On 10 November 2025 its rest pays interest only in November and December, and the full build refuses
-- January 2026, the first amortizing month (the payment is below the interest on twice the balance). A window ending
-- in December, the last month of interest only, must refuse it too.
select ok(
  (select f.due_dates is null from loan l, private.loan_payments_left(l.terms, 40000000, '2025-11-10',
     (select o.due_dates::date[] from own o where o.n = 11)) f where l.n = 11)
  and (select w.due_dates is null from loan l, private.loan_payments_window(l.terms, 40000000, '2025-11-15', 11, '2025-12') w where l.n = 11),
  'a refusal at the first amortizing month just after the window: both null'
);
-- Loan 12 is loan 11 with its rate up from 7.2% to 14% in July 2025, inside the interest-only months, and the balance
-- as scheduled. The full build gives January 2026 a new payment at the new rate over the months left, and takes it;
-- with the old payment it would refuse (the interest at 14% is above it). The window takes it too.
select is(
  (select row(w.due_dates, w.interest_minor, w.principal_minor, w.escrow_minor)::text
   from loan l, private.loan_payments_window(l.terms, 20000000, '2025-11-15', 11, '2025-12') w where l.n = 12),
  (select row(f.due_dates[1:2], f.interest_minor[1:2], f.principal_minor[1:2], f.escrow_minor)::text
   from loan l, private.loan_payments_left(l.terms, 20000000, '2025-11-10',
     (select o.due_dates::date[] from own o where o.n = 12)) f where l.n = 12),
  'a rate change inside the interest-only months: the first amortizing month''s new payment, no refusal'
);
select ok(
  (select f.interest_minor[3] > (l.terms ->> 'paymentMinor')::bigint and f.principal_minor[3] > 0
   from loan l, private.loan_payments_left(l.terms, 20000000, '2025-11-10', (select o.due_dates::date[] from own o where o.n = 12)) f
   where l.n = 12),
  'in that case the interest after the change is above the old payment, and the new payment amortizes'
);
-- Loan 22's rate changes in May 2033. A window from January to March 2033 takes the whole build; its rows are the same.
select ok(
  (select w.whole from loan l, private.loan_schedule_window(l.terms || '{"principalMinor": 15000000, "startDate": "2033-01-31"}', 3) w where l.n = 22),
  'a rate change after the window asks for the whole build'
);
select is(
  (select row(w.due_dates, w.interest_minor, w.principal_minor)::text
   from loan l, private.loan_payments_window(l.terms, 14000000, '2033-01-31', 97, '2033-03') w where l.n = 22),
  (select row(f.due_dates[1:3], f.interest_minor[1:3], f.principal_minor[1:3])::text
   from loan l, private.loan_payments_left(l.terms, 14000000, '2033-01-20', (select o.due_dates::date[] from own o where o.n = 22)) f
   where l.n = 22),
  'and gives the full build''s rows'
);

-- The build. A copy of it with the full call put back, as FLOW-1307 and FLOW-1309 built each loan.
do $ref$
declare
  def text := pg_get_functiondef('private.company_forecast_build(jsonb)'::regprocedure);
  anchor constant text := 'rest := private.loan_payments_window(terms, balance, first_due, first_period, last_month);';
begin
  if position(anchor in def) = 0 then
    raise exception 'the build no longer calls loan_payments_window as this test expects';
  end if;
  def := replace(def, anchor, 'rest := private.loan_payments_left(terms, balance, today, due);');
  def := replace(def, 'FUNCTION private.company_forecast_build(', 'FUNCTION pg_temp.company_forecast_build_full(');
  execute def;
end
$ref$;

-- The loans as the reads give them: every generated loan of a project or of none, plus the kinds the build skips.
create temp table build_loan as
select l.n, l.terms || jsonb_build_object(
    'id', 'loan-' || lpad(l.n::text, 2, '0'), 'currency', 'USD', 'status', 'open',
    'projectId', case l.n % 3 when 0 then null when 1 then 'p1' else 'p2' end,
    'categoryIds', jsonb_build_object('interest', case when l.n % 2 = 0 then 'c-int' end, 'escrow', null),
    'balanceMinor', coalesce(o.balance_minor[6], (l.terms ->> 'principalMinor')::bigint) + (l.n % 4) * 10000
  ) as loan,
  coalesce(o.due_dates::date[], l.due) as due
from loan l join own o on o.n = l.n
union all
select 100 + x.k, x.loan, null::date[] from (values
  (1, '{"id":"loan-demand","currency":"USD","status":"open","projectId":"p1","kind":"demand","principalMinor":5000000,"annualRatePpm":60000,"startDate":"2025-01-01","escrowMinor":0,"balanceMinor":5000000,"rates":[]}'::jsonb),
  (2, '{"id":"loan-closed","currency":"USD","status":"closed","projectId":"p1","principalMinor":5000000,"annualRatePpm":60000,"termMonths":60,"startDate":"2025-01-01","paymentMinor":100000,"escrowMinor":0,"balanceMinor":2000000,"rates":[]}'::jsonb),
  (3, '{"id":"loan-ils","currency":"ILS","status":"open","projectId":"p1","principalMinor":5000000,"annualRatePpm":60000,"termMonths":60,"startDate":"2025-01-01","paymentMinor":100000,"escrowMinor":0,"balanceMinor":2000000,"rates":[]}'::jsonb),
  (4, '{"id":"loan-paid","currency":"USD","status":"open","projectId":"p2","principalMinor":5000000,"annualRatePpm":60000,"termMonths":60,"startDate":"2025-01-01","paymentMinor":100000,"escrowMinor":0,"balanceMinor":0,"rates":[]}'::jsonb),
  (5, '{"id":"loan-noterm","currency":"USD","status":"open","projectId":null,"principalMinor":5000000,"annualRatePpm":60000,"startDate":"2025-01-01","paymentMinor":100000,"escrowMinor":0,"balanceMinor":2000000,"rates":[]}'::jsonb),
  (6, '{"id":"loan-other","currency":"USD","status":"open","projectId":"p9","principalMinor":5000000,"annualRatePpm":60000,"termMonths":60,"startDate":"2025-01-01","paymentMinor":100000,"escrowMinor":0,"balanceMinor":2000000,"rates":[]}'::jsonb)
) x(k, loan);

-- Inputs over several days and month sets; each loan given three ways.
create temp table build_case as
select d.today, ms.label, ms.months, det.detail,
  jsonb_build_object(
    'currency', 'USD', 'today', to_char(d.today, 'YYYY-MM-DD'), 'months', to_jsonb(ms.months), 'detail', det.detail,
    'recurring', '[]'::jsonb,
    'categories', '[{"id":"c-int","name":"Interest","loan_part":"interest","excluded_from_pnl":false,"parent_id":null},{"id":"c-esc","name":"Escrow","loan_part":"escrow","excluded_from_pnl":false,"parent_id":null}]'::jsonb,
    'inputs', jsonb_build_object('month', ms.months[1], 'overhead_project_id', 'office',
      'projects', '[{"project_id":"p1","categories":[]},{"project_id":"p2","categories":[]}]'::jsonb, 'general', '[]'::jsonb,
      'edits', '[]'::jsonb, 'rest_edits', '[]'::jsonb, 'skips', '{}'::jsonb)
  ) as base
from (values ('2025-03-20'::date), ('2025-12-10'), ('2026-11-24'), ('2033-01-20')) d(today)
cross join lateral (
  select 'one' as label, array[to_char(d.today + interval '1 month', 'YYYY-MM')] as months
  union all
  select 'year', array(select to_char(date_trunc('month', d.today) + make_interval(months => i), 'YYYY-MM') from generate_series(1, 12) i)
  union all
  select 'sparse', array[to_char(date_trunc('month', d.today) + interval '9 months', 'YYYY-MM'), to_char(date_trunc('month', d.today) + interval '3 months', 'YYYY-MM')]
) ms
cross join (values ('totals'), ('rows')) det(detail);

create temp table build_answer as
select bc.today, bc.label, bc.detail,
  pg_temp.company_forecast_build_full(bc.base || jsonb_build_object('loans', (select jsonb_agg(bl.loan || case when bl.due is null then '{}'::jsonb else jsonb_build_object('dueDates', to_jsonb(bl.due::text[])) end order by bl.n) from build_loan bl))) as full_due,
  pg_temp.company_forecast_build_full(bc.base || jsonb_build_object('loans', (select jsonb_agg(bl.loan order by bl.n) from build_loan bl))) as full_own,
  private.company_forecast_build(bc.base || jsonb_build_object('loans', (select jsonb_agg(bl.loan || case when bl.due is null then '{}'::jsonb else jsonb_build_object('firstDue', (
      select jsonb_build_object('date', u.due, 'period', u.period) from unnest(bl.due) with ordinality u(due, period)
      where u.due >= bc.today order by u.period limit 1)) end order by bl.n) from build_loan bl))) as window_first,
  private.company_forecast_build(bc.base || jsonb_build_object('loans', (select jsonb_agg(bl.loan || case when bl.due is null then '{}'::jsonb else jsonb_build_object('dueDates', to_jsonb(bl.due::text[])) end order by bl.n) from build_loan bl))) as window_due,
  private.company_forecast_build(bc.base || jsonb_build_object('loans', (select jsonb_agg(bl.loan order by bl.n) from build_loan bl))) as window_own
from build_case bc;

select is(
  (select count(*) from build_answer a where a.window_first is distinct from a.full_due or a.window_due is distinct from a.full_due),
  0::bigint,
  'the build gives the full build''s answer with each loan''s first due date or its due dates, totals and rows'
);
select is(
  (select count(*) from build_answer a where a.window_own is distinct from a.full_own),
  0::bigint,
  'and with each loan''s own schedule (no due date given)'
);
select ok(
  (select count(*) = 24
      and count(*) filter (where a.full_due::text like '%"kind": "loan"%') >= 8
      and count(*) filter (where a.full_due::text like '%"loan_cash": [{%') >= 4
   from build_answer a),
  'those answers have loan rows and loan cash'
);

-- Grants: the forecasts run as the caller; anon gets none of them.
select ok(
  (select bool_and(has_function_privilege('authenticated', f, 'execute') and has_function_privilege('service_role', f, 'execute')
     and not has_function_privilege('anon', f, 'execute'))
   from unnest(array[
     'private.loan_schedule_amortize_to(text, bigint, integer, integer, bigint, integer)'::regprocedure,
     'private.loan_schedule_window(jsonb, integer)'::regprocedure,
     'private.loan_payments_window(jsonb, bigint, date, integer, text)'::regprocedure]) f),
  'execute for authenticated and service_role, not anon'
);

select * from finish();
rollback;
