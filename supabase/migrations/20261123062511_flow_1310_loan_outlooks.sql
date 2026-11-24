-- FLOW-1310 (plan FLOW-1275, slice 10): the Loans list's outlooks in the database. Adds two functions; changes no table
-- and no existing read.
-- - private.loan_outlook_build(p_input jsonb): loanOutlook, paymentsLeft, remainingFromBalance and latePayment
--   (app/src/screens/loan-outlook.ts) as one pure function of one loan. Immutable, reads no table, and gives the
--   figures the TypeScript gives for every shared vector (packages/shared/fixtures/vectors/loan-outlook, run by
--   vectors_loan_outlook.test.sql and by app/src/screens/loan-outlook-vectors.test.ts).
--   Input: { today, loan, paid, dueDates? }
--     today     yyyy-mm-dd, the day to read from.
--     loan      the loan's terms as private.loan_schedule takes them (principalMinor, annualRatePpm, termMonths,
--               startDate, paymentMinor, escrowMinor, kind, interestOnlyMonths, amortizationMonths, rates) plus
--               status and balanceMinor (the balance in the books).
--     paid      { lastPaidOn, addedOn } as latePayment's LoanPaidFacts (yyyy-mm-dd or null).
--     dueDates  the due dates of the loan's own schedule, in order (public.loan_outlooks passes the stored ones from
--               loan_schedule_rows). Absent, they are built from the terms with private.loan_schedule_build, which
--               is what the vectors do; present, nothing is built twice.
--   Output: {} when the loan has no outlook and is not late (a demand loan, one not open, a balance of zero, terms
--   the schedule refuses); else, leaving out what is null (absent = null):
--     next          { due_date, interest_minor, escrow_minor, principal_minor, amount_minor }: the payment due on or
--                   after today, from the balance in the books; absent when the schedule has none left, or the rest
--                   of it cannot be built
--     ahead_minor   the next 12 payments' total (fewer near the end)
--     to_end_minor  every payment left, the next 12 included
--     end_date      the last payment's due date
--     late_on       FLOW-1258's rule: the due date of the latest scheduled payment past its 10 days of grace with
--                   no payment recorded from 15 days before it (FLOW-1263: with none at all, only a date on or
--                   after the day the loan was added)
--   The rest of the schedule is built from the balance on each call (remainingFromBalance, ported as it is: it
--   starts at the first due date on or after today, with the months of interest only still ahead and the amortization
--   months left), about 1.6 ms a loan.
-- - public.loan_outlooks(p_today): security invoker. One answer for the company's open loans with a built schedule:
--   [{ loan_id, ...the build's answer }], ordered by loan id; a loan with neither a next payment nor a late date is
--   left out. It gathers each loan's terms and rates (loans, loan_rates), its stored schedule's due dates
--   (loan_schedule_rows), its balance and latest payment (loan_balances), the latest unsplit payment
--   (loan_unsplit_payments) and the day it was added in Israel time. Rows are the caller's by RLS: another company's
--   member gets none.
--
-- Today: p_today null is today in Israel (Asia/Jerusalem), as the app's israelToday() and private.flow_today() have
-- it. authenticated cannot execute private.flow_today() (FLOW-1313 hit the same), so the expression is inline.
-- loan_unsplit_payments already counts its 75 days from the Israel day, whatever p_today is.
begin;

set local lock_timeout = '5s';

create function private.loan_outlook_build(p_input jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  loan jsonb := p_input -> 'loan';
  paid jsonb := coalesce(p_input -> 'paid', '{}'::jsonb);
  today date := (p_input ->> 'today')::date;
  balance bigint := (loan ->> 'balanceMinor')::bigint;
  terms jsonb;
  own record;
  due_dates date[];
  first_period integer;
  first_due date;
  done integer;
  kind text;
  io_left integer;
  rest_terms jsonb;
  rest record;
  rest_count integer;
  next_part jsonb;
  ahead bigint;
  to_end bigint;
  end_date date;
  late_due date;
  late_on date;
  last_paid date;
  added_on date;
begin
  -- paymentsLeft and latePayment: an open loan with something left, and a schedule.
  if loan ->> 'status' is distinct from 'open' or balance is null or balance <= 0 then
    return '{}'::jsonb;
  end if;
  -- loanScheduleTerms: none for a demand loan, or one with no term or payment.
  if coalesce(loan ->> 'kind', 'amortizing') = 'demand'
     or jsonb_typeof(loan -> 'termMonths') is distinct from 'number'
     or jsonb_typeof(loan -> 'paymentMinor') is distinct from 'number' then
    return '{}'::jsonb;
  end if;
  terms := loan - 'status' - 'balanceMinor';

  if p_input ? 'dueDates' then
    due_dates := array(select jsonb_array_elements_text(p_input -> 'dueDates')::date);
  else
    begin
      own := private.loan_schedule_build(terms);
    exception when invalid_parameter_value then
      -- scheduleRowsOf: terms the schedule refuses have none.
      return '{}'::jsonb;
    end;
    due_dates := own.due_dates::date[];
  end if;
  if coalesce(array_length(due_dates, 1), 0) = 0 then
    return '{}'::jsonb;
  end if;

  -- paymentsLeft: the first row due on or after today, then the schedule from the balance.
  select u.due, u.period into first_due, first_period
  from unnest(due_dates) with ordinality u(due, period)
  where u.due >= today
  order by u.period
  limit 1;
  if first_due is not null then
    -- remainingFromBalance.
    done := first_period - 1;
    kind := coalesce(terms ->> 'kind', 'amortizing');
    io_left := case when kind = 'interest_only' then coalesce((terms ->> 'interestOnlyMonths')::integer, 0) - done else 0 end;
    rest_terms := terms || jsonb_build_object(
      'principalMinor', balance,
      'termMonths', (terms ->> 'termMonths')::integer - done,
      'startDate', to_char(first_due, 'YYYY-MM-DD'),
      -- Past its months of interest only, the loan amortizes over the rest of its term.
      'kind', case when kind = 'interest_only' and io_left <= 0 then 'amortizing' else kind end,
      'interestOnlyMonths', case when io_left > 0 then to_jsonb(io_left) else 'null'::jsonb end,
      'amortizationMonths', case
        when jsonb_typeof(terms -> 'amortizationMonths') = 'number'
        then to_jsonb((terms ->> 'amortizationMonths')::integer - done)
        else 'null'::jsonb end
    );
    begin
      rest := private.loan_schedule_build(rest_terms);
      rest_count := array_length(rest.due_dates, 1);
      next_part := jsonb_build_object(
        'due_date', rest.due_dates[1],
        'interest_minor', rest.interest_minor[1],
        'escrow_minor', rest.escrow_minor,
        'principal_minor', rest.principal_minor[1],
        'amount_minor', rest.interest_minor[1] + rest.escrow_minor + rest.principal_minor[1]
      );
      select coalesce(sum(x.i + x.p), 0) + rest.escrow_minor * count(*) into ahead
      from unnest(rest.interest_minor[1:12], rest.principal_minor[1:12]) x(i, p);
      select coalesce(sum(x.i + x.p), 0) + rest.escrow_minor * count(*) into to_end
      from unnest(rest.interest_minor, rest.principal_minor) x(i, p);
      end_date := rest.due_dates[rest_count]::date;
    exception when invalid_parameter_value then
      -- paymentsLeft returns null when the build is refused.
      next_part := null;
      ahead := null;
      to_end := null;
      end_date := null;
    end;
  end if;

  -- latePayment (FLOW-1258, FLOW-1263): the latest due date past its grace, if nothing was paid for it.
  select max(d) into late_due from unnest(due_dates) d where d < today - 10;
  if late_due is not null then
    last_paid := nullif(paid ->> 'lastPaidOn', '')::date;
    added_on := nullif(paid ->> 'addedOn', '')::date;
    if last_paid is null then
      if added_on is not null and late_due >= added_on then
        late_on := late_due;
      end if;
    elsif last_paid < late_due - 15 then
      late_on := late_due;
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'next', next_part,
    'ahead_minor', ahead,
    'to_end_minor', to_end,
    'end_date', end_date,
    'late_on', late_on
  ));
end;
$$;

comment on function private.loan_outlook_build(jsonb) is
  'FLOW-1310. loanOutlook and latePayment (app/src/screens/loan-outlook.ts) for one loan as a pure function: { today, loan, paid, dueDates? } to { next, ahead_minor, to_end_minor, end_date, late_on } without its nulls, {} when the loan has neither an outlook nor a late date. The shared vectors (packages/shared/fixtures/vectors/loan-outlook) run through both.';

revoke all on function private.loan_outlook_build(jsonb) from public, anon, authenticated;
-- It reads no table: public.loan_outlooks runs as the caller and calls it.
grant execute on function private.loan_outlook_build(jsonb) to authenticated, service_role;

create function public.loan_outlooks(p_today date default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  -- Materialized, so each loan is built once: the filter below would otherwise run the build a second time.
  with built as materialized (
    select l.id as loan_id,
      private.loan_outlook_build(jsonb_build_object(
        'today', coalesce(p_today, (now() at time zone 'Asia/Jerusalem')::date),
        'loan', jsonb_build_object(
          'principalMinor', l.principal_minor,
          'annualRatePpm', l.annual_rate_ppm,
          'termMonths', l.term_months,
          'startDate', to_char(l.start_date, 'YYYY-MM-DD'),
          'paymentMinor', l.payment_minor,
          'escrowMinor', l.escrow_minor,
          'kind', l.kind::text,
          'interestOnlyMonths', l.interest_only_months,
          'amortizationMonths', l.amortization_months,
          'rates', coalesce((
            select jsonb_agg(jsonb_build_object(
              'effectiveDate', to_char(lr.effective_date, 'YYYY-MM-DD'),
              'annualRatePpm', lr.annual_rate_ppm
            ) order by lr.effective_date)
            from public.loan_rates lr
            where lr.loan_id = l.id
          ), '[]'::jsonb),
          'status', l.status::text,
          'balanceMinor', coalesce(b.balance_minor, l.principal_minor)
        ),
        'paid', jsonb_build_object(
          -- laterOf: the later of the two, either may be missing.
          'lastPaidOn', to_char(greatest(b.last_paid_on, u.last_on), 'YYYY-MM-DD'),
          'addedOn', to_char((l.created_at at time zone 'Asia/Jerusalem')::date, 'YYYY-MM-DD')
        ),
        'dueDates', (
          select jsonb_agg(to_char(s.due_date, 'YYYY-MM-DD') order by s.period)
          from public.loan_schedule_rows s
          where s.loan_id = l.id
        )
      )) as answer
    from public.loans l
    join public.loan_schedule_meta m on m.loan_id = l.id and m.state = 'built'
    left join public.loan_balances b on b.loan_id = l.id
    left join public.loan_unsplit_payments u on u.loan_id = l.id
    where l.status = 'open'::public.loan_status
  )
  select coalesce(jsonb_agg(jsonb_build_object('loan_id', loan_id) || answer order by loan_id), '[]'::jsonb)
  from built
  where answer <> '{}'::jsonb;
$$;

comment on function public.loan_outlooks(date) is
  'FLOW-1310. The Loans list''s outlooks in one read: [{ loan_id, next: { due_date, interest_minor, escrow_minor, principal_minor, amount_minor }, ahead_minor, to_end_minor, end_date, late_on }] for the company''s open loans with a built schedule, ordered by loan id. absent = null: a loan with neither a next payment nor a late date is left out, and next, end_date and late_on are left out when null. ahead_minor is the next 12 payments'' total, to_end_minor every payment left, both in the loan''s currency. p_today (default: today in Israel) is the day to read from. security invoker: the caller''s RLS applies, so another company''s member gets none. The rest of each schedule is built from the balance on each call (private.loan_outlook_build).';

revoke all on function public.loan_outlooks(date) from public, anon, authenticated;
grant execute on function public.loan_outlooks(date) to authenticated, service_role;

commit;
