-- FLOW-1171 (perf queue, Company profit): company_next_month_inputs read every active project's lines for all
-- time and kept the last months only afterwards, one project at a time. The project's lines now come with the
-- window applied inside the read, so each project reads only the months it reports. Same rows, same answers.

-- One body: a project's counted expense lines between two dates (from inclusive, to exclusive).
create or replace function private.project_category_entries_by_currency(p_project uuid, p_from date, p_to date)
returns table(category_id uuid, transaction_id uuid, description text, doc_date date, amount_net bigint, created_at timestamp with time zone, shared boolean, currency text)
language sql
stable
set search_path to ''
as $$
  -- Each branch reads the project's lines first and looks up each line's own rows by index
  -- (lateral, offset 0 so the planner can't flatten it), whatever row counts it guesses.
  select l.category_id, l.transaction_id, t.description, l.doc_date, l.amount_net, t.created_at, false, l.currency
  from private.pnl_lines l
  cross join lateral (
    select t.description, t.created_at
    from public.transactions t
    where t.id = l.transaction_id
      and not t.category_suggested
      and not exists (
        select 1
        from public.review_queue q
        where q.transaction_id = t.id
          and q.company_id = t.company_id
          and q.status = 'open'
      )
    offset 0
  ) t
  where l.project_id = p_project
    and l.transaction_id = any(array(
      select t2.id from public.transactions t2 where t2.project_id = p_project
      union
      select s2.transaction_id from private.split_parts s2 where s2.project_id = p_project
    ))
    and l.company_id = (select private.readable_company_id())
    and l.kind = 'expense'
    and l.pnl_role = 'project'
    and l.doc_date >= p_from
    and l.doc_date < p_to
  union all
  select l.category_id, l.transaction_id, t.description, l.doc_date,
    case
      when l.part is null and l.amount_net = l.line_amount_net then a.amount_net
      else coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
    end,
    t.created_at, true, l.currency
  from private.pnl_lines l
  cross join lateral (
    select a.amount_net from public.allocations a
    where a.transaction_id = l.transaction_id and a.project_id = p_project
    offset 0
  ) a
  cross join lateral (
    select t.description, t.created_at
    from public.transactions t
    where t.id = l.transaction_id
      and not t.category_suggested
    offset 0
  ) t
  where l.transaction_id = any(array(
      select a2.transaction_id from public.allocations a2 where a2.project_id = p_project
    ))
    and l.company_id = (select private.readable_company_id())
    and l.kind = 'expense'
    and l.pnl_role = 'shared'
    and l.category_id is not null
    and l.doc_date >= p_from
    and l.doc_date < p_to;
$$;

revoke all on function private.project_category_entries_by_currency(uuid, date, date) from public, anon;
grant execute on function private.project_category_entries_by_currency(uuid, date, date) to authenticated, service_role;

-- Every line of the project, as before: the same body with no window.
create or replace function private.project_category_entries_by_currency(p_project uuid)
returns table(category_id uuid, transaction_id uuid, description text, doc_date date, amount_net bigint, created_at timestamp with time zone, shared boolean, currency text)
language sql
stable
set search_path to ''
as $$
  select * from private.project_category_entries_by_currency(p_project, '-infinity'::date, 'infinity'::date);
$$;

-- The projects' category months: each project's lines read for the window only (the months before this one
-- and this one), the rest as before.
create or replace function private.project_category_months_many(p_projects uuid[], p_months integer, p_today date)
returns table(project_id uuid, categories jsonb)
language sql
stable
set search_path to ''
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
    cross join lateral private.project_category_entries_by_currency(
      pr.id, b.first_month, (b.this_month + interval '1 month')::date
    ) e
    left join public.categories cat on cat.id = e.category_id
    join public.transactions lt on lt.id = e.transaction_id
    where private.line_in_pnl(
        case when not exists (select 1 from private.loan_parts ls where ls.transaction_id = lt.id)
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
