-- FLOW-977: company_next_month_inputs, the slowest read on the company profit page, reads every active
-- project's category months in one pass. It called public.project_category_months once per active
-- project, and each call paid its own plpgsql start, company checks and aggregation (on the largest
-- company's sandbox, 14 projects, about 195 of its 440 ms in production).
-- - private.project_category_months_many: project_category_months' categories for many projects at
--   once, grouped by project. Each project's lines still come from
--   private.project_category_entries_by_currency, unchanged (the project page reads it too).
-- - public.project_category_months reads its categories from it, so the rule lives in one place. Its
--   checks, envelope and parents are unchanged.
-- - company_next_month_inputs takes every project's categories from one call. The rest of its body is
--   the latest live one (20261020170625_company_rest_of_year_edits.sql).
-- supabase/tests/database/project_months_one_pass.test.sql pins both reads' outputs on invented books.
begin;
set local lock_timeout = '5s';

-- The categories of public.project_category_months for each project in p_projects that has any, with
-- the same fields, rules and order. A project with no lines in the window has no row. The caller checks
-- that the projects are the reading company's: the lines come from
-- private.project_category_entries_by_currency, which reads only that company's.
create function private.project_category_months_many(p_projects uuid[], p_months integer, p_today date)
returns table(project_id uuid, categories jsonb)
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select date_trunc('month', p_today)::date as this_month,
      (date_trunc('month', p_today)::date - make_interval(months => p_months))::date as first_month,
      private.company_base_currency((select private.readable_company_id())) as base_currency
  ),
  entries as (
    select pr.id as project_id, e.category_id, e.currency, date_trunc('month', e.doc_date)::date as month,
      extract(day from e.doc_date)::integer as day, -e.amount_net as amount
    from bounds b
    cross join unnest(p_projects) pr(id)
    cross join lateral private.project_category_entries_by_currency(pr.id) e
    left join public.categories cat on cat.id = e.category_id
    join public.transactions lt on lt.id = e.transaction_id
    where e.doc_date >= b.first_month
      and e.doc_date < (b.this_month + interval '1 month')::date
      and private.line_in_pnl(
        case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
          then lt.in_pnl_override end,
        cat.excluded_from_pnl, cat.loan_part
      )
  ),
  sums as (
    select e.project_id, e.category_id, e.currency, e.month, sum(e.amount)::bigint as amount
    from entries e
    group by e.project_id, e.category_id, e.currency, e.month
  ),
  keys as (
    select s.project_id, s.category_id, s.currency,
      coalesce(sum(s.amount) filter (where s.month = b.this_month), 0)::bigint as this_month_minor
    from sums s, bounds b
    group by s.project_id, s.category_id, s.currency
  ),
  per_month as (
    select k.project_id, k.category_id, k.currency, m::date as month, coalesce(s.amount, 0)::bigint as amount
    from keys k
    cross join bounds b
    cross join generate_series(b.first_month, b.this_month - interval '1 month', interval '1 month') m
    left join sums s on s.project_id = k.project_id and s.category_id is not distinct from k.category_id
      and s.currency = k.currency and s.month = m::date
  ),
  -- A month counts as seen only with a positive cost, so a refund-only month is not a cost.
  past as (
    select pm.project_id, pm.category_id, pm.currency,
      jsonb_agg(pm.amount order by pm.month) as months_minor,
      (count(*) filter (where pm.amount > 0))::integer as months_seen,
      round(percentile_cont(0.5) within group (order by pm.amount) filter (where pm.amount > 0))::bigint as median_minor
    from per_month pm
    group by pm.project_id, pm.category_id, pm.currency
  ),
  days as (
    select e.project_id, e.category_id, e.currency,
      round(percentile_cont(0.5) within group (order by e.day))::integer as typical_day
    from entries e, bounds b
    where e.month < b.this_month
    group by e.project_id, e.category_id, e.currency
  ),
  rows as (
    select k.project_id, k.category_id, k.currency, k.this_month_minor, p.months_minor, p.months_seen,
      p.median_minor, d.typical_day
    from keys k
    join past p on p.project_id = k.project_id and p.category_id is not distinct from k.category_id
      and p.currency = k.currency
    left join days d on d.project_id = k.project_id and d.category_id is not distinct from k.category_id
      and d.currency = k.currency
  )
  select r.project_id, jsonb_agg(jsonb_build_object(
      'id', r.category_id,
      'name', c.name,
      'group_name', c.group_name,
      'parent_id', c.parent_id,
      'currency', r.currency,
      'this_month_minor', r.this_month_minor,
      'months_minor', r.months_minor,
      'months_seen', r.months_seen,
      'expected_minor', case when r.months_seen >= 3 then r.median_minor end,
      'typical_day', r.typical_day,
      'flag', private.category_flag(
        r.currency, r.this_month_minor,
        case when r.months_seen >= 3 then r.median_minor end,
        r.months_seen, r.typical_day, p_today
      )
    ) order by r.currency is distinct from b.base_currency, r.currency, r.this_month_minor desc, c.name)
  from rows r
  cross join bounds b
  left join public.categories c on c.id = r.category_id
  group by r.project_id;
$$;

revoke all on function private.project_category_months_many(uuid[], integer, date) from public, anon;
grant execute on function private.project_category_months_many(uuid[], integer, date) to authenticated, service_role;

create or replace function public.project_category_months(
  p_project_id uuid,
  p_months integer default 6,
  p_today date default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  cid uuid;
  -- private.flow_today(), inline: the caller runs this function and cannot call that one.
  today date := coalesce(p_today, (now() at time zone 'Asia/Jerusalem')::date);
  this_month date;
  first_month date;
  months jsonb;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if p_project_id is null or p_months is null or p_months < 3 or p_months > 12 then
    raise exception 'validation';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.company_id = cid) then
    return null;
  end if;

  this_month := date_trunc('month', today)::date;
  first_month := (this_month - make_interval(months => p_months))::date;
  select jsonb_agg(to_char(m, 'YYYY-MM-DD') order by m) into months
  from generate_series(first_month, this_month - interval '1 month', interval '1 month') m;

  result := jsonb_build_object(
    'project_id', p_project_id,
    'today', today,
    'this_month', to_char(this_month, 'YYYY-MM-DD'),
    'months', coalesce(months, '[]'::jsonb),
    'categories', coalesce((
      select m.categories
      from private.project_category_months_many(array[p_project_id], p_months, today) m
    ), '[]'::jsonb)
  );

  -- FLOW-406: the parents, months summed, for folding sub-categories.
  result := result || jsonb_build_object('parents', private.category_month_parents(result->'categories', cid));
  return result;
end;
$$;

create or replace function public.company_next_month_inputs(p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  this_month date;
  first_month date;
  next_month text;
  overhead uuid;
  projects jsonb;
  general jsonb;
  edits jsonb;
  rest_edits jsonb;
  rest_months text[];
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  this_month := date_trunc('month', today)::date;
  first_month := (this_month - interval '6 months')::date;
  next_month := to_char(this_month + interval '1 month', 'YYYY-MM');
  -- The months left in this year after this one: none in December.
  rest_months := array(
    select to_char(m, 'YYYY-MM')
    from generate_series(this_month + interval '1 month', date_trunc('year', today) + interval '11 months', interval '1 month') m
  );
  select c.overhead_project_id into overhead from public.companies c where c.id = cid;

  -- Every active project's category months in one pass (FLOW-977), not one project_category_months
  -- call per project.
  select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', p.id,
      'categories', coalesce(m.categories, '[]'::jsonb)
    ) order by p.id), '[]'::jsonb)
  into projects
  from public.projects p
  left join private.project_category_months_many(array(
    select ap.id from public.projects ap
    where ap.company_id = cid and ap.status = 'active' and ap.id is distinct from overhead
  ), 6, today) m on m.project_id = p.id
  where p.company_id = cid
    and p.status = 'active'
    and p.id is distinct from overhead;

  with streams as (
    -- The lines of each recurring charge of an active project but the overhead one: that project counts them.
    select sl.id
    from private.recurring_stream_lines(cid, today) sl
    join private.recurring_parties(cid, today) rp
      on rp.direction = sl.direction and rp.party_id = sl.party_id and rp.currency = sl.currency
      and rp.project_id = sl.stream_project
    join public.projects sp on sp.id = sl.stream_project and sp.status = 'active'
    where sl.stream_project is not null
      and sl.stream_project is distinct from overhead
  ),
  entries as (
    select l.category_id, l.currency, date_trunc('month', l.doc_date)::date as month, -l.amount_net as amount
    from private.pnl_lines l
    join public.transactions lt on lt.id = l.transaction_id
    left join public.categories cat on cat.id = l.category_id
    where l.company_id = cid
      and l.kind = 'expense'
      and (l.unassigned or l.pnl_role = 'overhead')
      and not lt.category_suggested
      and not exists (
        select 1 from public.review_queue q
        where q.transaction_id = lt.id and q.company_id = lt.company_id and q.status = 'open'
      )
      and l.doc_date >= first_month
      and l.doc_date < this_month
      and not exists (select 1 from streams st where st.id = lt.id)
      and private.line_in_pnl(
        case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
          then lt.in_pnl_override end,
        cat.excluded_from_pnl, cat.loan_part
      )
  ),
  sums as (
    select e.category_id, e.currency, e.month, sum(e.amount)::bigint as amount
    from entries e
    group by e.category_id, e.currency, e.month
  ),
  keys as (
    select distinct s.category_id, s.currency from sums s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', k.category_id,
      'name', c.name,
      'currency', k.currency,
      'months_minor', (
        select jsonb_agg(coalesce(s.amount, 0) order by m)
        from generate_series(first_month, this_month - interval '1 month', interval '1 month') m
        left join sums s on s.category_id is not distinct from k.category_id
          and s.currency = k.currency and s.month = m::date
      )
    ) order by k.currency, c.name), '[]'::jsonb)
  into general
  from keys k
  left join public.categories c on c.id = k.category_id;

  select coalesce(jsonb_agg(
      private.pfe_json(e.*)
        || jsonb_build_object('project_id', e.project_id, 'category_name', c.name)
        || case when e.kind = 'add' then jsonb_build_object('matched_transaction_id', m.transaction_id) else '{}'::jsonb end
      order by e.created_at, e.id), '[]'::jsonb)
  into edits
  from public.project_forecast_edits e
  left join public.categories c on c.id = e.category_id
  left join public.forecast_line_matches m on m.edit_id = e.id and m.month = next_month and m.company_id = e.company_id
  join public.projects p on p.id = e.project_id
  where e.company_id = cid
    and (p.status = 'active' or p.id = overhead)
    and private.pfe_hits(e.start_month, e.pace, next_month);

  -- The rest of the year's edits: every edit (of the same projects) that applies to any month left in the
  -- year, with each added edit's matched line by month, so the year's forecast applies each month's own.
  select coalesce(jsonb_agg(
      private.pfe_json(e.*)
        || jsonb_build_object('project_id', e.project_id, 'category_name', c.name)
        || case when e.kind = 'add' then jsonb_build_object('matches', coalesce((
          select jsonb_object_agg(m.month, m.transaction_id order by m.month)
          from public.forecast_line_matches m
          where m.edit_id = e.id and m.company_id = e.company_id and m.month = any(rest_months)
        ), '{}'::jsonb)) else '{}'::jsonb end
      order by e.created_at, e.id), '[]'::jsonb)
  into rest_edits
  from public.project_forecast_edits e
  left join public.categories c on c.id = e.category_id
  join public.projects p on p.id = e.project_id
  where e.company_id = cid
    and (p.status = 'active' or p.id = overhead)
    and exists (select 1 from unnest(rest_months) rm where private.pfe_hits(e.start_month, e.pace, rm));

  return jsonb_build_object(
    'today', today,
    'month', next_month,
    'overhead_project_id', overhead,
    'projects', projects,
    'general', general,
    'edits', edits,
    'rest_edits', rest_edits
  );
end;
$$;

commit;
