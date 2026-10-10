-- The project page's "לכל החודשים" (owner, 2026-10-10: the project page like Home). FLOW-417's
-- history for one project, on FLOW-419's project cash rules (decision 0176):
-- - project_cash_years(p_project): cash_years' shape for one project. The net, in and out since
--   the project's first cash month, and per year, newest first, through the end of this month.
--   A shared line counts the project's share.
-- - project_cash_year_months(p_project, p_year): that year's months in project_cash_months' shape.
--   It is project_cash_months anchored on the year's last month, so the two reads always agree.

begin;

set local lock_timeout = '5s';

create or replace function public.project_cash_years(p_project uuid, p_today date default null)
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
  last_day date;
  basis text;
  base text;
  ids uuid[];
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if p_project is null then
    raise exception 'validation';
  end if;
  if not exists (select 1 from public.projects pr where pr.id = p_project and pr.company_id = cid) then
    return null;
  end if;
  select c.cash_basis, c.base_currency into basis, base
  from public.companies c
  where c.id = cid;

  this_month := date_trunc('month', today)::date;
  last_day := (this_month + interval '1 month' - interval '1 day')::date;
  ids := private.project_line_ids(cid, p_project);

  with parts as materialized (
    select
      p.month_date,
      p.currency,
      case when p.kind = 'income' then p.amount_minor else 0 end as in_minor,
      case when p.kind = 'expense' then -p.amount_minor else 0 end as out_minor
    from private.project_cash_parts(cid, p_project, ids, basis, date '1900-01-01', last_day) p
    where p.in_cash
  ),
  yearly as (
    select
      extract(year from x.month_date)::integer as year,
      x.currency,
      sum(x.in_minor)::bigint as in_minor,
      sum(x.out_minor)::bigint as out_minor
    from parts x
    group by 1, 2
  ),
  bounds as (
    select date_trunc('month', min(x.month_date))::date as first_month from parts x
  ),
  years as (
    select y::integer as year
    from bounds b,
      generate_series(
        extract(year from this_month)::integer,
        extract(year from coalesce(b.first_month, this_month))::integer,
        -1
      ) y
  ),
  keys as (
    select y.year, base as currency from years y
    union
    select v.year, v.currency from yearly v
  ),
  total_keys as (
    select base as currency
    union
    select distinct v.currency from yearly v
  )
  select jsonb_build_object(
    'basis', basis,
    'base_currency', base,
    'this_month', to_char(this_month, 'YYYY-MM-DD'),
    'first_month', (select to_char(b.first_month, 'YYYY-MM-DD') from bounds b),
    'by_currency', (
      select jsonb_agg(jsonb_build_object(
        'currency', t.currency,
        'in_minor', coalesce(s.in_minor, 0),
        'out_minor', coalesce(s.out_minor, 0),
        'net_minor', coalesce(s.in_minor, 0) - coalesce(s.out_minor, 0)
      ) order by t.currency is distinct from base, t.currency)
      from total_keys t
      left join (
        select v.currency, sum(v.in_minor)::bigint as in_minor, sum(v.out_minor)::bigint as out_minor
        from yearly v
        group by 1
      ) s on s.currency = t.currency
    ),
    'years', (
      select jsonb_agg(jsonb_build_object(
        'year', y.year,
        'by_currency', (
          select jsonb_agg(jsonb_build_object(
            'currency', k.currency,
            'in_minor', coalesce(v.in_minor, 0),
            'out_minor', coalesce(v.out_minor, 0),
            'net_minor', coalesce(v.in_minor, 0) - coalesce(v.out_minor, 0)
          ) order by k.currency is distinct from base, k.currency)
          from keys k
          left join yearly v on v.year = k.year and v.currency = k.currency
          where k.year = y.year
        )
      ) order by y.year desc)
      from years y
    )
  ) into result;

  return result;
end;
$$;

-- One year's months for the project in project_cash_months' shape. A past year has its 12
-- months; the current year runs from January to this month. A year after this one is refused.
create or replace function public.project_cash_year_months(p_project uuid, p_year integer, p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := coalesce(p_today, private.flow_today());
  this_year integer := extract(year from today)::integer;
begin
  if private.readable_company_id() is null then
    return null;
  end if;
  if p_year is null or p_year < 1900 or p_year > this_year then
    raise exception 'validation';
  end if;
  if p_year = this_year then
    return public.project_cash_months(p_project, extract(month from today)::integer, today);
  end if;
  return public.project_cash_months(p_project, 12, make_date(p_year, 12, 31));
end;
$$;

revoke all on function public.project_cash_years(uuid, date) from public, anon;
revoke all on function public.project_cash_year_months(uuid, integer, date) from public, anon;
grant execute on function public.project_cash_years(uuid, date) to authenticated, service_role;
grant execute on function public.project_cash_year_months(uuid, integer, date) to authenticated, service_role;

comment on function public.project_cash_years(uuid, date) is
  'The project page''s history: one project''s cash since its first cash month and per year (cash_years'' shape); a shared line counts the project''s share.';
comment on function public.project_cash_year_months(uuid, integer, date) is
  'The project page''s history: one project''s months of a year (project_cash_months'' shape), the current year to this month.';

commit;
