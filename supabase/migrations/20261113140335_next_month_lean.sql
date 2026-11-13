-- FLOW-1171 (perf queue, Company profit): company_next_month_inputs answered 177 KB in about 370 ms, and most of it
-- was never read.
--
-- - Each category row carried 11 fields; the app (and flow-mcp's spec) read four: id, name, currency and
--   months_minor. The other seven (group_name, parent_id, this_month_minor, months_seen, expected_minor,
--   typical_day, flag) cost half the projects' bytes and a flag, a median and a day percentile per row. A new
--   private.project_category_months_lean gives the four, in the same rows and order, and reads every project's
--   lines in one pass (the company's lines for the window, filtered by project) instead of one call per project.
--   private.project_category_months_many and public.project_category_months (the project page) are unchanged:
--   the page still reads every field.
-- - rest_edits (every edit that applies to a month of the forecast, 59 KB) is read by the year view, the
--   since-start view and a month after next month; next month's card needs `edits` only. p_rest (default true,
--   the answer as before) false leaves rest_edits out.
--
-- The new signature replaces company_next_month_inputs(date): drop the old one, create the new, grant again.

begin;

set local lock_timeout = '5s';

-- Each project's categories as the app reads them: id, name, currency, months_minor (the months before this
-- one, oldest first). The rows are project_category_months_many's, in its order, with its lines
-- (project_category_entries_by_currency's two branches) read for all the projects at once.
create or replace function private.project_category_months_lean(p_projects uuid[], p_months integer, p_today date)
returns table(project_id uuid, categories jsonb)
language sql
stable
set search_path to ''
as $$
  with bounds as (
    select date_trunc('month', p_today)::date as this_month,
      (date_trunc('month', p_today)::date - make_interval(months => p_months))::date as first_month,
      (date_trunc('month', p_today)::date + interval '1 month')::date as end_month,
      private.company_base_currency((select private.readable_company_id())) as base_currency,
      (select private.readable_company_id()) as cid
  ),
  -- A project's own lines: the line's project, and the transaction is the project's or has a part of it. The
  -- ids of the projects' transactions come first as an array, so the lines are found by index, not by a scan.
  own as (
    select l.project_id, l.category_id, l.currency, l.doc_date, l.amount_net, l.transaction_id
    from bounds b
    cross join private.pnl_lines l
    where l.transaction_id = any(array(
        select t2.id from public.transactions t2 where t2.project_id = any(p_projects)
        union
        select s2.transaction_id from private.split_parts s2 where s2.project_id = any(p_projects)
      ))
      and l.project_id = any(p_projects)
      and l.company_id = b.cid
      and l.kind = 'expense'
      and l.pnl_role = 'project'
      and l.doc_date >= b.first_month
      and l.doc_date < b.end_month
      and (
        exists (select 1 from public.transactions t2 where t2.id = l.transaction_id and t2.project_id = l.project_id)
        or exists (select 1 from private.split_parts s2 where s2.transaction_id = l.transaction_id and s2.project_id = l.project_id)
      )
      and exists (
        select 1
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
      )
  ),
  -- A shared line's share of each project it is allocated to.
  shared as (
    select a.project_id, l.category_id, l.currency, l.doc_date,
      case
        when l.part is null and l.amount_net = l.line_amount_net then a.amount_net
        else coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
      end as amount_net,
      l.transaction_id
    from bounds b
    cross join public.allocations a
    join private.pnl_lines l on l.transaction_id = a.transaction_id
    where a.project_id = any(p_projects)
      and l.transaction_id = any(array(select a2.transaction_id from public.allocations a2 where a2.project_id = any(p_projects)))
      and l.company_id = b.cid
      and l.kind = 'expense'
      and l.pnl_role = 'shared'
      and l.category_id is not null
      and l.doc_date >= b.first_month
      and l.doc_date < b.end_month
      and exists (select 1 from public.transactions t where t.id = l.transaction_id and not t.category_suggested)
  ),
  entries as (
    select e.project_id, e.category_id, e.currency, date_trunc('month', e.doc_date)::date as month, -e.amount_net as amount
    from (select * from own union all select * from shared) e
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
    select k.project_id, k.category_id, k.currency, k.this_month_minor, m::date as month, coalesce(s.amount, 0)::bigint as amount
    from keys k
    cross join bounds b
    cross join generate_series(b.first_month, b.this_month - interval '1 month', interval '1 month') m
    left join sums s on s.project_id = k.project_id and s.category_id is not distinct from k.category_id
      and s.currency = k.currency and s.month = m::date
  ),
  rows as (
    select pm.project_id, pm.category_id, pm.currency, pm.this_month_minor,
      jsonb_agg(pm.amount order by pm.month) as months_minor
    from per_month pm
    group by pm.project_id, pm.category_id, pm.currency, pm.this_month_minor
  )
  select r.project_id, jsonb_agg(jsonb_build_object(
      'id', r.category_id,
      'name', c.name,
      'currency', r.currency,
      'months_minor', r.months_minor
    ) order by r.currency is distinct from b.base_currency, r.currency, r.this_month_minor desc, c.name)
  from rows r
  cross join bounds b
  left join public.categories c on c.id = r.category_id
  group by r.project_id;
$$;

revoke all on function private.project_category_months_lean(uuid[], integer, date) from public, anon;
grant execute on function private.project_category_months_lean(uuid[], integer, date) to authenticated, service_role;

drop function public.company_next_month_inputs(date);

create or replace function public.company_next_month_inputs(p_today date default null::date, p_rest boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
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
  -- FLOW-1066: the forecast's months, next month to 12 months after this one (forecast-horizon.ts).
  rest_months := array(
    select to_char(m, 'YYYY-MM')
    from generate_series(this_month + interval '1 month', this_month + interval '12 months', interval '1 month') m
  );
  select c.overhead_project_id into overhead from public.companies c where c.id = cid;

  -- Every active project's category months in one pass (FLOW-977), as the four fields the forecast reads
  -- (FLOW-1171).
  select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', p.id,
      'categories', coalesce(m.categories, '[]'::jsonb)
    ) order by p.id), '[]'::jsonb)
  into projects
  from public.projects p
  left join private.project_category_months_lean(array(
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
        case when not exists (select 1 from private.loan_parts ls where ls.transaction_id = lt.id)
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

  -- The later months' edits: every edit (of the same projects) that applies to any month of the forecast,
  -- with each added edit's matched line by month, so each month's forecast applies its own. Only when asked
  -- (p_rest): next month's card builds from `edits`.
  if p_rest then
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
  end if;

  return jsonb_build_object(
    'today', today,
    'month', next_month,
    'overhead_project_id', overhead,
    'projects', projects,
    'general', general,
    'edits', edits
  ) || case when p_rest then jsonb_build_object('rest_edits', rest_edits) else '{}'::jsonb end;
end;
$function$;

revoke all on function public.company_next_month_inputs(date, boolean) from public, anon, authenticated;
grant execute on function public.company_next_month_inputs(date, boolean) to authenticated, service_role;

commit;
