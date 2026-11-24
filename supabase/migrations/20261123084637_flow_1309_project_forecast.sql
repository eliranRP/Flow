-- FLOW-1309 (plan FLOW-1275, slice 8): the project forecast in the database. Adds three functions and patches one
-- (private.company_forecast_build, one new optional input key, same answer without it); changes no table and no
-- other read.
-- - private.company_forecast_build: FLOW-1307's core, with one new optional input key, allParts. With it true the
--   month's parts list every project's part, a part with no row left included (a project's own page needs its removed
--   rows and its loans' cash even when it has no row). Without it nothing changes: the company's read is the same
--   answer (the company-forecast vectors and flow_1307_company_forecast.test.sql hold it). Patched in place, as
--   20261114123108 did for company_next_month_inputs: each anchor must be found once, or the migration fails.
-- - private.project_forecast_order_rows(p_rows): a list of rows in the TypeScript builder's order. The core lists rows
--   by key (the company's app sorts them); a project's צפי page lists them as nextMonthForecast does, with no sort of
--   its own: the recurring charges by expected day then name, the loan rows by their own amount (the biggest cost
--   first) then name, the average rows the same, then the lines the user added in the edits' order. Names compare as
--   localeCompare(..., "he") does (the he-x-icu collation); an edited row keeps its place (was_minor is its amount
--   before the edit).
-- - private.project_forecast_build(p_input jsonb): nextMonthForecast, applyForecastEdits, skipEdits and cashForecast
--   (app/src/project-next-month.ts, company-next-month.ts) for one project's month, as one pure function: it runs
--   FLOW-1307's core on the one project (or, for the company's overhead project, the general costs, as
--   companyGeneralForecast builds them) and shapes the answer the project page's card, its צפי page and its edit
--   page read. Immutable, reads no table, gives the figures the TypeScript gives for every shared vector
--   (packages/shared/fixtures/vectors/project-forecast, run by vectors_project_forecast.test.sql and by
--   app/src/project-forecast-vectors.test.ts; the README there has the input).
-- - public.project_forecast(p_project, p_month, p_today, p_currency): security invoker. Gathers for the one project
--   what the page reads today: its charges (expected_months(0, project)), its category months (the lean read of this
--   one project, as company_next_month_inputs reads them for every project), the month's edits and overrides, its
--   loans with their balances, rates and stored schedules, and the company's categories; the loans' rest of schedule
--   is built per read, once per loan, by the core. For the overhead project it reads the general costs' months from
--   company_next_month_inputs (the overhead page reads the whole company's inputs today, so it pays no more).
--
-- Answer of public.project_forecast (absent = null; amounts are minor units of the forecast's currency):
--   { today, month, currency,
--     general,                         true on the company's overhead project's page: the general costs (FLOW-1002)
--     income_minor, expense_minor,     profit terms: the rows left, each side positive (nextMonthForecast with the edits)
--     net_minor,                       income less expense, before the share of general expenses
--     cash_only_minor,                 the loans' payments the profit leaves out (the principal, and an interest or
--                                      escrow part kept out of the profit), less the loans whose every row was taken out
--     cash_expense_minor,              cash terms (cashForecast: the project page's card): expense_minor + cash_only_minor
--     cash_net_minor,                  and net_minor - cash_only_minor
--     loan_count,                      the loan rows (the צפי page's note names the loan's schedule)
--     average_months,                  the months an average is over (the window from the project's first expense in it)
--     income: { rows, recurring, rent, name },   the card's income note: the income rows, how many are recurring, how many
--                                      of those are rent (isRent), and the name when there is one row; no categories read
--     rows, removed, skipped,          the rows left, the rows the user took out, the rows only a skip (FLOW-1079) took out
--     edited,                          an edit of the project starts in this month: the צפי page's reset (איפוס) button
--     overrides: [{ item_key, amount_minor, due_on, moved_out }],   forecast_overrides_for(month) as the page's
--                                      skip (לא החודש) and restore read it
--     history: { months: [yyyy-mm-dd], categories: [{ id, currency, months_minor }] },   the edit page's history bars and
--                                      category hints: the six months before this one, oldest first, and the project's
--                                      expense months by category in the forecast's currency (id absent: uncategorized)
--     charges: [{ category_id, amount_minor, pace }] }   the edit page's category hints: the project's charges with a
--                                      category, in the forecast's currency, a loan's payment aside, in expected_months'
--                                      order; amount_minor is positive
--   A row is { key, kind, direction, name, date, minor (signed), category_id, was_minor, pace }, in the builder's order
--   (above); arrived (an added line whose bank line came) and the loans' cash by loan are in no row and no screen reads
--   them, so they are left out here (add, never replace).
--   The company's categories (the edit page's category sheet) are not in it: list_categories is read by every screen.
--
-- Refusals, as get_project and project_category_months (neighbouring project reads): a caller with no company, and a
-- project that is not in the caller's company, get null; a bad argument raises 22023 first (a null project, a month
-- outside the forecast's: next month to 12 months after this one, a currency that is not three capital letters).
-- Today: p_today null is today in Israel (Asia/Jerusalem), inline, since authenticated cannot execute
-- private.flow_today(). The same day goes to every read gathered.
-- p_currency: the forecast's currency. Null is the company's. The project page passes the currency of its figures (its
-- first by_currency row), which is not the company's for a project that only ever moved another currency; the overhead
-- project's general costs are always the company's (0147).
begin;

set local lock_timeout = '5s';

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

do $core$
declare
  def text := pg_get_functiondef('private.company_forecast_build(jsonb)'::regprocedure);
begin
  def := pg_temp.swap(def, $a$  with_rows boolean := p_input ->> 'detail' is distinct from 'totals';$a$,
    $b$  with_rows boolean := p_input ->> 'detail' is distinct from 'totals';
  -- FLOW-1309: every project's part is listed, a part with no row left included (a project's own page).
  all_parts boolean := coalesce((p_input ->> 'allParts')::boolean, false);$b$);
  def := pg_temp.swap(def, $a$      where po.kept or po.pid = ''$a$, $b$      where po.kept or po.pid = '' or all_parts$b$);
  execute def;
end
$core$;

drop function pg_temp.swap(text, text, text);

create function private.project_forecast_order_rows(p_rows jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(r.j order by
    (r.j ->> 'kind') = 'added',
    case r.j ->> 'kind' when 'recurring' then 0 when 'loan' then 1 else 2 end,
    case when r.j ->> 'kind' = 'recurring' then coalesce(r.j ->> 'date', '') end collate "C",
    case when r.j ->> 'kind' in ('loan', 'average') then coalesce((r.j ->> 'was_minor')::bigint, (r.j ->> 'minor')::bigint) end,
    case when r.j ->> 'kind' <> 'added' then r.j ->> 'name' end collate "he-x-icu",
    r.n), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality r(j, n);
$$;

revoke all on function private.project_forecast_order_rows(jsonb) from public, anon, authenticated;
grant execute on function private.project_forecast_order_rows(jsonb) to authenticated, service_role;

-- One project's month, as a pure function of what the project page reads. Input (the vectors' input):
--   { projectId, general?, currency, today, month,
--     recurring: expected_months' recurring[] (the project's charges; with general, the company's: the build keeps the
--                ones of no project or of the overhead project),
--     categoryMonths: [{ id, name, currency, months_minor }]   the project's category months (the general costs' with general),
--     edits: project_forecast_edits_for(project, month),
--     overrides: forecast_overrides_for(month),
--     loans, categories }                                       as private.company_forecast_build takes them
-- Output: the answer of public.project_forecast (see the header).
create function private.project_forecast_build(p_input jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  pid text := p_input ->> 'projectId';
  general boolean := coalesce((p_input ->> 'general')::boolean, false);
  cur text := p_input ->> 'currency';
  today date := (p_input ->> 'today')::date;
  month text := p_input ->> 'month';
  months jsonb := coalesce(p_input -> 'categoryMonths', '[]'::jsonb);
  recurring jsonb;
  loans jsonb;
  edits jsonb;
  overrides jsonb := coalesce(p_input -> 'overrides', '[]'::jsonb);
  built jsonb;
  mon jsonb;
  part jsonb;
  skipped jsonb;
  income_minor bigint;
  expense_minor bigint;
  cash_only bigint;
  rows jsonb;
begin
  -- The project's charges (or the general costs': none, or the overhead project's), and its loans.
  select coalesce(jsonb_agg(r), '[]'::jsonb) into recurring
  from jsonb_array_elements(coalesce(p_input -> 'recurring', '[]'::jsonb)) r
  where case when general then r ->> 'project_id' is null or r ->> 'project_id' = pid else r ->> 'project_id' = pid end;
  select coalesce(jsonb_agg(l), '[]'::jsonb) into loans
  from jsonb_array_elements(coalesce(p_input -> 'loans', '[]'::jsonb)) l
  where case when general then l ->> 'projectId' is null or l ->> 'projectId' = pid else l ->> 'projectId' = pid end;
  -- Every edit belongs to the project (the core reads each edit's project).
  select coalesce(jsonb_agg(e || jsonb_build_object('project_id', pid)), '[]'::jsonb) into edits
  from jsonb_array_elements(coalesce(p_input -> 'edits', '[]'::jsonb)) e;

  built := private.company_forecast_build(jsonb_build_object(
    'currency', cur,
    'today', to_char(today, 'YYYY-MM-DD'),
    'months', jsonb_build_array(month),
    'detail', 'rows',
    'allParts', true,
    'recurring', recurring,
    'loans', loans,
    'categories', coalesce(p_input -> 'categories', '[]'::jsonb),
    'inputs', jsonb_build_object(
      'month', month,
      'overhead_project_id', case when general then to_jsonb(pid) end,
      'projects', case when general then '[]'::jsonb
        else jsonb_build_array(jsonb_build_object('project_id', pid, 'categories', months)) end,
      'general', case when general then months else '[]'::jsonb end,
      'edits', edits,
      -- skipEdits: the month's items taken out of it only (moved_out), by key.
      'skips', jsonb_build_object(month, coalesce((
        select jsonb_agg(o ->> 'item_key' order by o ->> 'item_key' collate "C")
        from jsonb_array_elements(overrides) o
        where (o ->> 'moved_out')::boolean is true
      ), '[]'::jsonb))
    )
  ));
  mon := built -> 'months' -> 0;
  -- The project's part: listed whether or not a row is left; the general costs' part has no project_id.
  select p into part
  from jsonb_array_elements(mon -> 'parts') p
  where case when general then p ->> 'project_id' is null else p ->> 'project_id' = pid end;
  select coalesce(jsonb_agg(s - 'project_id'), '[]'::jsonb) into skipped
  from jsonb_array_elements(mon -> 'skipped') s
  where case when general then s ->> 'project_id' is null else s ->> 'project_id' = pid end;

  income_minor := (part ->> 'income_minor')::bigint;
  expense_minor := (part ->> 'expense_minor')::bigint;
  cash_only := (part ->> 'cash_only_minor')::bigint;
  rows := private.project_forecast_order_rows(part -> 'rows');
  return jsonb_build_object(
    'today', to_char(today, 'YYYY-MM-DD'),
    'month', month,
    'currency', cur,
    'general', general,
    'income_minor', income_minor,
    'expense_minor', expense_minor,
    'net_minor', income_minor - expense_minor,
    'cash_only_minor', cash_only,
    'cash_expense_minor', expense_minor + cash_only,
    'cash_net_minor', income_minor - expense_minor - cash_only,
    'loan_count', (select count(*) from jsonb_array_elements(rows) r where r ->> 'kind' = 'loan'),
    'average_months', (part ->> 'average_months')::integer,
    'income', mon -> 'income',
    'rows', rows,
    'removed', private.project_forecast_order_rows(part -> 'removed'),
    'skipped', private.project_forecast_order_rows(skipped),
    'edited', exists (select 1 from jsonb_array_elements(coalesce(p_input -> 'edits', '[]'::jsonb)) e where e ->> 'start_month' = month),
    'overrides', coalesce((select jsonb_agg(jsonb_strip_nulls(o)) from jsonb_array_elements(overrides) o), '[]'::jsonb),
    'history', jsonb_build_object(
      -- The six complete months before this one, as project_category_months labels them.
      'months', (select jsonb_agg(to_char(m, 'YYYY-MM-DD') order by m)
        from generate_series(date_trunc('month', today)::date - interval '6 months', date_trunc('month', today)::date - interval '1 month', interval '1 month') m),
      'categories', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', c.j ->> 'id', 'currency', c.j ->> 'currency', 'months_minor', c.j -> 'months_minor')) order by c.n)
        from jsonb_array_elements(months) with ordinality c(j, n)
        where c.j ->> 'currency' = cur
      ), '[]'::jsonb)
    ),
    'charges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', r.j ->> 'category_id',
        'amount_minor', abs((r.j ->> 'typical_amount_minor')::bigint),
        'pace', coalesce(r.j ->> 'pace', 'month')) order by r.n)
      from jsonb_array_elements(recurring) with ordinality r(j, n)
      where (r.j ->> 'pays_loan')::boolean is not true
        and r.j ->> 'currency' = cur
        and r.j ->> 'category_id' is not null
    ), '[]'::jsonb)
  );
end;
$$;

comment on function private.project_forecast_build(jsonb) is
  'FLOW-1309. nextMonthForecast with the project''s edits and skips and cashForecast (app/src/project-next-month.ts, company-next-month.ts) for one project''s month, as a pure function of what the project page reads, on FLOW-1307''s core; for the overhead project the general costs (companyGeneralForecast). Same figures as the TypeScript for the shared vectors (packages/shared/fixtures/vectors/project-forecast).';

revoke all on function private.project_forecast_build(jsonb) from public, anon, authenticated;
-- It reads no table: public.project_forecast runs as the caller and calls it.
grant execute on function private.project_forecast_build(jsonb) to authenticated, service_role;

create function public.project_forecast(p_project uuid, p_month text, p_today date default null, p_currency text default null)
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
  cid uuid;
  base text;
  overhead uuid;
  general boolean;
  cur text;
  months jsonb;
  loan_list jsonb;
  cat_list jsonb;
begin
  -- FLOW-1066: the forecast's months, next month to the same month next year (forecast-horizon.ts).
  if p_project is null or p_month is null
     or not p_month = any(array(
       select to_char(m, 'YYYY-MM')
       from generate_series(this_month + interval '1 month', this_month + interval '12 months', interval '1 month') m))
     or (p_currency is not null and p_currency !~ '^[A-Z]{3}$') then
    raise exception 'validation' using errcode = '22023';
  end if;
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  select c.overhead_project_id into overhead from public.companies c where c.id = cid;
  if not exists (select 1 from public.projects p where p.id = p_project and p.company_id = cid) then
    return null;
  end if;
  base := private.company_base_currency(cid);
  general := overhead is not distinct from p_project;
  cur := case when general then base else coalesce(p_currency, base) end;

  -- The project's category months: the lean read of this one project (24 ms for Flow QA's largest, against 60 ms for
  -- all 14). The general costs' come with the company's inputs, as the overhead page reads them today.
  if general then
    months := public.company_next_month_inputs(today, false) -> 'general';
  else
    select m.categories into months from private.project_category_months_lean(array[p_project], 6, today) m;
  end if;
  -- The loans of the project (of no project or the overhead one, for the general costs) in the forecast's currency, as
  -- readForecastLoans reads them: the terms and rates, the balance in the books (the principal with none), and the
  -- stored schedule's due dates (none unless it was built).
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
    and l.currency = cur
    and case when general then l.project_id is null or l.project_id = p_project else l.project_id = p_project end;
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

  return private.project_forecast_build(jsonb_build_object(
    'projectId', p_project,
    'general', general,
    'currency', cur,
    'today', to_char(today, 'YYYY-MM-DD'),
    'month', p_month,
    -- The charges of the project (the whole company's for the general costs: the build keeps its own).
    'recurring', coalesce(public.expected_months(0, case when general then null else p_project end, today) -> 'recurring', '[]'::jsonb),
    'categoryMonths', coalesce(months, '[]'::jsonb),
    'edits', public.project_forecast_edits_for(p_project, p_month),
    'overrides', public.forecast_overrides_for(p_month),
    'loans', loan_list,
    'categories', cat_list
  ));
end;
$$;

comment on function public.project_forecast(uuid, text, date, text) is
  'FLOW-1309. A project''s forecast for one month of the forecast (next month to 12 months ahead), in profit and cash terms, as its card, its צפי page and its edit page read it: { today, month, currency, general, income_minor, expense_minor, net_minor, cash_only_minor, cash_expense_minor, cash_net_minor, loan_count, average_months, income: { rows, recurring, rent, name }, rows, removed, skipped (rows in nextMonthForecast''s order), edited, overrides, history: { months, categories }, charges }. absent = null. The overhead project gives the general costs (general true). p_currency null is the company''s currency. A caller with no company, or a project of another company, gets null; a bad month, currency or null project is refused (22023). p_today default: today in Israel. security invoker: the caller''s company only.';

revoke all on function public.project_forecast(uuid, text, date, text) from public, anon, authenticated;
grant execute on function public.project_forecast(uuid, text, date, text) to authenticated, service_role;

commit;
