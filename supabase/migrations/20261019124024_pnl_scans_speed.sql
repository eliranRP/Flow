-- Fewer passes over private.pnl_lines, with the same results. One pass over a company's lines
-- costs about 30 ms, and these reads made many:
-- - get_profit_months(p_project_id) asked private.overhead_share_for for every month, once in
--   shekels and once in the base currency: 40 company passes for 20 months. A new
--   private.overhead_shares reads the company's income and overhead lines once and returns the
--   share for every month and currency, with overhead_share_for's formula, rounding and
--   remainder rule. get_project reads both currencies' share from it in one pass too.
-- - company_pnl read the company's lines six times (income, expense, all currencies, counts,
--   other currencies). It reads them once into a materialized CTE and builds everything from it.
--   get_dashboard and get_project_group follow.
-- - projects_cash_month called company_pnl twice (the month and all time) for three numbers per
--   project, and read each project's lines again for its first month. It reads the company's
--   lines once and builds the month and all-time project totals as company_pnl's by_currency
--   counts them (on the basis company_pnl is passed: the company's cash_basis), and every
--   project's first month in one grouped query.
-- - get_project reads its lines once, unfiltered, and takes both the totals' lines and the
--   transactions' kept_out from that read instead of one pnl_lines lookup per transaction.
-- - get_home read the company's lines three times; it groups them by currency once.
-- Bodies are otherwise the latest live ones: get_profit_months as patched by
-- 20261011120000 and 20261014064928, company_pnl from 20261018085732, projects_cash_month from
-- 20261014184227, get_project from 20261018085732 and get_home from 20261008100000.
begin;
set local lock_timeout = '5s';

-- private.overhead_share_for for several currencies and, with p_by_month, for every calendar
-- month of the range at once: one row per (month, currency) that has lines. month is null
-- without p_by_month. A (month, currency) with no row has no weighted share (available false),
-- as overhead_share_for answers for it.
create or replace function private.overhead_shares(
  p_company uuid,
  p_project uuid,
  p_basis text,
  p_from date,
  p_to date,
  p_currencies text[],
  p_by_month boolean
)
returns table(month date, currency text, available boolean, share_agorot bigint)
language sql
stable
set search_path = ''
as $$
  with cid as (
    select
      p_company as id,
      (select c.overhead_project_id from public.companies c where c.id = p_company) as overhead_project,
      case when p_basis = 'invoiced' then 'invoiced' else 'cash' end as basis
  ),
  -- One pass over the company's income and overhead lines, as overhead_share_for reads them.
  lines as (
    select
      case when p_by_month then date_trunc('month',
        case when l.kind = 'income' and (select basis from cid) = 'cash' then coalesce(l.cash_date, l.doc_date) else l.doc_date end
      )::date end as month,
      l.currency,
      l.project_id,
      l.kind,
      l.pnl_role,
      l.amount_net,
      l.kind = 'income'
        and (
          l.direction = 'expense'
          or ((select basis from cid) = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
          or ((select basis from cid) = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
        )
        and l.project_id is not null
        and l.project_id is distinct from (select overhead_project from cid) as is_income
    from private.pnl_lines l
    where l.company_id = (select id from cid)
      and l.currency = any(p_currencies)
      and l.in_pnl
      and (l.kind = 'income' or l.pnl_role = 'overhead')
      and ((select basis from cid) = 'invoiced' or not l.unpaid)
      and private.pnl_in_range(l.kind, (select basis from cid), l.doc_date, l.cash_date, p_from, p_to)
  ),
  totals as (
    select
      l.month,
      l.currency,
      coalesce(sum(l.amount_net) filter (where l.is_income), 0)::bigint as total_income,
      coalesce(-(sum(l.amount_net) filter (where l.kind = 'expense' and l.pnl_role = 'overhead'))::bigint, 0) as overhead_cost
    from lines l
    group by l.month, l.currency
  ),
  project_income as (
    select l.month, l.currency, l.project_id, sum(l.amount_net)::bigint as income
    from lines l
    where l.is_income
    group by l.month, l.currency, l.project_id
    having sum(l.amount_net) > 0
  ),
  -- Only the months and currencies where the project has a weighted share need the rounding;
  -- elsewhere its share is 0.
  rounded as (
    select
      s.month,
      s.currency,
      p.id as project_id,
      p.name as project_name,
      s.income,
      t.overhead_cost,
      t.overhead_cost::numeric * s.income / t.total_income as exact,
      private.round_agorot_shekel_hundreds(t.overhead_cost::numeric * s.income / t.total_income) as rounded
    from project_income s
    join totals t on t.month is not distinct from s.month and t.currency = s.currency
    join public.projects p on p.id = s.project_id
    where p.company_id = (select id from cid)
      and t.total_income <> 0
      and exists (
        select 1 from project_income x
        where x.month is not distinct from s.month and x.currency = s.currency and x.project_id = p_project
      )
  ),
  spread as (
    select
      r.*,
      max(r.exact - r.rounded) over (partition by r.month, r.currency) as max_gap,
      coalesce(sum(r.rounded) over (partition by r.month, r.currency), 0) as rounded_sum
    from rounded r
  ),
  -- The remainder goes to one project, picked as overhead_share_for picks it.
  ranked as (
    select
      s.*,
      row_number() over (
        partition by s.month, s.currency
        order by
          case when s.max_gap > 0 then (s.exact - s.rounded) end desc nulls last,
          case when s.max_gap <= 0 then s.income end desc nulls last,
          s.project_name asc
      ) as pick
    from spread s
  )
  select
    t.month,
    t.currency,
    (select id from cid) is not null and t.total_income <> 0,
    case
      when (select id from cid) is null or t.total_income = 0 then null::bigint
      else coalesce((
        select (k.rounded + case when k.pick = 1 then k.overhead_cost - k.rounded_sum else 0 end)::bigint
        from ranked k
        where k.month is not distinct from t.month and k.currency = t.currency and k.project_id = p_project
      ), 0)
    end
  from totals t;
$$;

revoke all on function private.overhead_shares(uuid, uuid, text, date, date, text[], boolean) from public, anon;
grant execute on function private.overhead_shares(uuid, uuid, text, date, date, text[], boolean) to authenticated, service_role;

-- Profit per calendar month. The project's overhead share of every month, in shekels and in the
-- base currency, comes from one private.overhead_shares pass instead of two
-- overhead_share_for passes per month.
CREATE OR REPLACE FUNCTION public.get_profit_months(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_basis text DEFAULT NULL::text, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  basis text;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if (p_from is null) <> (p_to is null) or p_from > p_to then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  if p_from is not null and p_to >= (date_trunc('month', p_from) + interval '240 months')::date then
    raise exception 'range too long' using errcode = '22023';
  end if;
  if p_project_id is not null
    and not exists (select 1 from public.projects p where p.id = p_project_id and p.company_id = cid)
  then
    return null;
  end if;
  basis := private.pnl_basis(cid, p_basis);

  with src as (
    select
      l.*,
      case when l.kind = 'income' and basis = 'cash' then coalesce(l.cash_date, l.doc_date) else l.doc_date end as d
    from private.pnl_lines l
    where l.company_id = cid
      and l.in_pnl
      and (basis = 'invoiced' or not l.unpaid)
      and (
        l.kind = 'expense'
        or l.direction = 'expense'
        or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
      and private.pnl_in_range(l.kind, basis, l.doc_date, l.cash_date, p_from, p_to)
  ),
  parts as (
    select date_trunc('month', s.d)::date as month, s.currency,
      case when s.kind = 'income' then s.amount_net else 0 end as income_minor,
      case when s.kind = 'expense' then -s.amount_net else 0 end as expense_minor
    from src s
    where p_project_id is null
       or (s.project_id = p_project_id and (s.kind = 'income' or s.pnl_role = 'project'))
    union all
    select date_trunc('month', s.d)::date, s.currency,
      0,
      -coalesce(private.div_half_even(a.amount_net::numeric * s.amount_net, s.line_amount_net), 0)
    from src s
    join public.allocations a on a.transaction_id = s.transaction_id
    where p_project_id is not null
      and a.project_id = p_project_id
      and s.kind = 'expense'
      and s.pnl_role = 'shared'
  ),
  bounds as (
    select
      case when p_from is null then (select min(x.month) from parts x) else date_trunc('month', p_from)::date end as lo,
      case when p_from is null then greatest(
        date_trunc('month', current_date)::date,
        (select max(x.month) from parts x)
      ) else date_trunc('month', p_to)::date end as hi
  ),
  months as (
    select
      m::date as month,
      greatest(m::date, coalesce(p_from, m::date)) as mfrom,
      least((m + interval '1 month' - interval '1 day')::date, coalesce(p_to, (m + interval '1 month' - interval '1 day')::date)) as mto
    from bounds b
    cross join lateral generate_series(b.lo, b.hi, interval '1 month') m
    where b.lo is not null
  ),
  sums as (
    select x.month, x.currency, sum(x.income_minor)::bigint as income_minor, sum(x.expense_minor)::bigint as expense_minor
    from parts x
    group by x.month, x.currency
  ),
  cells as (
    select m.month, k.currency, coalesce(s.income_minor, 0) as income_minor, coalesce(s.expense_minor, 0) as expense_minor
    from months m
    cross join (select private.company_base_currency(cid) as currency union select x.currency from parts x) k
    left join sums s on s.month = m.month and s.currency = k.currency
    where k.currency = private.company_base_currency(cid) or s.month is not null
  ),
  -- The months run back to back, so the share of each is the share of its days in the whole
  -- span, bucketed by month: one pass for every month and both currencies.
  shares as (
    select o.month, o.currency, o.available, o.share_agorot
    from (select min(m.mfrom) as lo, max(m.mto) as hi from months m) r
    cross join lateral private.overhead_shares(
      cid, p_project_id, basis, r.lo, r.hi,
      array['ILS', private.company_base_currency(cid)], true
    ) o
    where p_project_id is not null
      and r.lo is not null
  ),
  overhead as (
    select s.month, s.available, s.share_agorot
    from shares s
    where s.currency = 'ILS'
  ),
  overhead_base as (
    select s.month, s.available, s.share_agorot
    from shares s
    where s.currency = private.company_base_currency(cid)
  )
  select jsonb_build_object(
    'basis', basis,
    'base_currency', private.company_base_currency(cid),
    'from', p_from,
    'to', p_to,
    'project_id', p_project_id,
    'after_overhead', case when p_project_id is null then null else (
      select coalesce(p.after_overhead, c.after_overhead)
      from public.projects p
      join public.companies c on c.id = p.company_id
      where p.id = p_project_id
    ) end,
    'months', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', to_char(m.month, 'YYYY-MM'),
        'from', m.mfrom,
        'to', m.mto,
        'open', current_date between m.month and (m.month + interval '1 month' - interval '1 day')::date,
        'by_currency', (
          select jsonb_agg(jsonb_build_object(
            'currency', c.currency,
            'income_minor', c.income_minor,
            'expense_minor', c.expense_minor,
            'profit_minor', c.income_minor - c.expense_minor
          ) order by c.currency <> private.company_base_currency(cid), c.currency)
          from cells c
          where c.month = m.month
        ),
        'overhead_weighted', case when p_project_id is null then null else coalesce(o.available, false) end,
        'overhead_share_agorot', case when coalesce(o.available, false) then coalesce(o.share_agorot, 0) else null end,
        'overhead_share_minor', case when coalesce(ob.available, false) then coalesce(ob.share_agorot, 0) else null end
      ) order by m.month desc)
      from months m
      left join overhead o on o.month = m.month
      left join overhead_base ob on ob.month = m.month
    ), '[]'::jsonb),
    'by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', t.currency,
        'income_minor', t.income_minor,
        'expense_minor', t.expense_minor,
        'profit_minor', t.income_minor - t.expense_minor
      ) order by t.currency <> private.company_base_currency(cid), t.currency)
      from (
        select c.currency, sum(c.income_minor)::bigint as income_minor, sum(c.expense_minor)::bigint as expense_minor
        from cells c
        group by c.currency
      ) t
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$function$;

revoke all on function public.get_profit_months(date, date, text, uuid) from public, anon;
grant execute on function public.get_profit_months(date, date, text, uuid) to authenticated, service_role;

-- The company P&L from one read of its lines.
CREATE OR REPLACE FUNCTION public.company_pnl(p_company_id uuid, p_from date, p_to date, p_basis text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare
  basis text;
  result jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role'
    and not exists (
      select 1 from public.companies
      where id = p_company_id and id = (select private.readable_company_id())
    )
  then
    raise exception 'forbidden';
  end if;
  if p_company_id is null or not exists (select 1 from public.companies where id = p_company_id) then
    return null;
  end if;
  basis := case when p_basis = 'invoiced' then 'invoiced' else 'cash' end;

  with bounds as (
    select
      p_from as dfrom,
      p_to as dto,
      case
        when p_from is null or p_to is null then null
        else (p_from - ((p_to - p_from) + 1))
      end as pfrom,
      case when p_from is null or p_to is null then null else (p_from - 1) end as pto
  ),
  -- The company's counted lines, read once: every income line that counts on the basis and
  -- every expense line, in every currency, with the period and the period before marked.
  -- Income dates on the cash basis by when it was paid; expense always by its document date.
  lines as materialized (
    select
      l.transaction_id,
      l.project_id,
      l.pnl_role,
      l.kind,
      l.currency,
      l.amount_net,
      l.line_amount_net,
      l.in_pnl,
      l.loan_split_fallback,
      l.unassigned,
      l.doc_date,
      case
        when (select dfrom from bounds) is null then true
        when l.kind = 'income' and basis = 'cash' then coalesce(l.cash_date, l.doc_date) between (select dfrom from bounds) and (select dto from bounds)
        else l.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        when l.kind = 'income' and basis = 'cash' then coalesce(l.cash_date, l.doc_date) between (select pfrom from bounds) and (select pto from bounds)
        else l.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from private.pnl_lines l
    where l.company_id = p_company_id
      and (basis = 'invoiced' or not l.unpaid)
      and (
        l.kind = 'expense'
        or (
          l.kind = 'income'
          and (
            l.direction = 'expense'
            or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
            or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          )
        )
      )
  ),
  income_all as (
    select l.project_id, l.currency, l.amount_net, l.in_pnl, l.unassigned, l.in_period, l.in_prev
    from lines l
    where l.kind = 'income'
  ),
  expense_all as (
    select
      l.transaction_id as id,
      l.project_id,
      l.pnl_role,
      l.currency,
      l.amount_net,
      l.line_amount_net,
      l.in_pnl,
      l.loan_split_fallback,
      l.unassigned,
      l.doc_date,
      l.in_period,
      l.in_prev
    from lines l
    where l.kind = 'expense'
  ),
  -- The shekel totals at the top of the payload.
  income as (
    select i.project_id, i.amount_net, i.in_pnl, i.in_period, i.in_prev
    from income_all i
    where i.currency = 'ILS'
  ),
  expense as (
    select e.id, e.project_id, e.pnl_role, e.amount_net, e.line_amount_net, e.in_pnl, e.unassigned, e.doc_date, e.in_period, e.in_prev
    from expense_all e
    where e.currency = 'ILS'
  ),
  shared_alloc_all as (
    select
      a.project_id,
      e.currency,
      coalesce(private.div_half_even(a.amount_net::numeric * e.amount_net, e.line_amount_net), 0) as amount_net,
      e.in_period,
      e.in_prev
    from public.allocations a
    join expense_all e on e.id = a.transaction_id
    where e.pnl_role = 'shared'
      and e.in_pnl
  ),
  shared_alloc as (
    select s.project_id, s.amount_net, s.in_period, s.in_prev
    from shared_alloc_all s
    where s.currency = 'ILS'
  ),
  unassigned_by_currency as (
    select
      parts.currency,
      coalesce(sum(parts.income_net), 0)::bigint as unassigned_income_minor,
      -coalesce(sum(parts.expense_net), 0)::bigint as unassigned_expense_minor
    from (
      select i.currency, i.amount_net as income_net, 0::bigint as expense_net
      from income_all i
      where i.in_period and i.in_pnl and i.unassigned
      union all
      select e.currency, 0::bigint, e.amount_net
      from expense_all e
      where e.in_period and e.in_pnl and e.unassigned
    ) parts
    group by parts.currency
  ),
  fallback_by_currency as (
    select e.currency, count(distinct e.id)::integer as fallback_count
    from expense_all e
    where e.in_period and e.loan_split_fallback
    group by e.currency
  ),
  excluded_by_currency as (
    select
      parts.currency,
      coalesce(sum(parts.excluded_income), 0)::bigint as excluded_income_minor,
      coalesce(sum(parts.excluded_expense), 0)::bigint as excluded_expense_minor,
      coalesce(sum(parts.excluded_count), 0)::integer as excluded_count
    from (
      select i.currency, i.amount_net as excluded_income, 0::bigint as excluded_expense, 1 as excluded_count
      from income_all i
      where i.in_period and not i.in_pnl
      union all
      select e.currency, 0::bigint, (-e.amount_net)::bigint, 1
      from expense_all e
      where e.in_period and not e.in_pnl
    ) parts
    group by parts.currency
  ),
  prev_currency as (
    select
      parts.currency,
      coalesce(sum(parts.income_net), 0)::bigint as income_minor,
      -coalesce(sum(parts.expense_net), 0)::bigint as expense_minor
    from (
      select i.currency, i.amount_net as income_net, 0::bigint as expense_net
      from income_all i
      where i.in_prev and i.in_pnl
      union all
      select e.currency, 0::bigint, e.amount_net
      from expense_all e
      where e.in_prev and e.in_pnl
    ) parts
    group by parts.currency
  ),
  company_currency as (
    select
      parts.currency,
      coalesce(sum(parts.income_net), 0)::bigint as income_minor,
      -coalesce(sum(parts.direct_net), 0)::bigint as direct_minor,
      -coalesce(sum(parts.shared_net), 0)::bigint as shared_minor,
      -coalesce(sum(parts.overhead_net), 0)::bigint as overhead_minor,
      -coalesce(sum(parts.expense_net), 0)::bigint as expense_minor,
      (coalesce(sum(parts.income_net), 0) + coalesce(sum(parts.expense_net), 0))::bigint as net_profit_minor
    from (
      select i.currency, i.amount_net as income_net, 0::bigint as direct_net, 0::bigint as shared_net, 0::bigint as overhead_net, 0::bigint as expense_net
      from income_all i
      where i.in_period and i.in_pnl
      union all
      select
        e.currency,
        0::bigint,
        case when e.pnl_role = 'project' and not e.unassigned then e.amount_net else 0::bigint end,
        case when e.pnl_role = 'shared' and not e.unassigned then e.amount_net else 0::bigint end,
        case when e.pnl_role = 'overhead' then e.amount_net else 0::bigint end,
        e.amount_net
      from expense_all e
      where e.in_period and e.in_pnl
    ) parts
    group by parts.currency
  ),
  currency_line_counts as (
    select
      l.currency,
      count(distinct l.transaction_id)::integer as line_count
    from lines l
    where l.in_pnl
      and l.in_period
    group by l.currency
  ),
  project_currency as (
    select
      parts.project_id,
      parts.currency,
      coalesce(sum(parts.income_net), 0)::bigint as income_net,
      coalesce(sum(parts.direct_net), 0)::bigint as direct_net,
      coalesce(sum(parts.shared_net), 0)::bigint as shared_net
    from (
      select i.project_id, i.currency, i.amount_net as income_net, 0::bigint as direct_net, 0::bigint as shared_net
      from income_all i
      where i.in_period and i.in_pnl
      union all
      select e.project_id, e.currency, 0::bigint, e.amount_net, 0::bigint
      from expense_all e
      where e.in_period and e.in_pnl and e.pnl_role = 'project' and e.project_id is not null
      union all
      select s.project_id, s.currency, 0::bigint, 0::bigint, s.amount_net
      from shared_alloc_all s
      where s.in_period
    ) parts
    where parts.project_id is not null
    group by parts.project_id, parts.currency
    having coalesce(sum(parts.income_net), 0) <> 0
      or coalesce(sum(parts.direct_net), 0) <> 0
      or coalesce(sum(parts.shared_net), 0) <> 0
  ),
  project_rows as (
    select
      p.id,
      p.name,
      p.status,
      p.state_label,
      p.budget_agorot,
      p.sumit_budget_section_id,
      p.group_id,
      coalesce((select sum(i.amount_net) from income i where i.project_id = p.id and i.in_period and i.in_pnl), 0) as income_net,
      coalesce((select sum(e.amount_net) from expense e where e.project_id = p.id and e.pnl_role = 'project' and e.in_period and e.in_pnl), 0) as direct_net,
      coalesce((select sum(s.amount_net) from shared_alloc s where s.project_id = p.id and s.in_period), 0) as shared_net
    from public.projects p
    where p.company_id = p_company_id
  )
  select jsonb_build_object(
    'company_id', c.id,
    'name', c.name,
    'vat_registered', c.vat_registered,
    'basis', basis,
    'base_currency', c.base_currency,
    'from', p_from,
    'to', p_to,
    'income_agorot', coalesce((select sum(amount_net) from income where in_period and in_pnl), 0),
    'direct_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'project' and not unassigned and in_period and in_pnl), 0),
    'shared_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'shared' and not unassigned and in_period and in_pnl), 0),
    'overhead_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'overhead' and in_period and in_pnl), 0),
    'expense_agorot', -coalesce((select sum(amount_net) from expense where in_period and in_pnl), 0),
    'net_profit_agorot',
      coalesce((select sum(amount_net) from income where in_period and in_pnl), 0)
      + coalesce((select sum(amount_net) from expense where in_period and in_pnl), 0),
    'unassigned_income_agorot', coalesce((select u.unassigned_income_minor from unassigned_by_currency u where u.currency = 'ILS'), 0),
    'unassigned_expense_agorot', coalesce((select u.unassigned_expense_minor from unassigned_by_currency u where u.currency = 'ILS'), 0),
    'overhead_project_id', c.overhead_project_id,
    'excluded_income_agorot', coalesce((select sum(amount_net) from income where in_period and not in_pnl), 0),
    'excluded_expense_agorot', coalesce((select -sum(amount_net) from expense where in_period and not in_pnl), 0),
    'prev_income_agorot', case when p_from is null then null else coalesce((select sum(amount_net) from income where in_prev and in_pnl), 0) end,
    'prev_expense_agorot', case when p_from is null then null else -coalesce((select sum(amount_net) from expense where in_prev and in_pnl), 0) end,
    'prev_net_agorot', case when p_from is null then null else
      coalesce((select sum(amount_net) from income where in_prev and in_pnl), 0)
      + coalesce((select sum(amount_net) from expense where in_prev and in_pnl), 0)
    end,
    'active_projects', (select count(*) from public.projects p where p.company_id = c.id and p.status = 'active'),
    'review_count', (
      select count(*)
      from public.review_queue q
      left join public.transactions rt on rt.id = q.transaction_id
      where q.company_id = c.id
        and q.status = 'open'
        and (rt.id is null or (rt.removed_at is null and rt.line_status <> 'pending'))
    ),
    'other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'income_minor', bucket.income_minor,
        'expense_minor', bucket.expense_minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          l.currency,
          coalesce(sum(l.amount_net) filter (where l.kind = 'income'), 0)::bigint as income_minor,
          coalesce(sum(l.amount_net) filter (where l.kind = 'expense'), 0)::bigint as expense_minor,
          count(distinct l.transaction_id)::integer as line_count
        from lines l
        where l.in_pnl
          and l.in_period
          and l.currency <> 'ILS'
        group by l.currency
      ) bucket
    ), '[]'::jsonb),
    'by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', k.currency,
        'income_minor', coalesce(cc.income_minor, 0),
        'direct_minor', coalesce(cc.direct_minor, 0),
        'shared_minor', coalesce(cc.shared_minor, 0),
        'overhead_minor', coalesce(cc.overhead_minor, 0),
        'expense_minor', coalesce(cc.expense_minor, 0),
        'net_profit_minor', coalesce(cc.net_profit_minor, 0),
        'excluded_income_minor', coalesce(ex.excluded_income_minor, 0),
        'excluded_expense_minor', coalesce(ex.excluded_expense_minor, 0),
        'excluded_count', coalesce(ex.excluded_count, 0),
        'count', coalesce(lc.line_count, 0),
        'loan_split_fallback_count', coalesce(fb.fallback_count, 0),
        'unassigned_income_minor', coalesce(un.unassigned_income_minor, 0),
        'unassigned_expense_minor', coalesce(un.unassigned_expense_minor, 0),
        'prev_income_minor', case when p_from is null then null else coalesce(pv.income_minor, 0) end,
        'prev_expense_minor', case when p_from is null then null else coalesce(pv.expense_minor, 0) end,
        'prev_net_profit_minor', case when p_from is null then null else coalesce(pv.income_minor, 0) - coalesce(pv.expense_minor, 0) end
      ) order by k.currency is distinct from c.base_currency, k.currency)
      from (
        select currency from company_currency
        union
        select currency from excluded_by_currency
        union
        select currency from prev_currency where p_from is not null
      ) k
      left join company_currency cc on cc.currency = k.currency
      left join currency_line_counts lc on lc.currency = k.currency
      left join excluded_by_currency ex on ex.currency = k.currency
      left join fallback_by_currency fb on fb.currency = k.currency
      left join unassigned_by_currency un on un.currency = k.currency
      left join prev_currency pv on pv.currency = k.currency
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'name', r.name,
          'status', r.status,
          'state_label', r.state_label,
          'budget_agorot', r.budget_agorot,
          'sumit_budget_section_id', r.sumit_budget_section_id,
          'group_id', r.group_id,
          'is_overhead', r.id is not distinct from c.overhead_project_id,
          'income_agorot', r.income_net,
          'direct_agorot', -r.direct_net,
          'shared_agorot', -r.shared_net,
          'profit_before_shared_agorot', r.income_net + r.direct_net,
          'profit_agorot', r.income_net + r.direct_net + r.shared_net,
          'by_currency', coalesce((
            select jsonb_agg(jsonb_build_object(
              'currency', pc.currency,
              'income_minor', pc.income_net,
              'direct_minor', -pc.direct_net,
              'shared_minor', -pc.shared_net,
              'profit_minor', pc.income_net + pc.direct_net + pc.shared_net
            ) order by pc.currency is distinct from c.base_currency, pc.currency)
            from project_currency pc
            where pc.project_id = r.id
          ), '[]'::jsonb)
        )
        order by coalesce((
          select abs(pc.income_net) + abs(pc.direct_net)
          from project_currency pc
          where pc.project_id = r.id and pc.currency = c.base_currency
        ), 0) desc, r.name
      )
      from project_rows r
    ), '[]'::jsonb)
  )
  into result
  from public.companies c
  where c.id = p_company_id;

  if result is not null then
    result := result || jsonb_build_object(
      'groups', private.company_pnl_groups(result->'projects', p_company_id, result->>'base_currency')
    );
  end if;
  return result;
end;

$function$;

revoke all on function public.company_pnl(uuid, date, date, text) from public, anon;
grant execute on function public.company_pnl(uuid, date, date, text) to authenticated, service_role;

-- The projects tab from one read of the company's lines, without company_pnl.
CREATE OR REPLACE FUNCTION public.projects_cash_month(p_month date DEFAULT NULL::date, p_today date DEFAULT NULL::date, p_project uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  month_start date;
  month_end date;
  basis text;
  base text;
  overhead_id uuid;
  pnl_basis text;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if p_project is not null and not exists (
    select 1 from public.projects p where p.id = p_project and p.company_id = cid
  ) then
    return null;
  end if;
  select c.cash_basis, c.base_currency, c.overhead_project_id
  into basis, base, overhead_id
  from public.companies c
  where c.id = cid;
  month_start := date_trunc('month', coalesce(p_month, today))::date;
  month_end := (month_start + interval '1 month' - interval '1 day')::date;
  -- The project totals below count as company_pnl(cid, month, basis) and
  -- company_pnl(cid, all time, basis) count their projects' by_currency, and company_pnl reads
  -- anything but 'invoiced' as the cash basis.
  pnl_basis := case when basis = 'invoiced' then 'invoiced' else 'cash' end;

  with parts as (
    select * from private.cash_parts(cid, basis, month_start, month_end)
    where in_cash
  ),
  direct_parts as (
    select p.transaction_id, p.currency, p.kind, p.project_id as owner_id, p.amount_minor
    from parts p
    where p.pnl_role is distinct from 'shared' and p.project_id is not null
  ),
  unfiled_parts as (
    select p.transaction_id, p.currency, p.kind, null::uuid as owner_id, p.amount_minor
    from parts p
    where p.pnl_role is distinct from 'shared' and p.project_id is null
  ),
  shared_parts as (
    select
      p.transaction_id, p.part, p.category_id, p.currency, p.kind, p.amount_minor,
      least(coalesce(sum(a.share_bp), 0), 10000) as total_bp
    from parts p
    left join public.allocations a on a.transaction_id = p.transaction_id and a.company_id = cid
    where p.pnl_role = 'shared'
    group by p.transaction_id, p.part, p.category_id, p.currency, p.kind, p.amount_minor
  ),
  shared_alloc as (
    select
      sp.transaction_id, sp.part, sp.category_id, sp.currency, sp.kind, sp.amount_minor,
      a.project_id,
      a.share_bp,
      private.div_half_even(sp.amount_minor::numeric * a.share_bp, 10000::numeric) as share_minor,
      private.div_half_even(sp.amount_minor::numeric * sp.total_bp, 10000::numeric) as alloc_total
    from shared_parts sp
    join public.allocations a on a.transaction_id = sp.transaction_id and a.company_id = cid
  ),
  shared_owned as (
    select
      x.transaction_id, x.currency, x.kind, x.project_id as owner_id,
      (x.share_minor + case
        when row_number() over (partition by x.transaction_id, x.part, x.category_id order by x.share_bp desc, x.project_id) = 1
          then x.alloc_total - sum(x.share_minor) over (partition by x.transaction_id, x.part, x.category_id)
        else 0
      end)::bigint as amount_minor
    from shared_alloc x
  ),
  shared_unassigned as (
    select
      sp.transaction_id, sp.currency, sp.kind, null::uuid as owner_id,
      (sp.amount_minor - private.div_half_even(sp.amount_minor::numeric * sp.total_bp, 10000::numeric))::bigint as amount_minor
    from shared_parts sp
  ),
  attributed as (
    select * from direct_parts
    union all select * from unfiled_parts
    union all select * from shared_owned
    union all select * from shared_unassigned
  ),
  project_cash as (
    select
      a.owner_id, a.currency,
      coalesce(sum(a.amount_minor) filter (where a.kind = 'income'), 0)::bigint as in_minor,
      coalesce(sum(-a.amount_minor) filter (where a.kind = 'expense'), 0)::bigint as out_minor
    from attributed a
    where a.owner_id is not null
    group by a.owner_id, a.currency
  ),
  unassigned_cash as (
    select
      a.currency,
      coalesce(sum(a.amount_minor) filter (where a.kind = 'income'), 0)::bigint as in_minor,
      coalesce(sum(-a.amount_minor) filter (where a.kind = 'expense'), 0)::bigint as out_minor
    from attributed a
    where a.owner_id is null
    group by a.currency
  ),
  unassigned_lines as (
    select count(distinct a.transaction_id)::integer as n
    from attributed a
    where a.owner_id is null and a.amount_minor <> 0
  ),
  -- The company's lines, read once: the project totals and every project's first month.
  pnl as materialized (
    select
      l.transaction_id, l.project_id, l.kind, l.pnl_role, l.direction, l.doc_kind, l.currency,
      l.amount_net, l.line_amount_net, l.in_pnl, l.unpaid, l.doc_date, l.cash_date
    from private.pnl_lines l
    where l.company_id = cid
  ),
  pnl_counted as (
    select
      l.transaction_id, l.project_id, l.kind, l.pnl_role, l.currency, l.amount_net, l.line_amount_net,
      coalesce(
        case when l.kind = 'income' and pnl_basis = 'cash' then coalesce(l.cash_date, l.doc_date) else l.doc_date end
          between month_start and month_end,
        false
      ) as in_month
    from pnl l
    where l.in_pnl
      and (pnl_basis = 'invoiced' or not l.unpaid)
      and (
        l.kind = 'expense'
        or (
          l.kind = 'income'
          and (
            l.direction = 'expense'
            or (pnl_basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
            or (pnl_basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          )
        )
      )
  ),
  pnl_parts as (
    select l.project_id, l.currency, l.in_month, l.amount_net as income_net, 0::bigint as direct_net, 0::bigint as shared_net
    from pnl_counted l
    where l.kind = 'income'
    union all
    select l.project_id, l.currency, l.in_month, 0::bigint, l.amount_net, 0::bigint
    from pnl_counted l
    where l.kind = 'expense' and l.pnl_role = 'project' and l.project_id is not null
    union all
    select a.project_id, l.currency, l.in_month, 0::bigint, 0::bigint,
      coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
    from pnl_counted l
    join public.allocations a on a.transaction_id = l.transaction_id
    where l.kind = 'expense' and l.pnl_role = 'shared'
  ),
  -- Per project and currency, company_pnl's income_net, direct_net and shared_net for the month
  -- and for all time.
  pnl_sums as (
    select
      x.project_id,
      x.currency,
      coalesce(sum(x.income_net) filter (where x.in_month), 0)::bigint as month_income,
      coalesce(sum(x.direct_net) filter (where x.in_month), 0)::bigint as month_direct,
      coalesce(sum(x.shared_net) filter (where x.in_month), 0)::bigint as month_shared,
      coalesce(sum(x.income_net), 0)::bigint as all_income,
      coalesce(sum(x.direct_net), 0)::bigint as all_direct,
      coalesce(sum(x.shared_net), 0)::bigint as all_shared
    from pnl_parts x
    where x.project_id is not null
    group by x.project_id, x.currency
  ),
  pnl_projects as (
    select
      s.project_id,
      s.currency,
      s.month_income + s.month_direct + s.month_shared as profit_month,
      s.all_income + s.all_direct + s.all_shared as profit_all,
      (-s.all_direct) + (-s.all_shared) as spent_all
    from pnl_sums s
  ),
  -- Every project's lines (filed, shared or split to it, as private.project_line_ids lists them)
  -- and the month of the earliest.
  project_lines as (
    select t.project_id, t.id as transaction_id
    from public.transactions t
    where t.company_id = cid and t.project_id is not null
    union
    select a.project_id, a.transaction_id
    from public.allocations a
    where a.company_id = cid
    union
    select s.project_id, s.transaction_id
    from public.line_splits s
    where s.company_id = cid and s.project_id is not null
  ),
  first_months as (
    select pl.project_id, to_char(date_trunc('month', min(l.doc_date)), 'YYYY-MM-DD') as first_month
    from project_lines pl
    join pnl l on l.transaction_id = pl.transaction_id
    group by pl.project_id
  ),
  project_rows as (
    select
      p.id,
      p.name,
      p.state_label as type,
      p.status::text as status,
      p.id is not distinct from overhead_id as is_overhead,
      p.group_id,
      p.created_at,
      p.finished_on,
      p.budget_agorot as budget_minor,
      coalesce((select r.spent_all from pnl_projects r where r.project_id = p.id and r.currency = base), 0) as spent_minor,
      coalesce((select r.profit_month from pnl_projects r where r.project_id = p.id and r.currency = base), 0) as profit_month_minor,
      coalesce((select r.profit_all from pnl_projects r where r.project_id = p.id and r.currency = base), 0) as profit_all_minor,
      (select f.first_month from first_months f where f.project_id = p.id) as first_month,
      jsonb_array_length(public.project_waiting(p.id)) as pending_count,
      private.project_is_empty(cid, p.id) as deletable,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency', pc.currency,
          'in_minor', pc.in_minor,
          'out_minor', pc.out_minor,
          'net_minor', pc.in_minor - pc.out_minor
        ) order by pc.currency is distinct from base, pc.currency)
        from project_cash pc
        where pc.owner_id = p.id
      ), '[]'::jsonb) as cash
    from public.projects p
    where p.company_id = cid
      and (p_project is null or p.id = p_project)
  )
  select jsonb_build_object(
    'month', to_char(month_start, 'YYYY-MM-DD'),
    'base_currency', base,
    'basis', basis,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'type', r.type,
        'status', r.status,
        'is_overhead', r.is_overhead,
        'group_id', r.group_id,
        'created_at', r.created_at,
        'finished_on', r.finished_on,
        'budget_minor', r.budget_minor,
        'spent_minor', r.spent_minor,
        'cash', r.cash,
        'profit_month_minor', r.profit_month_minor,
        'profit_all_minor', r.profit_all_minor,
        'first_month', r.first_month,
        'pending_count', r.pending_count,
        'deletable', r.deletable
      ) order by r.name)
      from project_rows r
    ), '[]'::jsonb),
    'unassigned', jsonb_build_object(
      'count', (select n from unassigned_lines),
      'cash', coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency', uc.currency,
          'in_minor', uc.in_minor,
          'out_minor', uc.out_minor,
          'net_minor', uc.in_minor - uc.out_minor
        ) order by uc.currency is distinct from base, uc.currency)
        from unassigned_cash uc
      ), '[]'::jsonb)
    )
  )
  into result;

  return result;
end;
$function$;

revoke all on function public.projects_cash_month(date, date, uuid) from public, anon;
grant execute on function public.projects_cash_month(date, date, uuid) to authenticated, service_role;

-- The project page: one read of its lines and one overhead pass for both currencies.
CREATE OR REPLACE FUNCTION public.get_project(p_id uuid, p_basis text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
declare
  cid uuid;
  basis text;
  result jsonb;
  profit bigint;
  available boolean;
  share bigint;
  waiting jsonb;
  ids uuid[];
  all_rows private.pnl_lines[];
  pl_rows private.pnl_lines[];
  share_base bigint;
  available_base boolean;
  cats_ils jsonb;
  cats_in jsonb;
  cats_out jsonb;
  base text;
begin
  select c.id into cid
    from public.companies c
    where c.id = (select private.readable_company_id());
  if cid is null then
    return null;
  end if;
  if (p_from is null) <> (p_to is null) or p_from > p_to then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  basis := private.pnl_basis(cid, p_basis);

  waiting := public.project_waiting(p_id);
  -- Every line this project can count: filed to it, shared to it, or split to it. The totals
  -- below read only these lines, so the page costs the project's lines, not the company's.
  ids := array(
    select t.id from public.transactions t where t.company_id = cid and t.project_id = p_id
    union
    select a.transaction_id from public.allocations a where a.company_id = cid and a.project_id = p_id
    union
    select s.transaction_id from public.line_splits s where s.company_id = cid and s.project_id = p_id
  );
  -- The project's lines, read once. Every total below reads pl_rows, the ones that count on
  -- the basis and range, and each transaction's kept_out reads all_rows, instead of reading
  -- private.pnl_lines again.
  all_rows := array(
    select u from private.pnl_lines u
    where u.transaction_id = any(ids)
  );
  pl_rows := array(
    select u from unnest(all_rows) u
    where (basis = 'invoiced' or not u.unpaid)
      and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)
  );
  -- One pass over the project's category entries feeds the three category lists (three before).
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'amount_agorot', s.amount,
      'has_shared_share', s.shared
    ) order by s.amount desc, c.name) filter (where s.in_pnl and s.currency = 'ILS'), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'currency', s.currency,
      'id', c.id,
      'name', c.name,
      'amount_minor', s.amount,
      'has_shared_share', s.shared
    ) order by s.currency, s.amount desc, c.name) filter (where s.in_pnl), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'currency', s.currency,
      'id', c.id,
      'name', c.name,
      'amount_minor', s.amount,
      'has_shared_share', s.shared
    ) order by s.currency, s.amount desc, c.name) filter (where not s.in_pnl), '[]'::jsonb)
  into cats_ils, cats_in, cats_out
  from (
    select e.currency,
      e.category_id,
      private.line_in_pnl(
        case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
          then lt.in_pnl_override end,
        cat.excluded_from_pnl, cat.loan_part
      ) as in_pnl,
      (-sum(e.amount_net))::bigint as amount,
      bool_or(e.shared) as shared
    from private.project_category_entries_by_currency(p_id) e
    left join public.categories cat on cat.id = e.category_id
    join public.transactions lt on lt.id = e.transaction_id
    where (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
      and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to)
    group by 1, 2, 3
  ) s
  left join public.categories c on c.id = s.category_id;

  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'status', p.status,
    'state_label', p.state_label,
    'budget_agorot', p.budget_agorot,
    'sumit_budget_section_id', p.sumit_budget_section_id,
    'is_overhead', p.id is not distinct from (select c.overhead_project_id from public.companies c where c.id = cid),
    'after_overhead', coalesce(p.after_overhead, (select c.after_overhead from public.companies c where c.id = cid)),
    'income_agorot', coalesce((
      select sum(l.amount_net) from unnest(pl_rows) l
      where l.project_id = p.id and l.kind = 'income'
        and l.in_pnl
        and l.currency = 'ILS'
        and (
          l.direction = 'expense'
          or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
          or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
        )
    ), 0),
    'direct_agorot', -coalesce((
      select sum(l.amount_net) from unnest(pl_rows) l
      where l.project_id = p.id and l.kind = 'expense' and l.pnl_role = 'project'
        and l.in_pnl
        and l.currency = 'ILS'
    ), 0),
    'shared_agorot', -coalesce((
      select sum(coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0))
      from unnest(pl_rows) l
      -- Lines first, then each line's share by index, so the allocations never drive the join.
      cross join lateral (
        select a.amount_net from public.allocations a
        where a.transaction_id = l.transaction_id and a.project_id = p.id
        offset 0 -- keeps this a per-line lookup
      ) a
      where l.kind = 'expense' and l.pnl_role = 'shared' and l.in_pnl
        and l.currency = 'ILS'
    ), 0),
    'by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', b.currency,
        'income_minor', b.income_minor,
        'direct_minor', b.direct_minor,
        'shared_minor', b.shared_minor,
        'profit_minor', b.income_minor - b.direct_minor - b.shared_minor
      ) order by b.currency)
      from (
        select
          parts.currency,
          coalesce(sum(parts.income_minor), 0)::bigint as income_minor,
          coalesce(sum(parts.direct_minor), 0)::bigint as direct_minor,
          coalesce(sum(parts.shared_minor), 0)::bigint as shared_minor
        from (
          select l.currency as currency,
            case when l.kind = 'income' and (
                l.direction = 'expense'
                or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              ) then l.amount_net else 0 end as income_minor,
            case when l.kind = 'expense' and l.pnl_role = 'project' then -l.amount_net else 0 end as direct_minor,
            0::bigint as shared_minor
          from unnest(pl_rows) l
          where l.project_id = p.id
            and l.in_pnl
          union all
          select l.currency as currency,
            0::bigint,
            0::bigint,
            -coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0) as shared_minor
          from unnest(pl_rows) l
          -- Lines first, then each line's share by index, so the allocations never drive the join.
          cross join lateral (
            select a.amount_net from public.allocations a
            where a.transaction_id = l.transaction_id and a.project_id = p.id
            offset 0 -- keeps this a per-line lookup
          ) a
          where l.kind = 'expense' and l.pnl_role = 'shared'
            and l.in_pnl
        ) parts
        group by parts.currency
      ) b
    ), '[]'::jsonb),
    'categories', cats_ils,
    'categories_by_currency', cats_in,
    'excluded_categories_by_currency', cats_out,
    -- FLOW-121: income filed to this project that is out of the P&L, by category, on the
    -- same basis as income_agorot. Positive minor units.
    'excluded_income_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', s.currency,
        'id', c.id,
        'name', c.name,
        'amount_minor', s.amount,
        'count', s.line_count
      ) order by s.currency, s.amount desc, c.name)
      from (
        select l.currency,
          l.category_id,
          sum(l.amount_net)::bigint as amount,
          count(distinct l.transaction_id)::integer as line_count
        from unnest(pl_rows) l
        where l.project_id = p.id
          and l.company_id = cid
          and l.kind = 'income'
          and not l.in_pnl
          and (
            l.direction = 'expense'
            or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
            or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          )
        group by l.currency, l.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'income_minor', bucket.income_minor,
        'expense_minor', bucket.expense_minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          parts.currency,
          sum(parts.income_minor)::bigint as income_minor,
          sum(parts.expense_minor)::bigint as expense_minor,
          count(distinct parts.transaction_id)::integer as line_count
        from (
          select
            l.currency,
            case when l.kind = 'income' then l.amount_net else 0 end as income_minor,
            case when l.kind = 'expense' then l.amount_net else 0 end as expense_minor,
            l.transaction_id
          from unnest(pl_rows) l
          where l.project_id = p.id
            and l.in_pnl
            and l.currency <> 'ILS'
            and (
              (l.kind = 'income' and (
                l.direction = 'expense'
                or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              ))
              or (l.kind = 'expense' and l.pnl_role = 'project')
            )
          union all
          select l.currency, 0, coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0), l.transaction_id
          from unnest(pl_rows) l
          -- Lines first, then each line's share by index, so the allocations never drive the join.
          cross join lateral (
            select a.amount_net from public.allocations a
            where a.transaction_id = l.transaction_id and a.project_id = p.id
            offset 0 -- keeps this a per-line lookup
          ) a
          where l.kind = 'expense' and l.pnl_role = 'shared'
            and l.in_pnl
            and l.currency <> 'ILS'
        ) parts
        group by parts.currency
      ) bucket
    ), '[]'::jsonb),
    'pending_count', coalesce(jsonb_array_length(waiting), 0),
    'pending_agorot', coalesce((
      select (-sum(t.amount_net))::bigint
      from jsonb_array_elements(waiting) row
      join public.transactions t on t.id = (row->>'transaction_id')::uuid
      where coalesce(t.currency, 'ILS') = 'ILS'
    ), 0),
    'pending_other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'expense_minor', bucket.expense_minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          t.currency,
          sum(t.amount_net)::bigint as expense_minor,
          count(*)::integer as line_count
        from jsonb_array_elements(waiting) row
        join public.transactions t on t.id = (row->>'transaction_id')::uuid
        where coalesce(t.currency, 'ILS') <> 'ILS'
        group by t.currency
      ) bucket
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'description', t.description,
        'doc_date', t.doc_date,
        'amount_net', t.amount_net,
        'currency', coalesce(t.currency, 'ILS'),
        'direction', t.direction,
        'source', t.source,
        'doc_kind', t.doc_kind,
        'line_status', t.line_status,
        'category', c.name,
        'kept_out', case
          when t.line_status = 'posted' then not coalesce((
            select bool_or(pl.in_pnl)
            from unnest(all_rows) pl
            where pl.transaction_id = t.id
              and (pl.project_id = p.id or exists (
                select 1 from public.allocations a
                where a.transaction_id = t.id and a.project_id = p.id
              ))
          ), false)
          else not private.line_in_pnl(
            case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = t.id)
              then t.in_pnl_override end,
            private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
            c.loan_part
          )
        end,
        'parts_minor', case when exists (
          select 1 from public.line_splits s0
          where s0.transaction_id = t.id and s0.company_id = cid
        ) then coalesce((
          select sum(case
              when pc.kind::text is not distinct from coalesce(
                (select lc.kind::text from public.categories lc
                 where lc.id = t.category_id and lc.company_id = t.company_id),
                t.direction::text) then s.amount_minor
              else -s.amount_minor
            end)
          from public.line_splits s
          left join public.categories pc on pc.id = s.category_id and pc.company_id = s.company_id
          where s.transaction_id = t.id
            and s.company_id = cid
            and coalesce(s.project_id, t.project_id) = p.id
        ), 0)::bigint end
      ) order by t.doc_date desc, t.created_at desc, t.id desc)
      from (
        select * from public.transactions t
        where t.company_id = cid
          and t.removed_at is null
          and t.line_status <> 'pending'
          and (t.project_id = p.id or exists (
            select 1 from public.allocations a
            where a.transaction_id = t.id and a.project_id = p.id
          ) or exists (
            select 1 from public.line_splits s
            where s.transaction_id = t.id and s.company_id = cid and s.project_id = p.id
          ))
          and private.pnl_in_range(t.direction::text, basis, t.doc_date, t.cash_date, p_from, p_to)
        order by t.doc_date desc, t.created_at desc, t.id desc
        limit 40
      ) t
      left join public.categories c on c.id = t.category_id
    ), '[]'::jsonb)
  )
  into result
  from public.projects p
  where p.id = p_id and p.company_id = cid;
  if result is null then
    return null;
  end if;
  profit :=
    (result->>'income_agorot')::bigint
    - (result->>'direct_agorot')::bigint
    - (result->>'shared_agorot')::bigint;
  base := private.company_base_currency(cid);
  -- The shekel and base-currency overhead shares in one pass over the company's lines. A
  -- currency with no row has no weighted share.
  select
    bool_or(s.available) filter (where s.currency = 'ILS'),
    max(s.share_agorot) filter (where s.currency = 'ILS'),
    bool_or(s.available) filter (where s.currency = base),
    max(s.share_agorot) filter (where s.currency = base)
  into available, share, available_base, share_base
  from private.overhead_shares(cid, p_id, basis, p_from, p_to, array['ILS', base], false) s;
  -- FLOW-406: parent_id on each category row and the parent roll-ups beside them.
  result := result || jsonb_build_object(
    'categories', private.category_rows_with_parent(result->'categories', cid),
    'categories_by_currency', private.category_rows_with_parent(result->'categories_by_currency', cid),
    'excluded_categories_by_currency', private.category_rows_with_parent(result->'excluded_categories_by_currency', cid),
    'category_rollups', private.category_rollup_rows(result->'categories', 'amount_agorot', cid),
    'category_rollups_by_currency', private.category_rollup_rows(result->'categories_by_currency', 'amount_minor', cid),
    'excluded_category_rollups_by_currency', private.category_rollup_rows(result->'excluded_categories_by_currency', 'amount_minor', cid)
  );
  return result || jsonb_build_object(
    'from', case when p_from is null or p_to is null then null else p_from end,
    'to', case when p_from is null or p_to is null then null else p_to end,
    'profit_agorot', profit,
    'overhead_share_agorot', case when coalesce(available, false) then coalesce(share, 0) else null end,
    'overhead_weighted', coalesce(available, false),
    'base_currency', base,
    'overhead_share_minor', case when coalesce(available_base, false) then coalesce(share_base, 0) else null end,
    'profit_after_overhead_agorot', profit - case when coalesce(available, false) then coalesce(share, 0) else 0 end,
    -- FLOW-404: purchase, ARV, value, rehab and equity. Nothing above reads them.
    'investment', private.project_investment(cid, p_id),
    -- FLOW-105: the loans filed under this project. Nothing above reads them.
    'loans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'name', l.name,
        'currency', l.currency,
        'balance_minor', b.balance_minor,
        'status', l.status,
        'closed_on', l.closed_on,
        'kind', l.kind,
        'principal_minor', l.principal_minor,
        'annual_rate_ppm', l.annual_rate_ppm,
        'term_months', l.term_months,
        'start_date', l.start_date,
        'payment_minor', l.payment_minor,
        'escrow_minor', l.escrow_minor,
        'interest_only_months', l.interest_only_months,
        'amortization_months', l.amortization_months,
        'rates', coalesce((
          select jsonb_agg(jsonb_build_object(
            'effective_date', r.effective_date,
            'annual_rate_ppm', r.annual_rate_ppm
          ) order by r.effective_date)
          from public.loan_rates r
          where r.company_id = l.company_id
            and r.loan_id = l.id
        ), '[]'::jsonb)
      ) order by l.name, l.id)
      from public.loans l
      join public.loan_balances b
        on b.company_id = l.company_id
       and b.loan_id = l.id
      where l.company_id = cid
        and l.project_id = p_id
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.get_project(uuid, text, date, date) from public, anon;
grant execute on function public.get_project(uuid, text, date, date) to authenticated, service_role;

-- Home: the company's lines grouped by currency once.
CREATE OR REPLACE FUNCTION public.get_home()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with co as (
    select c.id, c.name, c.base_currency, c.is_demo
    from public.companies c
    where c.id = (select private.readable_company_id())
  ),
  -- The company's paid lines in the P&L, read once and summed by currency.
  buckets as materialized (
    select
      l.currency,
      sum(
        case
          when l.kind = 'income' and (l.direction = 'expense' or l.doc_kind in ('receipt', 'invoice_receipt')) then l.amount_net
          when l.kind = 'expense' then l.amount_net
          else 0
        end
      )::bigint as net_minor,
      coalesce(sum(l.amount_net) filter (
        where l.kind = 'income' and (l.direction = 'expense' or l.doc_kind in ('receipt', 'invoice_receipt'))
      ), 0)::bigint as income_minor,
      coalesce(sum(l.amount_net) filter (where l.kind = 'expense'), 0)::bigint as expense_minor,
      count(distinct l.transaction_id) filter (
        where (l.kind = 'income' and (l.direction = 'expense' or l.doc_kind in ('receipt', 'invoice_receipt')))
          or l.kind = 'expense'
      )::integer as line_count
    from (select * from private.pnl_lines u where not u.unpaid) l
    where l.company_id = (select co.id from co)
      and l.in_pnl
    group by l.currency
  )
  select coalesce(
    (
      select jsonb_build_object(
        'company_id', c.id,
        'name', c.name,
        'net_profit_agorot', coalesce((select b.net_minor from buckets b where b.currency = 'ILS'), 0),
        'other_currencies', coalesce((
          select jsonb_agg(jsonb_build_object(
            'currency', b.currency,
            'income_minor', b.income_minor,
            'expense_minor', b.expense_minor,
            'count', b.line_count
          ) order by b.currency)
          from buckets b
          where b.currency <> 'ILS'
            and b.line_count > 0
        ), '[]'::jsonb),
        'base_currency', c.base_currency,
        'net_profit_minor', coalesce((select b.net_minor from buckets b where b.currency = c.base_currency), 0),
        'is_demo', c.is_demo
      )
      from co c
    ),
    jsonb_build_object(
      'company_id', null,
      'name', null,
      'net_profit_agorot', 0,
      'other_currencies', '[]'::jsonb,
      'base_currency', 'ILS',
      'net_profit_minor', 0,
      'is_demo', false
    )
  );
$function$;

revoke all on function public.get_home() from public, anon;
grant execute on function public.get_home() to authenticated, service_role;

commit;
