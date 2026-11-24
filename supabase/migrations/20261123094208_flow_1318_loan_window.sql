-- FLOW-1318: the company and project forecasts build each loan's payments only for the months asked, and their loan
-- gather sends each loan's first due date on or after today instead of every stored due date. Adds three private
-- functions and patches three (same answers); changes no table and no other read. public.loan_outlooks keeps the full
-- build (private.loan_payments_left, untouched): it needs the totals to the end.
-- - private.loan_schedule_amortize_to: impliedAmortizationMonths, as private.loan_schedule_build works it out before its
--   loop (the months the payment pays the loan off over). The window asks for it only when a rate change needs a new
--   payment.
-- - private.loan_schedule_window(p_terms, p_periods): private.loan_schedule_build's rows for the first p_periods periods
--   only, with the same refusals for any period of the whole schedule: the same checks of the terms; the payment
--   below the interest, inside the window as the builder checks it, and after it once, at the first amortizing period
--   when that comes after the window (from then on the balance only falls and the rate stays, so the interest never
--   grows past the payment). A rate change after the window sets whole: the caller builds the whole schedule. No
--   balloon or final adjustment (the forecast reads neither).
-- - private.loan_payments_window(p_terms, p_balance, p_first_due, p_first_period, p_last_month):
--   private.loan_payments_left's rows due up to p_last_month (yyyy-mm), from the loan's first due date on or after
--   today and its period. Null when loan_payments_left is null or has no row in the window: the forecast reads the
--   rows of the months asked only, so the two give the same forecast.
-- - private.company_forecast_build: each loan's rows from private.loan_payments_window, up to the last month asked. A
--   loan may give its first due date as firstDue: { date, period } (JSON null when none is due on or after today)
--   instead of dueDates; without either the build still builds the loan's own schedule (the shared vectors).
--   private.project_forecast_build runs this build on one project's loans, so the project forecast gets it too.
-- - public.company_forecast and public.project_forecast: each loan's firstDue from public.loan_schedule_rows, one row,
--   instead of every stored due date (about 80 KB for 21 loans of 360 months).
-- Patched in place, as 20261123084637 did for the build: each anchor must be found once, or the migration fails.
-- Every public answer is unchanged: the company-forecast, project-forecast, loan-outlook and loan-schedule vectors and
-- flow_1307, flow_1309 and flow_1310 hold it, and flow_1318_loan_window.test.sql compares the window with the full
-- build over generated loans.
begin;

set local lock_timeout = '5s';

-- impliedAmortizationMonths (loan-schedule.ts), as private.loan_schedule_build works it out: a balloon amortizes over
-- its amortization months, an interest-only loan over its term, an amortizing one over the months its payment pays it
-- off in (its term unless the payment is below the annuity, at most 600).
create function private.loan_schedule_amortize_to(
  p_kind text,
  p_principal bigint,
  p_rate integer,
  p_term integer,
  p_pi bigint,
  p_amortization integer
)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  max_months constant integer := 600;
  low integer;
  high integer;
  middle integer;
begin
  if p_kind = 'balloon' then
    return p_amortization;
  elsif p_kind <> 'amortizing' then
    return p_term;
  elsif not private.loan_schedule_below_annuity(p_principal, p_rate, p_term, p_pi) then
    return p_term;
  elsif private.loan_schedule_payment(p_principal, p_rate, max_months) > p_pi then
    return max_months;
  end if;
  low := p_term;
  high := max_months;
  while low < high loop
    middle := (low + high) / 2;
    if private.loan_schedule_payment(p_principal, p_rate, middle) <= p_pi then
      high := middle;
    else
      low := middle + 1;
    end if;
  end loop;
  return low;
end;
$$;

comment on function private.loan_schedule_amortize_to(text, bigint, integer, integer, bigint, integer) is
  'FLOW-1318. impliedAmortizationMonths as private.loan_schedule_build works it out: the months a loan amortizes over. Used by private.loan_schedule_window, only when a rate change needs a new payment.';

-- private.loan_schedule_build's loop, stopped after p_periods periods. The checks of the terms are the builder's, line
-- for line; keep the two in step.
create function private.loan_schedule_window(
  p_terms jsonb,
  p_periods integer,
  out due_dates text[],
  out interest_minor bigint[],
  out principal_minor bigint[],
  out escrow_minor bigint,
  out whole boolean
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  monthly constant numeric := 12000000;
  max_months constant integer := 600;
  principal bigint;
  base_rate bigint;
  term bigint;
  payment bigint;
  escrow bigint;
  start_parts integer[];
  kind text;
  io bigint;
  amortization bigint;
  rate_dates text[] := '{}';
  rate_ppms integer[] := '{}';
  rate_row record;
  rate_ppm bigint;
  previous_date text;
  index integer := 0;
  io_months integer;
  amortize_to integer;
  pi bigint;
  balance bigint;
  level_pi bigint;
  level_rate integer;
  period integer;
  due_year integer;
  due_month integer;
  due_day integer;
  rate_count integer;
  rate integer;
  product bigint;
  remainder bigint;
  interest bigint;
  row_principal bigint;
  is_last boolean;
begin
  -- assertTerms, in its order.
  principal := private.loan_schedule_int(p_terms -> 'principalMinor');
  if principal is null or principal <= 0 then
    raise exception using message = 'principal', errcode = '22023';
  end if;
  base_rate := private.loan_schedule_int(p_terms -> 'annualRatePpm');
  if base_rate is null or base_rate < 0 or base_rate > 1000000 then
    raise exception using message = 'rate', errcode = '22023';
  end if;
  term := private.loan_schedule_int(p_terms -> 'termMonths');
  if term is null or term < 1 or term > max_months then
    raise exception using message = 'term', errcode = '22023';
  end if;
  payment := private.loan_schedule_int(p_terms -> 'paymentMinor');
  if payment is null or payment <= 0 then
    raise exception using message = 'payment', errcode = '22023';
  end if;
  escrow := private.loan_schedule_int(p_terms -> 'escrowMinor');
  if escrow is null or escrow < 0 or escrow >= payment then
    raise exception using message = 'escrow', errcode = '22023';
  end if;
  start_parts := private.loan_schedule_parse_date(p_terms ->> 'startDate');
  if start_parts is null then
    raise exception using message = 'start_date', errcode = '22023';
  end if;

  -- assertKind. JSON null reads as absent (the builder's ??).
  kind := coalesce(p_terms ->> 'kind', 'amortizing');
  if kind not in ('amortizing', 'interest_only', 'balloon') then
    raise exception using message = 'kind', errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_terms -> 'interestOnlyMonths'), 'null') <> 'null' then
    io := private.loan_schedule_int(p_terms -> 'interestOnlyMonths');
    if kind <> 'interest_only' or io is null or io < 1 or io > term then
      raise exception using message = 'interest_only_months', errcode = '22023';
    end if;
  elsif kind = 'interest_only' then
    raise exception using message = 'interest_only_months', errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_terms -> 'amortizationMonths'), 'null') <> 'null' then
    amortization := private.loan_schedule_int(p_terms -> 'amortizationMonths');
    if kind <> 'balloon' or amortization is null or amortization < term or amortization > max_months then
      raise exception using message = 'amortization_months', errcode = '22023';
    end if;
  elsif kind = 'balloon' then
    raise exception using message = 'amortization_months', errcode = '22023';
  end if;

  -- sortedRates: by date (a stable sort, compared as JavaScript compares strings), each checked in that order.
  if jsonb_typeof(p_terms -> 'rates') = 'array' then
    for rate_row in
      select r.value, r.ordinality
      from jsonb_array_elements(p_terms -> 'rates') with ordinality r(value, ordinality)
      order by r.value ->> 'effectiveDate' collate "C", r.ordinality
    loop
      index := index + 1;
      if private.loan_schedule_parse_date(rate_row.value ->> 'effectiveDate') is null then
        raise exception using message = 'rate_date', errcode = '22023';
      end if;
      rate_ppm := private.loan_schedule_int(rate_row.value -> 'annualRatePpm');
      if rate_ppm is null or rate_ppm < 0 or rate_ppm > 1000000 then
        raise exception using message = 'rate', errcode = '22023';
      end if;
      if index > 1 and previous_date = rate_row.value ->> 'effectiveDate' then
        raise exception using message = 'rate_date', errcode = '22023';
      end if;
      previous_date := rate_row.value ->> 'effectiveDate';
      rate_dates := rate_dates || previous_date;
      rate_ppms := rate_ppms || rate_ppm::integer;
    end loop;
  end if;

  io_months := case when kind = 'interest_only' then io else 0 end;
  pi := payment - escrow;
  balance := principal;
  level_pi := pi;
  level_rate := base_rate;
  period := 1;
  rate_count := coalesce(array_length(rate_dates, 1), 0);
  escrow_minor := escrow;
  whole := false;
  while period <= term and balance > 0 and period <= p_periods loop
    -- shiftMonths(start, period - 1): the start's day, capped at the month's last day.
    due_year := (start_parts[1] * 12 + start_parts[2] - 1 + period - 1) / 12;
    due_month := (start_parts[1] * 12 + start_parts[2] - 1 + period - 1) % 12 + 1;
    due_day := least(start_parts[3], case
      when due_month = 2 then
        case when due_year % 4 = 0 and (due_year % 100 <> 0 or due_year % 400 = 0) then 29 else 28 end
      when due_month in (4, 6, 9, 11) then 30
      else 31
    end);
    due_dates[period] := case when due_year < 10000 then lpad(due_year::text, 4, '0') else due_year::text end
      || '-' || lpad(due_month::text, 2, '0') || '-' || lpad(due_day::text, 2, '0');
    -- rateOnDate: the latest rate row on or before the due date, else the loan's own rate.
    rate := base_rate;
    for i in 1 .. rate_count loop
      if rate_dates[i] collate "C" <= due_dates[period] collate "C" then
        rate := rate_ppms[i];
      end if;
    end loop;
    -- divHalfEven(balance * rate, 12 * 10^6), in bigint while the product fits.
    if balance <= 9223372036854 then
      product := balance * rate;
      interest := product / 12000000;
      remainder := product - interest * 12000000;
      if 2 * remainder > 12000000 or (2 * remainder = 12000000 and interest % 2 = 1) then
        interest := interest + 1;
      end if;
    else
      interest := private.div_half_even(balance::numeric * rate, monthly);
    end if;
    is_last := period = term;
    if period <= io_months then
      row_principal := case when is_last then balance else 0 end;
    else
      if rate <> level_rate then
        amortize_to := coalesce(amortize_to,
          private.loan_schedule_amortize_to(kind, principal, base_rate::integer, term::integer, pi, amortization::integer));
        level_pi := private.loan_schedule_payment(balance, rate, amortize_to - period + 1);
        level_rate := rate;
      end if;
      if level_pi < interest then
        raise exception using message = 'payment_below_interest', errcode = '22023';
      end if;
      row_principal := case
        when is_last or level_pi - interest >= balance then balance
        else level_pi - interest
      end;
    end if;
    balance := balance - row_principal;
    interest_minor[period] := interest;
    principal_minor[period] := row_principal;
    period := period + 1;
  end loop;

  -- Stopped by the window with more of the schedule to come: would the builder refuse a later period?
  if period <= term and balance > 0 then
    if period = 1 or exists (select 1 from unnest(rate_dates) d where d collate "C" > due_dates[period - 1] collate "C") then
      -- A rate change after the window (or no period built): only the whole schedule says.
      whole := true;
    elsif period - 1 <= io_months and io_months < term then
      -- The first amortizing period (io_months + 1) comes after the window, and the builder checks the payment there.
      -- Its balance is this one (an interest-only period before the term's last pays no principal) and its rate this
      -- one (no rate change after the window); a rate change since the start gives it a new payment.
      interest := private.div_half_even(balance::numeric * rate, monthly);
      if rate <> level_rate then
        amortize_to := coalesce(amortize_to,
          private.loan_schedule_amortize_to(kind, principal, base_rate::integer, term::integer, pi, amortization::integer));
        level_pi := private.loan_schedule_payment(balance, rate, amortize_to - io_months);
      end if;
      if level_pi < interest then
        raise exception using message = 'payment_below_interest', errcode = '22023';
      end if;
    end if;
    -- Otherwise the window's last period amortized and was checked: later ones keep its rate and payment, and their
    -- interest is never more (the balance only falls), so none is refused.
  end if;
end;
$$;

comment on function private.loan_schedule_window(jsonb, integer) is
  'FLOW-1318. private.loan_schedule_build''s due dates, interest and principal for the first p_periods periods (p_periods >= 1), refusing (22023, the builder''s codes) whatever terms the builder refuses, a payment below the interest in a later period included. whole is true when a rate change comes after the window: then only the whole build says, and the rows are not to be read. No balance, balloon or final adjustment.';

-- private.loan_payments_left, up to p_last_month: the rows due up to that month (yyyy-mm), or null when
-- loan_payments_left is null or has no row due by then. The first due date on or after today and its period come from
-- the loan's own schedule (public.loan_schedule_rows). The rest's terms are loan_payments_left's, line for line.
create function private.loan_payments_window(
  p_terms jsonb,
  p_balance bigint,
  p_first_due date,
  p_first_period integer,
  p_last_month text,
  out due_dates text[],
  out interest_minor bigint[],
  out principal_minor bigint[],
  out escrow_minor bigint
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  done integer;
  kind text := coalesce(p_terms ->> 'kind', 'amortizing');
  io_left integer;
  rest_terms jsonb;
  periods integer;
  rest record;
  full_rest record;
begin
  -- paymentsLeft: none due on or after today.
  if p_first_due is null then
    return;
  end if;
  -- remainingFromBalance's terms.
  done := p_first_period - 1;
  io_left := case when kind = 'interest_only' then coalesce((p_terms ->> 'interestOnlyMonths')::integer, 0) - done else 0 end;
  rest_terms := p_terms || jsonb_build_object(
    'principalMinor', p_balance,
    'termMonths', (p_terms ->> 'termMonths')::integer - done,
    'startDate', to_char(p_first_due, 'YYYY-MM-DD'),
    -- Past its months of interest only, the loan amortizes over the rest of its term.
    'kind', case when kind = 'interest_only' and io_left <= 0 then 'amortizing' else kind end,
    'interestOnlyMonths', case when io_left > 0 then to_jsonb(io_left) else 'null'::jsonb end,
    'amortizationMonths', case
      when jsonb_typeof(p_terms -> 'amortizationMonths') = 'number'
      then to_jsonb((p_terms ->> 'amortizationMonths')::integer - done)
      else 'null'::jsonb end
  );
  -- One payment a month from the first due date: the periods up to the last month asked.
  periods := private.forecast_month_index(p_last_month) - private.forecast_month_index(to_char(p_first_due, 'YYYY-MM')) + 1;
  if periods is null or periods < 1 then
    return;
  end if;
  begin
    rest := private.loan_schedule_window(rest_terms, periods);
    if rest.whole then
      full_rest := private.loan_schedule_build(rest_terms);
      rest.due_dates := full_rest.due_dates[1:periods];
      rest.interest_minor := full_rest.interest_minor[1:periods];
      rest.principal_minor := full_rest.principal_minor[1:periods];
    end if;
  exception when invalid_parameter_value then
    -- paymentsLeft returns null when the build is refused.
    return;
  end;
  due_dates := rest.due_dates;
  interest_minor := rest.interest_minor;
  principal_minor := rest.principal_minor;
  escrow_minor := rest.escrow_minor;
end;
$$;

comment on function private.loan_payments_window(jsonb, bigint, date, integer, text) is
  'FLOW-1318. private.loan_payments_left''s rows due up to p_last_month (yyyy-mm), given the loan''s first due date on or after today and its period; null when loan_payments_left is null or has none due by then. Built with private.loan_schedule_window, or the whole build when a rate change comes after the window. The company and project forecasts read it; private.loan_outlook_build keeps loan_payments_left (totals to the end).';

revoke all on function private.loan_schedule_amortize_to(text, bigint, integer, integer, bigint, integer) from public, anon, authenticated;
revoke all on function private.loan_schedule_window(jsonb, integer) from public, anon, authenticated;
revoke all on function private.loan_payments_window(jsonb, bigint, date, integer, text) from public, anon, authenticated;
-- They read no table: the forecasts run as the caller and call them.
grant execute on function private.loan_schedule_amortize_to(text, bigint, integer, integer, bigint, integer) to authenticated, service_role;
grant execute on function private.loan_schedule_window(jsonb, integer) to authenticated, service_role;
grant execute on function private.loan_payments_window(jsonb, bigint, date, integer, text) to authenticated, service_role;

create or replace function pg_temp.swap(p_def text, p_from text, p_to text)
returns text
language plpgsql
immutable
as $$
begin
  if (char_length(p_def) - char_length(replace(p_def, p_from, ''))) / char_length(p_from) <> 1 then
    raise exception 'anchor not found exactly once: %', left(p_from, 80);
  end if;
  return replace(p_def, p_from, p_to);
end;
$$;

-- The build: each loan's rows up to the last month asked, from its first due date on or after today.
do $core$
declare
  def text := pg_get_functiondef('private.company_forecast_build(jsonb)'::regprocedure);
begin
  def := pg_temp.swap(def, $a$  all_parts boolean := coalesce((p_input ->> 'allParts')::boolean, false);$a$,
    $b$  all_parts boolean := coalesce((p_input ->> 'allParts')::boolean, false);
  -- FLOW-1318: each loan's payments are built up to the last month asked, from its first due date on or after today.
  last_month text := (select max(m collate "C") from unnest(months) m);
  first_due date;
  first_period integer;$b$);
  def := pg_temp.swap(def,
    $a$    terms := loan - 'id' - 'currency' - 'projectId' - 'status' - 'balanceMinor' - 'categoryIds' - 'dueDates';
    if loan ? 'dueDates' then$a$,
    $b$    terms := loan - 'id' - 'currency' - 'projectId' - 'status' - 'balanceMinor' - 'categoryIds' - 'dueDates' - 'firstDue';
    if loan ? 'firstDue' then
      -- The read's: the stored schedule's first due date on or after today and its period (JSON null: none).
      first_due := (loan -> 'firstDue' ->> 'date')::date;
      first_period := (loan -> 'firstDue' ->> 'period')::integer;
    elsif loan ? 'dueDates' then$b$);
  def := pg_temp.swap(def,
    $a$      due := own.due_dates::date[];
    end if;
    rest := private.loan_payments_left(terms, balance, today, due);$a$,
    $b$      due := own.due_dates::date[];
    end if;
    if not loan ? 'firstDue' then
      -- paymentsLeft: the first row due on or after today.
      select u.due, u.period into first_due, first_period
      from unnest(due) with ordinality u(due, period)
      where u.due >= today
      order by u.period
      limit 1;
    end if;
    rest := private.loan_payments_window(terms, balance, first_due, first_period, last_month);$b$);
  execute def;
end
$core$;

comment on function private.company_forecast_build(jsonb) is
  'FLOW-1307. companyNextMonthForecast with each month''s edits and skips (app/src/company-next-month.ts, company-year-forecast.ts, project-next-month.ts, project-next-loans.ts) as a pure function of what the app reads, for every month asked; each loan''s payments left are built once per call, up to the last month asked (FLOW-1318), from its firstDue, dueDates or own schedule. Same figures as the TypeScript for the shared vectors (packages/shared/fixtures/vectors/company-forecast).';

-- The reads: each loan's first due date on or after today, instead of every due date.
do $reads$
declare
  fn text;
  def text;
begin
  foreach fn in array array['public.company_forecast(text[], text, date)', 'public.project_forecast(uuid, text, date, text)'] loop
    def := pg_get_functiondef(fn::regprocedure);
    def := pg_temp.swap(def,
      $a$      'dueDates', coalesce((
        select jsonb_agg(to_char(s.due_date, 'YYYY-MM-DD') order by s.period)
        from public.loan_schedule_rows s
        where s.loan_id = l.id
      ), '[]'::jsonb)$a$,
      $b$      -- FLOW-1318: the first due date on or after today and its period, null when none is.
      'firstDue', (
        select jsonb_build_object('date', to_char(s.due_date, 'YYYY-MM-DD'), 'period', s.period)
        from public.loan_schedule_rows s
        where s.loan_id = l.id and s.due_date >= today
        order by s.period
        limit 1
      )$b$);
    def := pg_temp.swap(def, $a$stored schedule's due dates (none unless it was built).$a$,
      $b$stored schedule's first due date on or after today (none unless it was built).$b$);
    execute def;
  end loop;
end
$reads$;

drop function pg_temp.swap(text, text, text);

commit;
