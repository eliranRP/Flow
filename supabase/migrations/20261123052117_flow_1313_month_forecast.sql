-- FLOW-1313 (plan FLOW-1275, slice 3): the month forecast in the database. Adds two functions; changes no table and
-- no existing read.
-- - private.month_forecast_build(p_input jsonb): the month-end forecast's arithmetic, packages/shared's
--   buildMonthForecast ported. Immutable, reads no table, and gives the figures the TypeScript builder gives for every
--   shared vector (packages/shared/fixtures/vectors/month-forecast, run by vectors_month_forecast.test.sql).
--   Input: { base, expected, unpaid, overrides, edits, overheadProjectId, paymentTermsDays }, the builder's argument as
--   JSON. Output: { items, income, expense, moved, small, incomeTotal, expenseTotal, changed }; the four lists hold
--   item keys, as the vectors' expected does. Amounts are JSON numbers in minor units.
-- - public.month_forecast(p_month, p_today): security invoker. Gathers the five reads the app gathers today and builds
--   them: expected_months(0, null, p_today), list_unpaid(), forecast_overrides_for(p_month),
--   company_forecast_edits_for(p_month), and the company's currency.
--
-- Only expected_months takes a date, so p_today goes to it alone; the others take the month. p_today null is
-- private.flow_today() (Asia/Jerusalem), which expected_months applies itself: authenticated cannot execute
-- private.flow_today(), and the date the build uses (expected.today) is the one expected_months answers with.
--
-- Answer: each item leaves out currency, expected_on, late_days and its null fields (absent = null).
--
-- Order: the lists are sorted by amount, then by name. The app's builder uses localeCompare(.., "he"); the database
-- sorts the name by its lowercased code points, which agrees for Latin names and puts Hebrew after Latin, but is not
-- ICU's order for every Hebrew pair. The app keeps sorting rows itself where it shows them (plan, section 2).
begin;

set local lock_timeout = '5s';

create function private.month_forecast_build(p_input jsonb)
returns jsonb
language sql
immutable
parallel safe
set search_path = ''
as $$
  with
  args as (
    select
      p_input->>'base' as base,
      p_input->'expected'->>'today' as today,
      coalesce(left(p_input->'expected'->>'today', 7), '') as this_month,
      nullif(p_input->>'paymentTermsDays', '')::integer as terms,
      p_input->>'overheadProjectId' as overhead
  ),
  -- The date the items are marked late against: only with payment terms (sample data), as in the builder.
  clock as (
    select case when terms is not null then today end as late_today from args
  ),
  edits as (
    select
      e.value as j,
      e.ordinality as n,
      e.value->>'id' as id,
      e.value->>'project_id' as project_id,
      e.value->>'kind' as kind,
      e.value->>'row_key' as row_key,
      (e.value->>'amount_minor')::bigint as amount_minor,
      e.value->>'start_month' as start_month
    from jsonb_array_elements(case when jsonb_typeof(p_input->'edits') = 'array' then p_input->'edits' else '[]'::jsonb end)
      with ordinality as e(value, ordinality)
  ),
  removed as (
    select project_id || '|' || row_key as at from edits where kind = 'remove' and row_key is not null
  ),
  -- The latest change of a row wins (the first of equal months), as on the project page.
  changes as (
    select distinct on (project_id || '|' || row_key)
      project_id || '|' || row_key as at, amount_minor
    from edits
    where kind = 'change' and amount_minor is not null and row_key is not null
    order by project_id || '|' || row_key, start_month collate "C" desc, n
  ),
  overrides as (
    -- The last row of an item key wins (a Map in the builder).
    select distinct on (o.value->>'item_key')
      o.value->>'item_key' as item_key,
      (o.value->>'amount_minor')::bigint as amount_minor,
      o.value->>'due_on' as due_on,
      coalesce((o.value->>'moved_out')::boolean, false) as moved_out
    from jsonb_array_elements(case when jsonb_typeof(p_input->'overrides') = 'array' then p_input->'overrides' else '[]'::jsonb end)
      with ordinality as o(value, ordinality)
    order by o.value->>'item_key', o.ordinality desc
  ),
  parties as (
    select
      r.value as j,
      r.ordinality as n,
      r.value->>'direction' as direction,
      r.value->>'party_id' as party_id,
      r.value->>'currency' as currency,
      -- How many charges one party has (before any is left out): more than one means it is split by project.
      count(*) over (partition by r.value->>'direction', r.value->>'party_id', r.value->>'currency') as charges
    from jsonb_array_elements(case when jsonb_typeof(p_input->'expected'->'recurring') = 'array' then p_input->'expected'->'recurring' else '[]'::jsonb end)
      with ordinality as r(value, ordinality)
  ),
  -- dueInMonth(next_due_month, pace, thisMonth, thisMonth, ...): with the month asked being this month, a charge is
  -- due when its due month is not after this month (a late one counts) and its due day is not past its end date.
  due_parties as (
    select
      p.*,
      case
        when p.j->>'next_due_month' is null then (select this_month from args)
        else left(p.j->>'next_due_month', 7)
      end as due_month,
      coalesce(p.j->>'project_id', (select overhead from args)) as owner,
      -- private.recurring_due_date: the usual day, capped at the month's last day (a missing day is the 1st).
      (select this_month from args) || '-' || lpad(
        greatest(1, least(
          coalesce((p.j->>'typical_day')::integer, 1),
          extract(day from (date_trunc('month', ((select this_month from args) || '-01')::timestamp) + interval '1 month - 1 day'))::integer
        ))::text, 2, '0') as due_day
    from parties p
  ),
  recurring_items as (
    select
      d.n,
      1 as kind_order,
      case when d.charges > 1
        then 'party:' || d.direction || ':' || d.party_id || ':' || d.currency || ':' || coalesce(d.j->>'project_id', 'none')
        else 'party:' || d.direction || ':' || d.party_id || ':' || d.currency end as key,
      d.direction as direction,
      'recurring' as kind,
      case when d.j->>'name' = '' then 'ללא שם' else d.j->>'name' end as name,
      d.currency as currency,
      coalesce(c.amount_minor, abs((d.j->>'typical_amount_minor')::bigint)) as usual,
      case when coalesce((d.j->>'typical_day')::integer, 0) > 0 then (d.j->>'typical_day')::integer end as day,
      null::text as description,
      d.j->>'category_id' as category_id,
      d.j->>'project_id' as project_id,
      null::text as project_name,
      coalesce(d.j->>'pace', 'month') as pace,
      null::text as line_start,
      case when (select late_today from clock) is not null and coalesce((d.j->>'typical_day')::integer, 0) > 0
        then (select left(late_today, 7) from clock) || '-' || lpad(
          least((d.j->>'typical_day')::integer,
            extract(day from (date_trunc('month', ((select left(late_today, 7) from clock) || '-01')::timestamp) + interval '1 month - 1 day'))::integer
          )::text, 2, '0') end as expected_on
    from due_parties d
    left join changes c on c.at = d.owner || '|rec:' || d.direction || ':' || d.party_id
    where not coalesce((d.j->>'seen_this_month')::boolean, false)
      and d.currency is not distinct from (select base from args)
      -- FLOW-1037: its payment came under another party (a likely handover); counted once, in today's cash.
      and coalesce(jsonb_typeof(d.j->'handover'), 'null') = 'null'
      and d.due_month <= (select this_month from args) collate "C"
      and (d.j->>'ends_on' is null or d.due_day <= d.j->>'ends_on' collate "C")
      and not exists (select 1 from removed r where r.at = d.owner || '|rec:' || d.direction || ':' || d.party_id)
  ),
  invoice_items as (
    select
      u.ordinality as n,
      2 as kind_order,
      'invoice:' || (u.value->>'id') as key,
      coalesce(u.value->>'direction', 'income') as direction,
      'invoice' as kind,
      case when coalesce(u.value->>'customer_name', '') <> '' then u.value->>'customer_name' else u.value->>'description' end as name,
      coalesce(u.value->>'currency', 'ILS') as currency,
      abs((u.value->>'open_gross_agorot')::bigint) as usual,
      null::integer as day,
      u.value->>'description' as description,
      u.value->>'category_id' as category_id,
      null::text as project_id,
      u.value->>'project_name' as project_name,
      null::text as pace,
      null::text as line_start,
      case when (select terms from args) is not null
        then ((u.value->>'doc_date')::date + (select terms from args))::text end as expected_on
    from jsonb_array_elements(case when jsonb_typeof(p_input->'unpaid') = 'array' then p_input->'unpaid' else '[]'::jsonb end)
      with ordinality as u(value, ordinality)
    where coalesce(u.value->>'currency', 'ILS') = (select base from args)
      and abs((u.value->>'open_gross_agorot')::bigint) <> 0
  ),
  -- FLOW-1005: the lines the owner added to a project's forecast, until the bank line that came as one is in.
  added_items as (
    select
      e.n,
      3 as kind_order,
      'added:' || e.id as key,
      e.j->>'direction' as direction,
      'added' as kind,
      case when coalesce(e.j->>'category_name', '') <> '' then e.j->>'category_name' else 'ללא שם' end as name,
      (select base from args) as currency,
      coalesce(c.amount_minor, e.amount_minor) as usual,
      null::integer as day,
      null::text as description,
      e.j->>'category_id' as category_id,
      e.project_id as project_id,
      null::text as project_name,
      coalesce(e.j->>'pace', 'once') as pace,
      e.start_month as line_start,
      null::text as expected_on
    from edits e
    left join changes c on c.at = e.project_id || '|add:' || e.id
    where e.kind = 'add'
      and e.amount_minor is not null
      and e.j->>'direction' is not null
      and e.j->>'matched_transaction_id' is null
      and not exists (select 1 from removed r where r.at = e.project_id || '|add:' || e.id)
      and coalesce(c.amount_minor, e.amount_minor) <> 0
  ),
  raw as (
    select * from recurring_items
    union all select * from invoice_items
    union all select * from added_items
  ),
  built as (
    select
      r.*,
      coalesce(o.amount_minor, r.usual) as minor,
      o.due_on as due_on,
      coalesce(o.moved_out, false) as moved_out,
      o.item_key is not null as overridden,
      case when (select late_today from clock) is not null and r.expected_on is not null
        then greatest(0, (select late_today from clock)::date - r.expected_on::date) else 0 end as late_days
    from raw r
    left join overrides o on o.item_key = r.key
  ),
  ranked as (
    select
      b.*,
      row_number() over (
        order by b.minor desc, lower(coalesce(b.name, 'null')) collate "C", coalesce(b.name, 'null') collate "C" desc, b.kind_order, b.n
      ) as rk
    from built b
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'key', x.key, 'direction', x.direction, 'kind', x.kind, 'name', x.name, 'currency', x.currency,
        'usual', x.usual, 'day', x.day, 'description', x.description, 'category_id', x.category_id,
        'project_id', x.project_id, 'project_name', x.project_name, 'pace', x.pace, 'line_start', x.line_start,
        'expected_on', x.expected_on, 'late_days', x.late_days, 'minor', x.minor, 'due_on', x.due_on,
        'moved_out', x.moved_out, 'overridden', x.overridden
      ) order by x.kind_order, x.n) from ranked x), '[]'::jsonb),
    'income', coalesce((select jsonb_agg(x.key order by x.rk) from ranked x
      where not x.moved_out and x.direction = 'income'), '[]'::jsonb),
    'expense', coalesce((select jsonb_agg(x.key order by x.rk) from ranked x
      where not x.moved_out and x.direction = 'expense' and x.minor >= 10000), '[]'::jsonb),
    'moved', coalesce((select jsonb_agg(x.key order by x.rk) from ranked x where x.moved_out), '[]'::jsonb),
    'small', coalesce((select jsonb_agg(x.key order by x.rk) from ranked x
      where not x.moved_out and x.direction = 'expense' and x.minor < 10000), '[]'::jsonb),
    'incomeTotal', coalesce((select sum(x.minor) from ranked x
      where not x.moved_out and x.direction = 'income'), 0),
    'expenseTotal', coalesce((select sum(x.minor) from ranked x
      where not x.moved_out and x.direction = 'expense'), 0),
    'changed', (select count(*) from ranked x where x.overridden)
  );
$$;

comment on function private.month_forecast_build(jsonb) is
  'FLOW-1313. buildMonthForecast (packages/shared) as a pure function of its input, for public.month_forecast. Same figures as the TypeScript builder for the shared vectors.';

revoke all on function private.month_forecast_build(jsonb) from public, anon, authenticated;
grant execute on function private.month_forecast_build(jsonb) to authenticated;

create function public.month_forecast(p_month text, p_today date default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  edits jsonb;
  expected jsonb;
  overrides jsonb;
  base text;
  built jsonb;
begin
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'validation' using errcode = '22023';
  end if;
  -- Refuses a caller with no company first (42501), as the other reads do.
  edits := public.company_forecast_edits_for(p_month);
  -- The only read that takes a date; null is today in Israel.
  expected := public.expected_months(0, null, p_today);
  overrides := public.forecast_overrides_for(p_month);
  base := private.company_base_currency(private.readable_company_id());
  built := private.month_forecast_build(jsonb_build_object(
    'base', base,
    'expected', expected,
    'unpaid', public.list_unpaid(),
    'overrides', overrides,
    'edits', edits->'edits',
    'overheadProjectId', edits->>'overhead_project_id'
  ));
  -- Smaller answer: each item leaves out currency (always base), expected_on and late_days (never set here: no
  -- payment terms) and its null fields. The build itself stays whole, as the vectors have it.
  return jsonb_build_object(
    'month', p_month,
    'base', base,
    'overrides', overrides,
    'build', jsonb_set(built, '{items}', coalesce((
      select jsonb_agg(jsonb_strip_nulls(i - 'currency' - 'expected_on' - 'late_days') order by o)
      from jsonb_array_elements(built->'items') with ordinality t(i, o)), '[]'::jsonb))
  );
end;
$$;

comment on function public.month_forecast(text, date) is
  'FLOW-1313. The month-end forecast in one read: { month, base, overrides, build } where build is private.month_forecast_build over expected_months, list_unpaid, forecast_overrides_for, company_forecast_edits_for and the company currency. p_today (default: today in Israel) goes to expected_months, the only one of them that takes a date. Items leave out currency (= base), expected_on (null) and late_days (0), and any null field: absent = null. p_month (overrides and edits) and p_today''s month (which charges are due or seen) may differ; the answer then mixes the two as the app''s five reads did, and nothing refuses it.';

revoke all on function public.month_forecast(text, date) from public, anon, authenticated;
grant execute on function public.month_forecast(text, date) to authenticated, service_role;

commit;
