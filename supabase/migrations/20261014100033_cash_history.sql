-- FLOW-417 (decision 0174): the cash view's whole history, years then months. The owner picked
-- "Years, then months" (2026-10-10).
-- - cash_years(): the net, in and out since the company's first cash month, and per year, newest
--   first, on the company's cash basis, through the end of the current month. Totals only, so the
--   history page reads one small row set however many years the books hold.
-- - cash_year_months(year): that year's months in cash_months' shape (newest first, through the
--   current month for this year). It is cash_months anchored on the year's last month, so the
--   two reads always agree.

begin;

set local lock_timeout = '5s';

create or replace function public.cash_years(p_today date default null)
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
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  select c.cash_basis, c.base_currency into basis, base
  from public.companies c
  where c.id = cid;

  this_month := date_trunc('month', today)::date;
  last_day := (this_month + interval '1 month' - interval '1 day')::date;

  with parts as materialized (
    select
      p.month_date,
      p.currency,
      case when p.kind = 'income' then p.amount_minor else 0 end as in_minor,
      case when p.kind = 'expense' then -p.amount_minor else 0 end as out_minor
    from private.cash_parts(cid, basis, date '1900-01-01', last_day) p
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

-- One year's months in cash_months' shape. A past year has its 12 months; the current year runs
-- from January to this month. A year after this one is refused.
create or replace function public.cash_year_months(p_year integer, p_today date default null)
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
    return public.cash_months(extract(month from today)::integer, today);
  end if;
  return public.cash_months(12, make_date(p_year, 12, 31));
end;
$$;

revoke all on function public.cash_years(date) from public, anon;
revoke all on function public.cash_year_months(integer, date) from public, anon;
grant execute on function public.cash_years(date) to authenticated, service_role;
grant execute on function public.cash_year_months(integer, date) to authenticated, service_role;

commit;
