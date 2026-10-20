-- The company's next-month forecast inputs (FLOW-143, decision 0196 point 5): one read with what the
-- app's forecast builder needs beyond expected_months and the loans, for every project at once, so the
-- company profit page sums each project's forecast and the general costs without a read per project.
-- 1. projects: each of the company's projects with its category months, as project_category_months
--    gives them for the project's own page (the same call, so the averages agree with each צפי page).
-- 2. general: the same months for the expense lines no project's months hold: lines with no project
--    (unassigned, as the breakdown counts them) and overhead lines. Lines shared by allocation are in
--    their projects' months already. The filters are project_category_months': not a suggested
--    category, not in the open review queue, counted in profit, by document date, the six complete
--    months before this one.
-- 3. edits: every project's forecast edits that apply to next month, as project_forecast_edits_for
--    lists them for one project, with the project's id.
-- Security definer: the caller's readable company only; another company's caller gets its own.
begin;
set local lock_timeout = '5s';

create function public.company_next_month_inputs(p_today date default null)
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
  projects jsonb;
  general jsonb;
  edits jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  this_month := date_trunc('month', today)::date;
  first_month := (this_month - interval '6 months')::date;
  next_month := to_char(this_month + interval '1 month', 'YYYY-MM');

  select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', p.id,
      'categories', coalesce(public.project_category_months(p.id, 6, today)->'categories', '[]'::jsonb)
    ) order by p.id), '[]'::jsonb)
  into projects
  from public.projects p
  where p.company_id = cid;

  with entries as (
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
  where e.company_id = cid
    and private.pfe_hits(e.start_month, e.pace, next_month);

  return jsonb_build_object(
    'today', today,
    'month', next_month,
    'projects', projects,
    'general', general,
    'edits', edits
  );
end;
$$;

revoke all on function public.company_next_month_inputs(date) from public, anon, authenticated;
grant execute on function public.company_next_month_inputs(date) to authenticated;

commit;
