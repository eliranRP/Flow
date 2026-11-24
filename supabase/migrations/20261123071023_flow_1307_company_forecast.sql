-- FLOW-1307 (plan FLOW-1275, slice 6): the company forecast in the database. Adds five functions (two of them
-- per-row helpers, private.forecast_month_index and private.forecast_pace_months) and rewrites one
-- (private.loan_outlook_build, same answer); changes no table and no other read.
-- - private.loan_payments_left(p_terms, p_balance, p_today, p_due_dates): remainingFromBalance and the first-due rule
--   of paymentsLeft (app/src/screens/loan-outlook.ts), ported once by FLOW-1310 inside private.loan_outlook_build and
--   moved here so the outlook and the forecast share one port. Given the loan's own schedule's due dates, the rest of
--   the schedule from the balance in the books, from the first payment due on or after today; null fields when no
--   payment is due on or after today or the build refuses the rest.
-- - private.loan_outlook_build: FLOW-1310's function, now calling private.loan_payments_left; its answer is unchanged
--   (the loan-outlook vectors and flow_1310_loan_outlooks.test.sql hold it).
-- - private.company_forecast_build(p_input jsonb): nextMonthForecast, applyForecastEdits, cashForecast
--   (project-next-month.ts), the loan parts and loan cash (project-next-loans.ts), skipEdits, companyNextMonthForecast,
--   companyGeneralForecast, splitPartyKeys (company-next-month.ts) and monthEdits / companyMonthInput
--   (company-year-forecast.ts), for every month asked, as one pure function. Immutable, reads no table, and gives the
--   figures the TypeScript gives for every shared vector (packages/shared/fixtures/vectors/company-forecast, run by
--   vectors_company_forecast.test.sql and by app/src/company-forecast-vectors.test.ts; the README there has the shape).
--   Each loan's payments left are built once per call (FLOW-1304's memo): the first loop below, before any month.
-- - public.company_forecast(p_months, p_detail, p_today): security invoker. Gathers what the app gathers today
--   (company_next_month_inputs, expected_months(0), the loans with their balances, rates and stored schedules, the
--   categories, the company currency) and builds the months asked. p_months are months of the forecast (next month to
--   12 months ahead of p_today), each once, answered in that order; p_detail is 'totals' or 'rows'. Anything else is
--   refused with 22023; a caller with no company with 42501 (company_next_month_inputs).
--
-- Answer of public.company_forecast (absent = null; amounts are minor units of the company currency):
--   { today, currency,
--     months: [{ month, income_minor, expense_minor, net_minor,   profit terms, the parts' totals summed
--                cash_only_minor,                                  the loans' cash no row holds (cashForecast): the
--                                                                  cash view's expense is expense_minor + it
--                projects, general,                                parts with a row: projects, and the general costs
--                income: { rows, recurring, rent, name } }],       the income rows, how many are recurring, how many
--                                                                  of those are rent (isRent), and the name when one
--     income: { rows, recurring, rent, name } }                    the same over every month asked, each stream once
--                                                                  (restIncomeNote)
--   'rows' adds, per month,
--     parts: [{ project_id, income_minor, expense_minor, cash_only_minor, average_months,
--               rows, removed, arrived, loan_cash: [{ loan_id, row_category_ids, minor }] }]
--                                                                  the parts with a row, projects by id, then the
--                                                                  general costs (no project_id)
--     skipped: [{ project_id, ...row }]                            every part's rows a skip took out (FLOW-1079)
--   and, once, split_keys: the parties split by project (FLOW-1096).
--   A row is { key, kind, direction, name, date, minor (signed), category_id, was_minor, pace }.
-- Rows come by key, not in the app's order: the app sorts and words them (Hebrew collation differs, plan section 2).
--
-- Today: p_today null is today in Israel (Asia/Jerusalem), inline, since authenticated cannot execute
-- private.flow_today() (as FLOW-1313 and FLOW-1310). The same day goes to every read gathered.
begin;

set local lock_timeout = '5s';

create function private.loan_payments_left(
  p_terms jsonb,
  p_balance bigint,
  p_today date,
  p_due_dates date[],
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
  first_period integer;
  first_due date;
  done integer;
  kind text := coalesce(p_terms ->> 'kind', 'amortizing');
  io_left integer;
  rest record;
begin
  -- paymentsLeft: the first row due on or after today.
  select u.due, u.period into first_due, first_period
  from unnest(p_due_dates) with ordinality u(due, period)
  where u.due >= p_today
  order by u.period
  limit 1;
  if first_due is null then
    return;
  end if;
  -- remainingFromBalance.
  done := first_period - 1;
  io_left := case when kind = 'interest_only' then coalesce((p_terms ->> 'interestOnlyMonths')::integer, 0) - done else 0 end;
  begin
    rest := private.loan_schedule_build(p_terms || jsonb_build_object(
      'principalMinor', p_balance,
      'termMonths', (p_terms ->> 'termMonths')::integer - done,
      'startDate', to_char(first_due, 'YYYY-MM-DD'),
      -- Past its months of interest only, the loan amortizes over the rest of its term.
      'kind', case when kind = 'interest_only' and io_left <= 0 then 'amortizing' else kind end,
      'interestOnlyMonths', case when io_left > 0 then to_jsonb(io_left) else 'null'::jsonb end,
      'amortizationMonths', case
        when jsonb_typeof(p_terms -> 'amortizationMonths') = 'number'
        then to_jsonb((p_terms ->> 'amortizationMonths')::integer - done)
        else 'null'::jsonb end
    ));
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

comment on function private.loan_payments_left(jsonb, bigint, date, date[]) is
  'FLOW-1307. paymentsLeft''s first-due rule and remainingFromBalance (app/src/screens/loan-outlook.ts): the rest of a loan''s schedule from the balance in the books, from its first due date on or after p_today. Null fields when none is due or the build is refused. Shared by private.loan_outlook_build and private.company_forecast_build.';

revoke all on function private.loan_payments_left(jsonb, bigint, date, date[]) from public, anon, authenticated;
grant execute on function private.loan_payments_left(jsonb, bigint, date, date[]) to authenticated, service_role;

-- FLOW-1310's build, with its rest of the schedule from private.loan_payments_left. The same answer.
create or replace function private.loan_outlook_build(p_input jsonb)
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

  rest := private.loan_payments_left(terms, balance, today, due_dates);
  if rest.due_dates is not null then
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

-- Two per-row helpers of the forecast's build. They set no configuration, so they inline into their one caller,
-- private.company_forecast_build, which runs with an empty search_path (as main_screens_speed.test.sql says of the
-- ledger's helpers); their bodies name nothing outside pg_catalog.
-- yyyy-mm (or yyyy-mm-dd) as a count of months (monthIndex in packages/shared/src/recurring-due.ts).
create function private.forecast_month_index(p_key text)
returns integer
language sql
immutable
parallel safe
as $$
  select left(p_key, 4)::integer * 12 + substr(p_key, 6, 2)::integer - 1;
$$;

-- How many months apart a pace's charges or edits come (paceMonths); anything else is monthly.
create function private.forecast_pace_months(p_pace text)
returns integer
language sql
immutable
parallel safe
as $$
  select case p_pace when '2months' then 2 when 'quarter' then 3 when 'year' then 12 else 1 end;
$$;

revoke all on function private.forecast_month_index(text) from public, anon, authenticated;
revoke all on function private.forecast_pace_months(text) from public, anon, authenticated;
grant execute on function private.forecast_month_index(text) to authenticated, service_role;
grant execute on function private.forecast_pace_months(text) to authenticated, service_role;

-- The company forecast for the months asked, as one pure function of what the app reads. Input (the vectors' input):
--   { currency, today, months: [yyyy-mm], recurring: expected_months' recurring[], loans: [{ id, currency, projectId,
--     status, balanceMinor, categoryIds: { interest, escrow }, the LoanTerms private.loan_schedule takes, dueDates? }],
--     categories: [{ id, name, loan_part, excluded_from_pnl, parent_id }] (list_categories' order),
--     inputs: company_next_month_inputs, detail? }
-- Output: { months: [...], income, split_keys }, the 'rows' answer of public.company_forecast without today and
-- currency (see the header). With detail 'totals' (public.company_forecast's own), { months, income } without the
-- parts and the skipped rows: the same figures, and no row is written out.
create function private.company_forecast_build(p_input jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  cur text := p_input ->> 'currency';
  today date := (p_input ->> 'today')::date;
  this_month text := left(p_input ->> 'today', 7);
  inputs jsonb := coalesce(p_input -> 'inputs', '{}'::jsonb);
  cats jsonb := coalesce(p_input -> 'categories', '[]'::jsonb);
  overhead text := inputs ->> 'overhead_project_id';
  months text[] := array(select jsonb_array_elements_text(coalesce(p_input -> 'months', '[]'::jsonb)));
  part_ids text[];
  loan jsonb;
  pid text;
  balance bigint;
  terms jsonb;
  own record;
  due date[];
  rest record;
  part_cat jsonb;
  icat text;
  iname text;
  ecat text;
  ename text;
  due_rows jsonb := '[]'::jsonb;
  with_rows boolean := p_input ->> 'detail' is distinct from 'totals';
begin
  -- The projects the read lists (a finished project adds nothing), the overhead one aside: its charges, loans and
  -- edits are general costs.
  part_ids := array(
    select p ->> 'project_id' from jsonb_array_elements(coalesce(inputs -> 'projects', '[]'::jsonb)) p
    where p ->> 'project_id' is distinct from overhead
  );

  -- FLOW-1304: each loan's payments left, once for the whole call, and the payment due in each month asked
  -- (dueRows): an open loan of a part, in the currency, with a schedule and a balance left.
  for loan in select l from jsonb_array_elements(coalesce(p_input -> 'loans', '[]'::jsonb)) l loop
    continue when loan ->> 'status' is distinct from 'open' or loan ->> 'currency' is distinct from cur;
    pid := case when loan ->> 'projectId' is null or loan ->> 'projectId' = overhead then '' else loan ->> 'projectId' end;
    continue when pid <> '' and not pid = any(part_ids);
    balance := (loan ->> 'balanceMinor')::bigint;
    continue when balance is null or balance <= 0;
    -- loanScheduleTerms: none for a demand loan, or one with no term or payment.
    continue when coalesce(loan ->> 'kind', 'amortizing') = 'demand'
      or jsonb_typeof(loan -> 'termMonths') is distinct from 'number'
      or jsonb_typeof(loan -> 'paymentMinor') is distinct from 'number';
    terms := loan - 'id' - 'currency' - 'projectId' - 'status' - 'balanceMinor' - 'categoryIds' - 'dueDates';
    if loan ? 'dueDates' then
      due := array(select jsonb_array_elements_text(coalesce(loan -> 'dueDates', '[]'::jsonb))::date);
    else
      begin
        own := private.loan_schedule_build(terms);
      exception when invalid_parameter_value then
        -- scheduleRowsOf: terms the schedule refuses have none.
        continue;
      end;
      due := own.due_dates::date[];
    end if;
    rest := private.loan_payments_left(terms, balance, today, due);
    continue when rest.due_dates is null;
    -- partCategory: the loan's own category, else the company's keyed one; none when kept out of the profit.
    part_cat := null;
    select x.c into part_cat from jsonb_array_elements(cats) with ordinality x(c, n)
    where case when loan -> 'categoryIds' ->> 'interest' is null then x.c ->> 'loan_part' = 'interest'
               else x.c ->> 'id' = loan -> 'categoryIds' ->> 'interest' end
    order by x.n limit 1;
    icat := case when part_cat is not null and part_cat -> 'excluded_from_pnl' is distinct from 'true'::jsonb then part_cat ->> 'id' end;
    iname := case when icat is not null then coalesce(part_cat ->> 'name', '') end;
    part_cat := null;
    select x.c into part_cat from jsonb_array_elements(cats) with ordinality x(c, n)
    where case when loan -> 'categoryIds' ->> 'escrow' is null then x.c ->> 'loan_part' = 'escrow'
               else x.c ->> 'id' = loan -> 'categoryIds' ->> 'escrow' end
    order by x.n limit 1;
    ecat := case when part_cat is not null and part_cat -> 'excluded_from_pnl' is distinct from 'true'::jsonb then part_cat ->> 'id' end;
    ename := case when ecat is not null then coalesce(part_cat ->> 'name', '') end;
    due_rows := due_rows || coalesce((
      select jsonb_agg(jsonb_build_object(
        'm', x.m, 'pid', pid, 'loan_id', loan ->> 'id',
        'interest', x.i, 'escrow', rest.escrow_minor, 'principal', x.p,
        'icat', icat, 'iname', iname, 'ecat', ecat, 'ename', ename))
      from (
        -- scheduleRow: the first payment due in each month asked.
        select distinct on (left(u.d, 7)) left(u.d, 7) as m, u.i, u.p
        from unnest(rest.due_dates, rest.interest_minor, rest.principal_minor) with ordinality u(d, i, p, o)
        where left(u.d, 7) = any(months)
        order by left(u.d, 7), u.o
      ) x
    ), '[]'::jsonb);
  end loop;

  return (
    with
    -- The months asked, with their index and last day (expectedDate and dueDate cap a day at it).
    mon as (
      select u.m, u.ord, private.forecast_month_index(u.m) as mi,
        extract(day from (to_date(u.m, 'YYYY-MM') + interval '1 month' - interval '1 day'))::integer as last
      from unnest(months) with ordinality u(m, ord)
    ),
    -- The parts: each listed project (by id), then the general costs under ''.
    part as (
      select p.pid, p.cats, row_number() over (order by p.pid collate "C") as pord
      from (
        select distinct on (x.p ->> 'project_id') x.p ->> 'project_id' as pid, coalesce(x.p -> 'categories', '[]'::jsonb) as cats
        from jsonb_array_elements(coalesce(inputs -> 'projects', '[]'::jsonb)) with ordinality x(p, n)
        where x.p ->> 'project_id' is distinct from overhead
        order by x.p ->> 'project_id', x.n
      ) p
      union all
      select '', coalesce(inputs -> 'general', '[]'::jsonb), 2147483647
    ),
    pm as (
      select mon.m, mon.ord, mon.mi, mon.last, part.pid, part.pord from mon cross join part
    ),
    -- Every charge but a loan's payment (its interest and escrow come from the loan), under its part.
    party as (
      select
        r ->> 'direction' as direction,
        r ->> 'party_id' as party,
        coalesce(r ->> 'name', '') as name,
        r ->> 'currency' as currency,
        (r ->> 'typical_amount_minor')::bigint as amount,
        (r ->> 'typical_day')::integer as day,
        case when r ->> 'project_id' is null or r ->> 'project_id' = overhead then '' else r ->> 'project_id' end as pid,
        r ->> 'category_id' as cat,
        private.forecast_pace_months(r ->> 'pace') as pace_months,
        -- dueInMonth: a charge that is late, or has no due month, counts from this month.
        private.forecast_month_index(case
          when r ->> 'next_due_month' is null or left(r ->> 'next_due_month', 7) collate "C" < this_month then this_month
          else left(r ->> 'next_due_month', 7) end) as from_mi,
        r ->> 'ends_on' as ends_on
      from jsonb_array_elements(coalesce(p_input -> 'recurring', '[]'::jsonb)) r
      where (r ->> 'pays_loan')::boolean is not true
    ),
    ld as (
      select * from jsonb_to_recordset(due_rows) as x(
        m text, pid text, loan_id text, interest bigint, escrow bigint, principal bigint,
        icat text, iname text, ecat text, ename text)
    ),
    -- loanParts: several loans' parts in one category sum into one row; a zero part makes none.
    loan_part as (
      select q.m, q.pid, q.cat, min(q.name) as name, sum(q.minor)::bigint as minor
      from (
        select ld.m, ld.pid, ld.icat as cat, ld.iname as name, ld.interest as minor from ld where ld.icat is not null and ld.interest > 0
        union all
        select ld.m, ld.pid, ld.ecat, ld.ename, ld.escrow from ld where ld.ecat is not null and ld.escrow > 0
      ) q
      group by q.m, q.pid, q.cat
    ),
    -- loanCashOnly: the principal, and an interest or escrow part no row holds.
    loan_cash as (
      select c.* from (
        select ld.m, ld.pid, ld.loan_id,
          greatest(ld.principal, 0)
            + case when ld.icat is null then greatest(ld.interest, 0) else 0 end
            + case when ld.ecat is null then greatest(ld.escrow, 0) else 0 end as minor,
          array_remove(array[
            case when ld.icat is not null and ld.interest > 0 then ld.icat end,
            case when ld.ecat is not null and ld.escrow > 0 then ld.ecat end
          ], null) as row_cats
        from ld
      ) c
      where c.minor <> 0
    ),
    -- A category any charge of the part files to (in any currency, due or not) or a loan row fills is not averaged.
    filled as (
      select pm.m, pm.pid, p.cat from pm join party p on p.pid = pm.pid where p.cat is not null
      union
      select lp.m, lp.pid, lp.cat from loan_part lp
    ),
    -- The part's category months: each category's total, and where its first cost is.
    pcat as (
      select part.pid, c ->> 'id' as id, c ->> 'name' as name, c ->> 'currency' as currency,
        jsonb_array_length(coalesce(c -> 'months_minor', '[]'::jsonb)) as len,
        (select coalesce(sum(e.v::bigint), 0) from jsonb_array_elements_text(coalesce(c -> 'months_minor', '[]'::jsonb)) e(v))::bigint as total,
        (select min(e.o) - 1 from jsonb_array_elements_text(coalesce(c -> 'months_minor', '[]'::jsonb)) with ordinality e(v, o) where e.v::bigint <> 0) as first
      from part cross join jsonb_array_elements(part.cats) c
    ),
    -- averageMonths: from the window's first month with any of the part's costs to its end, at least 1.
    divisor as (
      select part.pid, greatest(w.len - least(w.len, coalesce(w.first, w.len)), 1)::bigint as d
      from part
      cross join lateral (
        select coalesce(nullif(max(pc.len), 0), 6) as len, min(pc.first) as first
        from pcat pc where pc.pid = part.pid
      ) w
    ),
    -- Each category's average in the currency, rounded half away from zero; one that is not above zero makes no row.
    average as (
      select pc.pid, pc.id, pc.name, a.average
      from pcat pc
      join divisor dv on dv.pid = pc.pid
      cross join lateral (
        select case when pc.total < 0 then -((-pc.total + dv.d / 2) / dv.d) else (pc.total + dv.d / 2) / dv.d end as average
      ) a
      where pc.currency = cur and a.average > 0
    ),
    base as (
      -- The charges due in the month (dueInMonth), on their usual day.
      select pm.m, pm.pid, 'rec:' || p.direction || ':' || p.party as key, 'recurring' as kind, p.direction, p.name,
        d.date,
        case when p.direction = 'income' then abs(p.amount) else -abs(p.amount) end as minor,
        p.cat as category_id, null::text as pace
      from pm
      join party p on p.pid = pm.pid
      cross join lateral (select pm.m || '-' || lpad(greatest(1, least(coalesce(p.day, 1), pm.last))::text, 2, '0') as date) d
      where p.currency = cur
        and pm.mi - p.from_mi >= 0
        and (pm.mi - p.from_mi) % p.pace_months = 0
        and (p.ends_on is null or d.date collate "C" <= p.ends_on)
      union all
      -- The loans' interest and escrow due in the month, each under its category's key.
      select lp.m, lp.pid, 'avg:' || lp.cat, 'loan', 'expense', lp.name, null, -lp.minor, lp.cat, null
      from loan_part lp
      union all
      -- One average row per category nothing fills.
      select pm.m, pm.pid,
        case when av.id is null then 'avg:none' else 'avg:' || av.id end, 'average', 'expense',
        case when av.id is null then 'אחר' else coalesce(av.name, '') end,
        null, -av.average, av.id, null
      from pm
      join average av on av.pid = pm.pid
      where av.id is null or not exists (select 1 from filled fl where fl.m = pm.m and fl.pid = pm.pid and fl.cat = av.id)
    ),
    -- Each month's edits (monthEdits, companyMonthInput): next month's own, else the later months' with the month's
    -- match, else (an older payload) next month's with none matched.
    ed as (
      select mon.m, mon.mi, e.n,
        e.j ->> 'id' as id,
        e.j ->> 'kind' as kind,
        e.j ->> 'row_key' as row_key,
        e.j ->> 'category_id' as category_id,
        e.j ->> 'category_name' as category_name,
        e.j ->> 'direction' as direction,
        (e.j ->> 'amount_minor')::bigint as amount,
        e.j ->> 'pace' as pace,
        e.j ->> 'start_month' as start_month,
        case
          when mon.m = inputs ->> 'month' then e.j ->> 'matched_transaction_id'
          when jsonb_typeof(inputs -> 'rest_edits') = 'array' then e.j -> 'matches' ->> mon.m
        end as matched,
        case when overhead is not null and e.j ->> 'project_id' = overhead then '' else e.j ->> 'project_id' end as pid
      from mon
      cross join lateral jsonb_array_elements(case
        when mon.m = inputs ->> 'month' or jsonb_typeof(inputs -> 'rest_edits') is distinct from 'array'
        then coalesce(inputs -> 'edits', '[]'::jsonb)
        else inputs -> 'rest_edits' end) with ordinality e(j, n)
    ),
    -- skipEdits: a month's skips as one-month removals of a part's charge rows, after the part's own edits.
    skip as (
      select mon.m, s.n, s.k, string_to_array(s.k, ':') as f
      from mon
      cross join lateral jsonb_array_elements_text(case
        when jsonb_typeof(inputs -> 'skips' -> mon.m) = 'array' then inputs -> 'skips' -> mon.m else '[]'::jsonb end) with ordinality s(k, n)
    ),
    edit as (
      select ed.m, ed.pid, ed.n, ed.id, ed.kind, ed.row_key, ed.category_id, ed.category_name, ed.direction, ed.amount, ed.pace, ed.start_month, ed.matched
      from ed
      where exists (select 1 from part where part.pid = ed.pid)
        -- editApplies.
        and ed.mi - private.forecast_month_index(ed.start_month) >= 0
        and case when ed.pace = 'once' then ed.mi = private.forecast_month_index(ed.start_month)
                 else (ed.mi - private.forecast_month_index(ed.start_month)) % private.forecast_pace_months(ed.pace) = 0 end
      union all
      select skip.m, pm.pid, 1000000 + skip.n, 'skip:' || skip.k, 'remove', 'rec:' || skip.f[2] || ':' || skip.f[3],
        null, null, null, null, 'once', skip.m, null
      from skip
      join pm on pm.m = skip.m
      where skip.f[1] = 'party'
        and skip.f[2] in ('income', 'expense')
        and coalesce(skip.f[3], '') <> ''
        and (skip.f[5] is null or case when pm.pid = '' then skip.f[5] = 'none' or skip.f[5] = overhead else skip.f[5] = pm.pid end)
    ),
    -- The lines the user added (applyForecastEdits), after the rows.
    added as (
      select edit.m, edit.pid, 'add:' || edit.id as key, 'added' as kind,
        case when edit.direction = 'income' then 'income' else 'expense' end as direction,
        coalesce(edit.category_name, '') as name, null::text as date,
        case when edit.direction = 'income' then edit.amount else -edit.amount end as minor,
        edit.category_id, edit.pace
      from edit
      where edit.kind = 'add' and edit.amount is not null
    ),
    -- The latest start that applies wins; of equal starts, the first.
    change as (
      select distinct on (edit.m, edit.pid, edit.row_key) edit.m, edit.pid, edit.row_key, edit.amount
      from edit
      where edit.kind = 'change' and edit.amount is not null and edit.row_key is not null
      order by edit.m, edit.pid, edit.row_key, edit.start_month collate "C" desc, edit.n
    ),
    -- A row taken out: by the project page (removed) or only by a skip (skipped, FLOW-1079).
    removal as (
      select edit.m, edit.pid, edit.row_key, bool_or(left(edit.id, 5) <> 'skip:') as page
      from edit where edit.kind = 'remove' and edit.row_key is not null
      group by edit.m, edit.pid, edit.row_key
    ),
    arrival as (
      select distinct edit.m, edit.pid, 'add:' || edit.id as key from edit where edit.kind = 'add' and edit.matched is not null
    ),
    edited as (
      select r.m, r.pid, r.key, r.kind, r.direction, r.name, r.date,
        case when c.row_key is null then r.minor when r.direction = 'income' then c.amount else -c.amount end as minor,
        r.category_id,
        case when c.row_key is null then null else r.minor end as was_minor,
        r.pace,
        case when rm.row_key is null then 'row' when rm.page then 'removed' else 'skipped' end as list,
        rm.row_key is null and av.key is not null as arrived
      from (select * from base union all select * from added) r
      left join change c on c.m = r.m and c.pid = r.pid and c.row_key = r.key
      left join removal rm on rm.m = r.m and rm.pid = r.pid and rm.row_key = r.key
      left join arrival av on av.m = r.m and av.pid = r.pid and av.key = r.key
    ),
    row_json as (
      select e.m, e.pid, e.list, e.arrived, e.key, e.minor, e.kind, e.category_id, e.name,
        case when with_rows then jsonb_strip_nulls(jsonb_build_object(
          'key', e.key, 'kind', e.kind, 'direction', e.direction, 'name', e.name, 'date', e.date, 'minor', e.minor,
          'category_id', e.category_id, 'was_minor', e.was_minor, 'pace', e.pace)) end as j,
        coalesce(e.date, '') as day
      from edited e
    ),
    -- withTotals, per part: the rows left (not taken out, not arrived), its totals and its lists.
    part_rows as (
      select r.m, r.pid,
        coalesce(sum(r.minor) filter (where r.list = 'row' and not r.arrived and r.minor > 0), 0)::bigint as income,
        coalesce(-sum(r.minor) filter (where r.list = 'row' and not r.arrived and r.minor < 0), 0)::bigint as expense,
        count(*) filter (where r.list = 'row' and not r.arrived) > 0 as kept,
        -- Rows by key (then amount, day and name), not in the app's order: the app sorts them.
        coalesce(jsonb_agg(r.j order by r.key collate "C", r.minor, r.day collate "C", r.name collate "C") filter (where with_rows and r.list = 'row' and not r.arrived), '[]'::jsonb) as rows,
        coalesce(jsonb_agg(r.j order by r.key collate "C", r.minor, r.day collate "C", r.name collate "C") filter (where with_rows and r.list = 'removed'), '[]'::jsonb) as removed,
        coalesce(jsonb_agg(r.j order by r.key collate "C", r.minor, r.day collate "C", r.name collate "C") filter (where with_rows and r.list = 'row' and r.arrived), '[]'::jsonb) as arrived
      from row_json r
      group by r.m, r.pid
    ),
    -- The rows taken out, built once (not once per loan).
    taken as materialized (
      select distinct r.m, r.pid, r.key from row_json r where r.list <> 'row'
    ),
    -- Each loan's cash counts unless every row of it was taken out (removed or skipped).
    part_cash as (
      select lc.m, lc.pid,
        coalesce(sum(lc.minor) filter (where cardinality(lc.row_cats) = 0 or exists (
          select 1 from unnest(lc.row_cats) rc
          where not exists (select 1 from taken t where t.m = lc.m and t.pid = lc.pid and t.key = 'avg:' || rc))), 0)::bigint as cash_only,
        jsonb_agg(jsonb_build_object('loan_id', lc.loan_id, 'row_category_ids', to_jsonb(lc.row_cats), 'minor', lc.minor)
          order by lc.loan_id collate "C") as loan_cash
      from loan_cash lc
      group by lc.m, lc.pid
    ),
    part_out as (
      select pm.m, pm.ord, pm.pid, pm.pord, dv.d as average_months,
        coalesce(pr.income, 0) as income, coalesce(pr.expense, 0) as expense, coalesce(pc.cash_only, 0) as cash_only,
        coalesce(pr.kept, false) as kept, pr.rows, pr.removed, pr.arrived, coalesce(pc.loan_cash, '[]'::jsonb) as loan_cash
      from pm
      join divisor dv on dv.pid = pm.pid
      left join part_rows pr on pr.m = pm.m and pr.pid = pm.pid
      left join part_cash pc on pc.m = pm.m and pc.pid = pm.pid
    ),
    -- isRent: the first category with the id is named שכירות, or is a sub-category of one.
    rent_cat as (
      select distinct on (x.c ->> 'id') x.c ->> 'id' as id,
        starts_with(coalesce(x.c ->> 'name', ''), 'שכירות') or coalesce((
          select starts_with(coalesce(p.c ->> 'name', ''), 'שכירות')
          from jsonb_array_elements(cats) with ordinality p(c, n)
          where p.c ->> 'id' = x.c ->> 'parent_id'
          order by p.n limit 1
        ), false) as rent
      from jsonb_array_elements(cats) with ordinality x(c, n)
      where x.c ->> 'id' is not null
      order by x.c ->> 'id', x.n
    ),
    -- The income rows, as the card's note reads them (a part with one has a row, so it counts).
    income_row as (
      select r.m, array_position(months, r.m) as ord, r.pid, r.key, r.kind, r.name, r.minor, r.day,
        r.kind = 'recurring' and coalesce(rc.rent, false) as rent
      from row_json r
      left join rent_cat rc on rc.id = r.category_id
      where r.list = 'row' and not r.arrived and r.minor > 0
    ),
    month_income as (
      select ir.m,
        jsonb_build_object('rows', count(*), 'recurring', count(*) filter (where ir.kind = 'recurring'), 'rent', count(*) filter (where ir.rent))
          || case when count(*) = 1 then jsonb_build_object('name', min(ir.name)) else '{}'::jsonb end as income
      from income_row ir
      group by ir.m
    ),
    -- companyNextMonthForecast: the parts with a row, summed.
    month_parts as (
      select po.m,
        sum(po.income)::bigint as income,
        sum(po.expense)::bigint as expense,
        sum(po.cash_only)::bigint as cash_only,
        count(*) filter (where po.pid <> '') as projects,
        bool_or(po.pid = '') as general,
        jsonb_agg(
          case when po.pid = '' then '{}'::jsonb else jsonb_build_object('project_id', po.pid) end || jsonb_build_object(
            'income_minor', po.income,
            'expense_minor', po.expense,
            'cash_only_minor', po.cash_only,
            'average_months', po.average_months,
            'rows', po.rows,
            'removed', po.removed,
            'arrived', po.arrived,
            'loan_cash', po.loan_cash
          ) order by po.pord) filter (where with_rows) as parts
      from part_out po
      where po.kept
      group by po.m
    ),
    month_skipped as (
      select r.m,
        jsonb_agg(case when r.pid = '' then '{}'::jsonb else jsonb_build_object('project_id', r.pid) end || r.j
          order by r.pid collate "C", r.key collate "C", r.minor, r.day collate "C", r.name collate "C") as skipped
      from row_json r
      where with_rows and r.list = 'skipped'
      group by r.m
    ),
    month_out as (
      select mon.m, mon.ord, jsonb_build_object(
        'month', mon.m,
        'income_minor', coalesce(mp.income, 0),
        'expense_minor', coalesce(mp.expense, 0),
        'net_minor', coalesce(mp.income - mp.expense, 0),
        'cash_only_minor', coalesce(mp.cash_only, 0),
        'projects', coalesce(mp.projects, 0),
        'general', coalesce(mp.general, false),
        'income', coalesce(mi.income, '{"rows": 0, "recurring": 0, "rent": 0}'::jsonb)
      ) || case when with_rows then jsonb_build_object(
        'parts', coalesce(mp.parts, '[]'::jsonb),
        'skipped', coalesce(ms.skipped, '[]'::jsonb)
      ) else '{}'::jsonb end as j
      from mon
      left join month_parts mp on mp.m = mon.m
      left join month_income mi on mi.m = mon.m
      left join month_skipped ms on ms.m = mon.m
    ),
    -- restIncomeNote: each stream (project and key) once over the months, its first row.
    stream as (
      select distinct on (ir.pid, ir.key) ir.kind, ir.name, ir.rent
      from income_row ir
      order by ir.pid, ir.key, ir.ord, ir.minor, ir.day collate "C", ir.name collate "C"
    ),
    -- splitPartyKeys: every charge, a loan's payment included.
    split as (
      select 'party:' || (r ->> 'direction') || ':' || (r ->> 'party_id') || ':' || (r ->> 'currency') as k
      from jsonb_array_elements(coalesce(p_input -> 'recurring', '[]'::jsonb)) r
      group by 1
      having count(*) > 1
    )
    select jsonb_build_object(
      'months', coalesce((select jsonb_agg(mo.j order by mo.ord) from month_out mo), '[]'::jsonb),
      'income', (
        select jsonb_build_object('rows', count(*), 'recurring', count(*) filter (where s.kind = 'recurring'), 'rent', count(*) filter (where s.rent))
          || case when count(*) = 1 then jsonb_build_object('name', min(s.name)) else '{}'::jsonb end
        from stream s
      )
    ) || case when with_rows then jsonb_build_object(
      'split_keys', coalesce((select jsonb_agg(split.k order by split.k collate "C") from split), '[]'::jsonb)
    ) else '{}'::jsonb end
  );
end;
$$;

comment on function private.company_forecast_build(jsonb) is
  'FLOW-1307. companyNextMonthForecast with each month''s edits and skips (app/src/company-next-month.ts, company-year-forecast.ts, project-next-month.ts, project-next-loans.ts) as a pure function of what the app reads, for every month asked; each loan''s payments left are built once per call. Same figures as the TypeScript for the shared vectors (packages/shared/fixtures/vectors/company-forecast).';

revoke all on function private.company_forecast_build(jsonb) from public, anon, authenticated;
-- It reads no table: public.company_forecast runs as the caller and calls it.
grant execute on function private.company_forecast_build(jsonb) to authenticated, service_role;

create function public.company_forecast(p_months text[], p_detail text, p_today date default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  -- Today in Israel unless the app passes its own day (israelToday()).
  today date := coalesce(p_today, (now() at time zone 'Asia/Jerusalem')::date);
  this_month date := date_trunc('month', today)::date;
  horizon text[];
  next_month text;
  inputs jsonb;
  expected jsonb;
  cid uuid;
  base text;
  loan_list jsonb;
  cat_list jsonb;
  built jsonb;
begin
  -- FLOW-1066: the forecast's months, next month to the same month next year (forecast-horizon.ts).
  horizon := array(
    select to_char(m, 'YYYY-MM')
    from generate_series(this_month + interval '1 month', this_month + interval '12 months', interval '1 month') m
  );
  next_month := horizon[1];
  if p_detail is null or p_detail not in ('totals', 'rows')
     or p_months is null or cardinality(p_months) = 0
     or exists (select 1 from unnest(p_months) m where m is null or not m = any(horizon))
     or (select count(distinct m) from unnest(p_months) m) <> cardinality(p_months) then
    raise exception 'validation' using errcode = '22023';
  end if;
  -- Refuses a caller with no company first (42501), as the other reads do. The later months' edits only when a
  -- month after next is asked (FLOW-1171).
  inputs := public.company_next_month_inputs(today, exists (select 1 from unnest(p_months) m where m <> next_month));
  expected := public.expected_months(0, null, today);
  cid := private.readable_company_id();
  base := private.company_base_currency(cid);
  -- The company's open loans in its currency, as readForecastLoans reads them: the terms and rates, the balance in
  -- the books (the principal with none), and the stored schedule's due dates (none unless it was built).
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id,
      'currency', l.currency,
      'projectId', l.project_id,
      'status', l.status::text,
      'balanceMinor', coalesce(b.balance_minor, l.principal_minor),
      'categoryIds', jsonb_build_object('interest', l.interest_category_id, 'escrow', l.escrow_category_id),
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
      'dueDates', coalesce((
        select jsonb_agg(to_char(s.due_date, 'YYYY-MM-DD') order by s.period)
        from public.loan_schedule_rows s
        where s.loan_id = l.id
      ), '[]'::jsonb)
    ) order by l.id), '[]'::jsonb)
  into loan_list
  from public.loans l
  left join public.loan_balances b on b.loan_id = l.id
  where l.company_id = cid
    and l.status = 'open'::public.loan_status
    and l.currency = base;
  -- The categories in list_categories' order: a loan part with no category of its own files to the first keyed one.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'loan_part', c.loan_part,
      'excluded_from_pnl', c.excluded_from_pnl,
      'parent_id', c.parent_id
    ) order by c.kind, c.sort_order, c.name), '[]'::jsonb)
  into cat_list
  from public.categories c
  where c.company_id = cid;
  built := private.company_forecast_build(jsonb_build_object(
    'currency', base,
    'today', to_char(today, 'YYYY-MM-DD'),
    'months', to_jsonb(p_months),
    'recurring', coalesce(expected -> 'recurring', '[]'::jsonb),
    'loans', loan_list,
    'categories', cat_list,
    'inputs', inputs,
    'detail', p_detail
  ));
  return jsonb_build_object('today', to_char(today, 'YYYY-MM-DD'), 'currency', base) || built;
end;
$$;

comment on function public.company_forecast(text[], text, date) is
  'FLOW-1307. The company forecast of Profit''s next-month card and year view, Home''s future months and the company forecast pages in one read. p_months: yyyy-mm months of the forecast (next month to 12 months ahead), each once, answered in that order. p_detail ''totals'': { today, currency, months: [{ month, income_minor, expense_minor, net_minor, cash_only_minor, projects, general, income: { rows, recurring, rent, name } }], income } (income over every month asked, each stream once). ''rows'' adds per month parts: [{ project_id, income_minor, expense_minor, cash_only_minor, average_months, rows, removed, arrived, loan_cash }] and skipped, and split_keys. absent = null; rows unsorted (by key), the app sorts them. p_today default: today in Israel. security invoker: the caller''s company only.';

revoke all on function public.company_forecast(text[], text, date) from public, anon, authenticated;
grant execute on function public.company_forecast(text[], text, date) to authenticated, service_role;

commit;
