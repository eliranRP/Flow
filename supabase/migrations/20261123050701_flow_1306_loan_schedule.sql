-- FLOW-1306 (the FLOW-1275 plan, slice 5): the loan schedule on the loan's own terms, kept in the database.
-- - private.loan_schedule(p_terms jsonb): buildLoanSchedule (packages/shared/src/loan-schedule.ts), ported line for
--   line. It takes LoanTerms as JSON (amounts as integer minor units) and returns { rows, balloon, finalAdjustment }
--   in the shape of the shared vectors (packages/shared/fixtures/vectors/loan-schedule). Every kind, rate changes and
--   recasts, the balloon and the final adjustment; the annuity is the exact rational in numeric, interest rounds half
--   to even (private.div_half_even). Terms the builder refuses raise SQLSTATE 22023 with the LoanScheduleError code
--   as the message. Immutable, reads no table, so authenticated may execute it.
-- - public.loan_schedule_rows: the schedule's rows per open loan. public.loan_schedule_meta: one row per loan, with
--   its state (built; refused, with the error code; none, for a demand loan or one that is not open, which have no
--   schedule, as scheduleRowsOf in app/src/screens/loan-outlook.ts), the balloon, the final adjustment and a hash of
--   the terms. Both reference loans on delete cascade, so a deleted loan (or company) takes its rows with it. RLS
--   reads them as the loans themselves (readable_company_id); authenticated cannot write them.
-- - Triggers rebuild a loan's rows in the same transaction: loans insert, and update of a term column or the status;
--   loan_rates insert, update and delete (a delete rebuilds only a loan that still exists). No trigger on delete of a
--   loan: the cascade removes its rows.
-- - A backfill builds every loan.
-- No read or table that exists today changes (the plan's section 4, item 1).
begin;

set local lock_timeout = '5s';

-- Days in a month of the proleptic Gregorian calendar (year 0 is a leap year, as in JavaScript's Date).
-- The two SQL helpers set no configuration, so they inline into their callers (as private.div_half_even does,
-- 20261021120613_main_screens_speed.sql): each is one expression of pg_catalog operators over its arguments, and
-- every caller sets an empty search_path.
create function private.loan_schedule_days_in_month(p_year integer, p_month integer)
returns integer
language sql
immutable
as $$
  select case
    when p_month = 2 then
      case when p_year % 4 = 0 and (p_year % 100 <> 0 or p_year % 400 = 0) then 29 else 28 end
    when p_month in (4, 6, 9, 11) then 30
    else 31
  end;
$$;

-- YYYY-MM-DD as the builder parses it: four digits, a month 1 to 12 and a day inside the month. Null when it is not
-- one. The digits are ASCII only, as JavaScript's \d.
create function private.loan_schedule_parse_date(p_text text)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  parts text[];
  y integer;
  m integer;
  d integer;
begin
  parts := regexp_match(p_text, '^([0-9]{4})-([0-9]{2})-([0-9]{2})$');
  if parts is null then
    return null;
  end if;
  y := parts[1]::integer;
  m := parts[2]::integer;
  d := parts[3]::integer;
  if m < 1 or m > 12 or d < 1 or d > private.loan_schedule_days_in_month(y, m) then
    return null;
  end if;
  return array[y, m, d];
end;
$$;

-- The exact annuity of p_principal over p_months at p_rate ppm, as {numerator, denominator} in minor units
-- (exactAnnuity). Zero rate is principal / months. Powers by squaring, so every product is exact.
create function private.loan_schedule_annuity(p_principal numeric, p_rate integer, p_months integer)
returns numeric[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  monthly constant numeric := 12000000;
  grown numeric := 1;
  untouched numeric := 1;
  grown_factor numeric;
  untouched_factor numeric;
  remaining integer := p_months;
begin
  if p_rate = 0 then
    return array[p_principal, p_months::numeric];
  end if;
  grown_factor := monthly + p_rate;
  untouched_factor := monthly;
  while remaining > 0 loop
    if remaining % 2 = 1 then
      grown := grown * grown_factor;
      untouched := untouched * untouched_factor;
    end if;
    remaining := remaining / 2;
    if remaining > 0 then
      grown_factor := grown_factor * grown_factor;
      untouched_factor := untouched_factor * untouched_factor;
    end if;
  end loop;
  return array[p_principal * p_rate * grown, monthly * (grown - untouched)];
end;
$$;

-- contractualPaymentMinor: the exact annuity rounded half to even.
create function private.loan_schedule_payment(p_principal numeric, p_rate integer, p_months integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  annuity numeric[];
begin
  annuity := private.loan_schedule_annuity(p_principal, p_rate, p_months);
  return private.div_half_even(annuity[1], annuity[2]);
end;
$$;

-- piBelowAnnuity: principal-and-interest more than one minor unit below the exact annuity over p_months.
create function private.loan_schedule_below_annuity(p_principal numeric, p_rate integer, p_months integer, p_pi numeric)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  annuity numeric[];
begin
  annuity := private.loan_schedule_annuity(p_principal, p_rate, p_months);
  return annuity[1] > (p_pi + 1) * annuity[2];
end;
$$;

-- A JSON value the builder takes as a safe integer (Number.isSafeInteger), else null.
create function private.loan_schedule_int(p_value jsonb)
returns bigint
language sql
immutable
as $$
  select case
    when jsonb_typeof(p_value) = 'number'
      and p_value::text::numeric = trunc(p_value::text::numeric)
      and abs(p_value::text::numeric) <= 9007199254740991
    then p_value::text::numeric::bigint
  end;
$$;

-- buildLoanSchedule, ported line for line, as arrays: the rows' due dates, interest, principal and balance by period,
-- and the balloon and final adjustment (null when there is none). The trigger stores these as they are; building
-- 360 rows of jsonb would cost more than the schedule itself.
create function private.loan_schedule_build(
  p_terms jsonb,
  out due_dates text[],
  out interest_minor bigint[],
  out principal_minor bigint[],
  out balance_minor bigint[],
  out escrow_minor bigint,
  out balloon_minor bigint,
  out balloon_ratio double precision,
  out final_adjustment_minor bigint
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
  low integer;
  high integer;
  middle integer;
  balance bigint;
  level_pi bigint;
  level_rate integer;
  recast boolean := false;
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
  row_count integer;
  last_payment bigint;
  ballooned boolean;
  regular bigint;
  level bigint;
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
  if kind = 'balloon' then
    amortize_to := amortization;
  elsif kind = 'amortizing' then
    -- impliedAmortizationMonths.
    if not private.loan_schedule_below_annuity(principal, base_rate::integer, term::integer, pi) then
      amortize_to := term;
    elsif private.loan_schedule_payment(principal, base_rate::integer, max_months) > pi then
      amortize_to := max_months;
    else
      low := term;
      high := max_months;
      while low < high loop
        middle := (low + high) / 2;
        if private.loan_schedule_payment(principal, base_rate::integer, middle) <= pi then
          high := middle;
        else
          low := middle + 1;
        end if;
      end loop;
      amortize_to := low;
    end if;
  else
    amortize_to := term;
  end if;

  balance := principal;
  level_pi := pi;
  level_rate := base_rate;
  period := 1;
  rate_count := coalesce(array_length(rate_dates, 1), 0);
  while period <= term and balance > 0 loop
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
        level_pi := private.loan_schedule_payment(balance, rate, amortize_to - period + 1);
        level_rate := rate;
        recast := true;
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
    balance_minor[period] := balance;
    period := period + 1;
  end loop;

  row_count := period - 1;
  last_payment := interest_minor[row_count] + escrow + principal_minor[row_count];
  escrow_minor := escrow;

  if kind = 'amortizing' then
    ballooned := private.loan_schedule_below_annuity(principal, base_rate::integer, term::integer, pi);
    if not ballooned and not recast and row_count = term and last_payment <> payment then
      level := private.loan_schedule_payment(principal, base_rate::integer, term::integer);
      if pi >= level - 1 and pi <= level + 1 then
        final_adjustment_minor := last_payment;
      end if;
    end if;
  else
    ballooned := row_count = term and (
      (kind = 'balloon' and amortize_to > term)
      or (kind = 'interest_only' and io_months = term)
      or (not recast and amortize_to - io_months > 0
        and private.loan_schedule_below_annuity(principal, base_rate::integer, (amortize_to - io_months)::integer, pi))
    );
  end if;

  if ballooned and row_count > 0 then
    -- balloonFrom: the regular payment is the monthly one (monthlyPaymentMinor at the loan's own rate), escrow out of
    -- both sides. The ratio is a double, as Number / Number; over a zero regular payment it is null (JSON has no
    -- number for Infinity).
    regular := case
      when kind = 'interest_only' and io = term then private.div_half_even(principal::numeric * base_rate, monthly)
      else payment - escrow
    end;
    balloon_minor := last_payment;
    balloon_ratio := case
      when regular = 0 then null
      else (last_payment - escrow)::double precision / regular::double precision
    end;
  end if;
end;
$$;

create function private.loan_schedule(p_terms jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
set extra_float_digits = 1
as $$
declare
  built record;
begin
  built := private.loan_schedule_build(p_terms);
  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'period', u.period,
        'dueDate', u.due,
        'interestMinor', u.interest,
        'escrowMinor', built.escrow_minor,
        'principalMinor', u.principal,
        'paymentMinor', u.interest + built.escrow_minor + u.principal,
        'balanceMinor', u.balance
      ) order by u.period)
      from unnest(built.due_dates, built.interest_minor, built.principal_minor, built.balance_minor) with ordinality
        u(due, interest, principal, balance, period)
    ), '[]'::jsonb),
    'balloon', case when built.balloon_minor is not null then
      jsonb_build_object('amountMinor', built.balloon_minor, 'ratioToPayment', to_jsonb(built.balloon_ratio))
    else 'null'::jsonb end,
    'finalAdjustment', case when built.final_adjustment_minor is not null then
      jsonb_build_object('amountMinor', built.final_adjustment_minor)
    else 'null'::jsonb end
  );
end;
$$;

comment on function private.loan_schedule(jsonb) is
  'FLOW-1306. buildLoanSchedule (packages/shared/src/loan-schedule.ts) on LoanTerms as JSON, amounts in minor units: { rows, balloon, finalAdjustment }. Refused terms raise 22023 with the LoanScheduleError code as the message. The shared vectors (packages/shared/fixtures/vectors/loan-schedule) run through both.';

revoke all on function private.loan_schedule_days_in_month(integer, integer) from public, anon, authenticated;
revoke all on function private.loan_schedule_parse_date(text) from public, anon, authenticated;
revoke all on function private.loan_schedule_annuity(numeric, integer, integer) from public, anon, authenticated;
revoke all on function private.loan_schedule_payment(numeric, integer, integer) from public, anon, authenticated;
revoke all on function private.loan_schedule_below_annuity(numeric, integer, integer, numeric) from public, anon, authenticated;
revoke all on function private.loan_schedule_int(jsonb) from public, anon, authenticated;
revoke all on function private.loan_schedule_build(jsonb) from public, anon, authenticated;
revoke all on function private.loan_schedule(jsonb) from public, anon, authenticated;
-- They read no table: a read running as the user (FLOW-1307, FLOW-1310) calls them.
grant execute on function private.loan_schedule_days_in_month(integer, integer) to authenticated, service_role;
grant execute on function private.loan_schedule_parse_date(text) to authenticated, service_role;
grant execute on function private.loan_schedule_annuity(numeric, integer, integer) to authenticated, service_role;
grant execute on function private.loan_schedule_payment(numeric, integer, integer) to authenticated, service_role;
grant execute on function private.loan_schedule_below_annuity(numeric, integer, integer, numeric) to authenticated, service_role;
grant execute on function private.loan_schedule_int(jsonb) to authenticated, service_role;
grant execute on function private.loan_schedule_build(jsonb) to authenticated, service_role;
grant execute on function private.loan_schedule(jsonb) to authenticated, service_role;

create table public.loan_schedule_rows (
  company_id uuid not null,
  loan_id uuid not null,
  period integer not null,
  due_date date not null,
  interest_minor bigint not null,
  escrow_minor bigint not null,
  principal_minor bigint not null,
  payment_minor bigint not null,
  balance_minor bigint not null,
  primary key (loan_id, period),
  foreign key (company_id, loan_id) references public.loans (company_id, id) on delete cascade
);

comment on table public.loan_schedule_rows is
  'FLOW-1306. The schedule of each open loan on its own terms and rates: private.loan_schedule of the loan, rebuilt by triggers on loans and loan_rates in the same transaction. Minor units of the loan''s currency. Written only by the triggers.';

create index loan_schedule_rows_company_loan_due_idx on public.loan_schedule_rows (company_id, loan_id, due_date);

create table public.loan_schedule_meta (
  company_id uuid not null,
  loan_id uuid primary key,
  state text not null,
  error text,
  balloon_minor bigint,
  balloon_ratio double precision,
  final_adjustment_minor bigint,
  terms_hash text not null,
  built_at timestamptz not null default now(),
  foreign key (company_id, loan_id) references public.loans (company_id, id) on delete cascade,
  constraint loan_schedule_meta_state_chk check (state in ('built', 'refused', 'none')),
  constraint loan_schedule_meta_error_chk check ((state = 'refused') = (error is not null))
);

comment on table public.loan_schedule_meta is
  'FLOW-1306. One row per loan: state built (rows in loan_schedule_rows), refused (error is the LoanScheduleError code, no rows) or none (a demand loan or one that is not open: no schedule, as scheduleRowsOf). balloon_* and final_adjustment_minor as buildLoanSchedule gives them; terms_hash is md5 of the terms passed to private.loan_schedule. Written only by the triggers.';

create index loan_schedule_meta_company_loan_idx on public.loan_schedule_meta (company_id, loan_id);

alter table public.loan_schedule_rows enable row level security;
alter table public.loan_schedule_meta enable row level security;

create policy loan_schedule_rows_select on public.loan_schedule_rows
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

create policy loan_schedule_meta_select on public.loan_schedule_meta
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

revoke all on public.loan_schedule_rows from public, anon, authenticated;
revoke all on public.loan_schedule_meta from public, anon, authenticated;
grant select on public.loan_schedule_rows to authenticated;
grant select on public.loan_schedule_meta to authenticated;
grant select, insert, update, delete on public.loan_schedule_rows to service_role;
grant select, insert, update, delete on public.loan_schedule_meta to service_role;

-- The terms buildLoanSchedule takes for a loan, as loanScheduleTerms passes them (rates oldest first).
create function private.loan_schedule_rebuild(p_loan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  loan public.loans%rowtype;
  terms jsonb;
  built record;
  balloon_minor bigint;
  balloon_ratio double precision;
  final_adjustment_minor bigint;
  failure text;
  state text := 'built';
begin
  select * into loan from public.loans where id = p_loan_id;
  if not found then
    return;
  end if;
  terms := jsonb_build_object(
    'principalMinor', loan.principal_minor,
    'annualRatePpm', loan.annual_rate_ppm,
    'termMonths', loan.term_months,
    'startDate', to_char(loan.start_date, 'YYYY-MM-DD'),
    'paymentMinor', loan.payment_minor,
    'escrowMinor', loan.escrow_minor,
    'kind', loan.kind::text,
    'interestOnlyMonths', loan.interest_only_months,
    'amortizationMonths', loan.amortization_months,
    'rates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'effectiveDate', to_char(r.effective_date, 'YYYY-MM-DD'),
        'annualRatePpm', r.annual_rate_ppm
      ) order by r.effective_date)
      from public.loan_rates r
      where r.loan_id = loan.id
    ), '[]'::jsonb)
  );
  delete from public.loan_schedule_rows where loan_id = loan.id;
  if loan.status <> 'open'::public.loan_status
     or loan.kind = 'demand'::public.loan_kind
     or loan.term_months is null
     or loan.payment_minor is null
  then
    state := 'none';
  else
    begin
      built := private.loan_schedule_build(terms);
    exception when invalid_parameter_value then
      failure := sqlerrm;
      if failure not in ('principal', 'rate', 'term', 'payment', 'escrow', 'start_date', 'payment_below_interest',
                         'kind', 'interest_only_months', 'amortization_months', 'rate_date') then
        raise;
      end if;
      state := 'refused';
    end;
  end if;
  if state = 'built' then
    insert into public.loan_schedule_rows (
      company_id, loan_id, period, due_date, interest_minor, escrow_minor, principal_minor, payment_minor, balance_minor
    )
    select loan.company_id, loan.id, u.period, u.due::date, u.interest, built.escrow_minor, u.principal,
      u.interest + built.escrow_minor + u.principal, u.balance
    from unnest(built.due_dates, built.interest_minor, built.principal_minor, built.balance_minor) with ordinality
      u(due, interest, principal, balance, period);
    balloon_minor := built.balloon_minor;
    balloon_ratio := built.balloon_ratio;
    final_adjustment_minor := built.final_adjustment_minor;
  end if;
  insert into public.loan_schedule_meta (
    company_id, loan_id, state, error, balloon_minor, balloon_ratio, final_adjustment_minor, terms_hash, built_at
  )
  values (
    loan.company_id, loan.id, state, failure,
    balloon_minor,
    balloon_ratio,
    final_adjustment_minor,
    md5(terms::text),
    now()
  )
  on conflict (loan_id) do update set
    company_id = excluded.company_id,
    state = excluded.state,
    error = excluded.error,
    balloon_minor = excluded.balloon_minor,
    balloon_ratio = excluded.balloon_ratio,
    final_adjustment_minor = excluded.final_adjustment_minor,
    terms_hash = excluded.terms_hash,
    built_at = excluded.built_at;
end;
$$;

revoke all on function private.loan_schedule_rebuild(uuid) from public, anon, authenticated;

create function private.loans_schedule_rebuild()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.loan_schedule_rebuild(new.id);
  return null;
end;
$$;

revoke all on function private.loans_schedule_rebuild() from public, anon, authenticated;

-- A delete needs no trigger: the foreign keys cascade.
create trigger loans_schedule_insert
  after insert on public.loans
  for each row execute function private.loans_schedule_rebuild();

create trigger loans_schedule_update
  after update of principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, kind,
    interest_only_months, amortization_months, status
  on public.loans
  for each row
  when ((old.principal_minor, old.annual_rate_ppm, old.term_months, old.start_date, old.payment_minor,
         old.escrow_minor, old.kind, old.interest_only_months, old.amortization_months, old.status)
        is distinct from
        (new.principal_minor, new.annual_rate_ppm, new.term_months, new.start_date, new.payment_minor,
         new.escrow_minor, new.kind, new.interest_only_months, new.amortization_months, new.status))
  execute function private.loans_schedule_rebuild();

-- A rate's insert, update or delete rebuilds its loan. On a delete the loan may be gone already (a loan's delete
-- cascades to its rates): private.loan_schedule_rebuild then does nothing.
create function private.loan_rates_schedule_rebuild()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.loan_schedule_rebuild(old.loan_id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.loan_id is distinct from old.loan_id) then
    perform private.loan_schedule_rebuild(new.loan_id);
  end if;
  return null;
end;
$$;

revoke all on function private.loan_rates_schedule_rebuild() from public, anon, authenticated;

create trigger loan_rates_schedule
  after insert or update or delete on public.loan_rates
  for each row execute function private.loan_rates_schedule_rebuild();

-- Backfill: every loan.
select private.loan_schedule_rebuild(l.id) from public.loans l;

commit;
