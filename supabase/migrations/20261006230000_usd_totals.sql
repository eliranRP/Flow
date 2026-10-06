-- Per-currency P&L in company_pnl.by_currency and projects[].by_currency.

begin;

set local lock_timeout = '5s';

create or replace function public.company_pnl(
  p_company_id uuid,
  p_from date,
  p_to date,
  p_basis text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  income as (
    select
      t.project_id,
      t.amount_net,
      case
        when (select dfrom from bounds) is null then true
        when basis = 'cash' then coalesce(t.cash_date, t.doc_date) between (select dfrom from bounds) and (select dto from bounds)
        else t.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        when basis = 'cash' then coalesce(t.cash_date, t.doc_date) between (select pfrom from bounds) and (select pto from bounds)
        else t.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from public.transactions t
    where t.company_id = p_company_id
      and t.removed_at is null
      and t.line_status = 'posted'
      and coalesce(t.currency, 'ILS') = 'ILS'
      and t.direction = 'income'
      and (
        (basis = 'cash' and t.doc_kind in ('receipt', 'invoice_receipt'))
        or (basis = 'invoiced' and t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
  ),
  expense as (
    select
      t.id,
      t.project_id,
      t.pnl_role,
      t.amount_net,
      t.doc_date,
      case
        when (select dfrom from bounds) is null then true
        else t.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        else t.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from public.transactions t
    where t.company_id = p_company_id
      and t.removed_at is null
      and t.line_status = 'posted'
      and coalesce(t.currency, 'ILS') = 'ILS'
      and t.direction = 'expense'
  ),
  shared_alloc as (
    select a.project_id, a.amount_net, e.in_period, e.in_prev
    from public.allocations a
    join expense e on e.id = a.transaction_id
    where e.pnl_role = 'shared'
  ),
  income_all as (
    select
      t.project_id,
      coalesce(t.currency, 'ILS') as currency,
      t.amount_net,
      case
        when (select dfrom from bounds) is null then true
        when basis = 'cash' then coalesce(t.cash_date, t.doc_date) between (select dfrom from bounds) and (select dto from bounds)
        else t.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        when basis = 'cash' then coalesce(t.cash_date, t.doc_date) between (select pfrom from bounds) and (select pto from bounds)
        else t.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from public.transactions t
    where t.company_id = p_company_id
      and t.removed_at is null
      and t.line_status = 'posted'
      and t.direction = 'income'
      and (
        (basis = 'cash' and t.doc_kind in ('receipt', 'invoice_receipt'))
        or (basis = 'invoiced' and t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
  ),
  expense_all as (
    select
      t.id,
      t.project_id,
      t.pnl_role,
      coalesce(t.currency, 'ILS') as currency,
      t.amount_net,
      t.doc_date,
      case
        when (select dfrom from bounds) is null then true
        else t.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        else t.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from public.transactions t
    where t.company_id = p_company_id
      and t.removed_at is null
      and t.line_status = 'posted'
      and t.direction = 'expense'
  ),
  shared_alloc_all as (
    select a.project_id, coalesce(e.currency, 'ILS') as currency, a.amount_net, e.in_period, e.in_prev
    from public.allocations a
    join expense_all e on e.id = a.transaction_id
    where e.pnl_role = 'shared'
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
      where i.in_period
      union all
      select
        e.currency,
        0::bigint,
        case when e.pnl_role = 'project' then e.amount_net else 0::bigint end,
        case when e.pnl_role = 'shared' then e.amount_net else 0::bigint end,
        case when e.pnl_role = 'overhead' then e.amount_net else 0::bigint end,
        e.amount_net
      from expense_all e
      where e.in_period
    ) parts
    group by parts.currency
  ),
  currency_line_counts as (
    select
      coalesce(t.currency, 'ILS') as currency,
      count(*)::integer as line_count
    from public.transactions t
    where t.company_id = p_company_id
      and t.removed_at is null
      and t.line_status = 'posted'
      and (
        (
          t.direction = 'income'
          and (
            (basis = 'cash' and t.doc_kind in ('receipt', 'invoice_receipt'))
            or (basis = 'invoiced' and t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          )
          and (
            (select dfrom from bounds) is null
            or (basis = 'cash' and coalesce(t.cash_date, t.doc_date) between (select dfrom from bounds) and (select dto from bounds))
            or (basis = 'invoiced' and t.doc_date between (select dfrom from bounds) and (select dto from bounds))
          )
        )
        or (
          t.direction = 'expense'
          and (
            (select dfrom from bounds) is null
            or t.doc_date between (select dfrom from bounds) and (select dto from bounds)
          )
        )
      )
    group by coalesce(t.currency, 'ILS')
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
      where i.in_period
      union all
      select e.project_id, e.currency, 0::bigint, e.amount_net, 0::bigint
      from expense_all e
      where e.in_period and e.pnl_role = 'project' and e.project_id is not null
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
      coalesce((select sum(i.amount_net) from income i where i.project_id = p.id and i.in_period), 0) as income_net,
      coalesce((select sum(e.amount_net) from expense e where e.project_id = p.id and e.pnl_role = 'project' and e.in_period), 0) as direct_net,
      coalesce((select sum(s.amount_net) from shared_alloc s where s.project_id = p.id and s.in_period), 0) as shared_net
    from public.projects p
    where p.company_id = p_company_id
  )
  select jsonb_build_object(
    'company_id', c.id,
    'name', c.name,
    'vat_registered', c.vat_registered,
    'basis', basis,
    'from', p_from,
    'to', p_to,
    'income_agorot', coalesce((select sum(amount_net) from income where in_period), 0),
    'direct_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'project' and in_period), 0),
    'shared_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'shared' and in_period), 0),
    'overhead_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'overhead' and in_period), 0),
    'expense_agorot', -coalesce((select sum(amount_net) from expense where in_period), 0),
    'net_profit_agorot',
      coalesce((select sum(amount_net) from income where in_period), 0)
      + coalesce((select sum(amount_net) from expense where in_period), 0),
    'prev_income_agorot', case when p_from is null then null else coalesce((select sum(amount_net) from income where in_prev), 0) end,
    'prev_expense_agorot', case when p_from is null then null else -coalesce((select sum(amount_net) from expense where in_prev), 0) end,
    'prev_net_agorot', case when p_from is null then null else
      coalesce((select sum(amount_net) from income where in_prev), 0)
      + coalesce((select sum(amount_net) from expense where in_prev), 0)
    end,
    'active_projects', (select count(*) from public.projects p where p.company_id = c.id and p.status = 'active'),
    'review_count', (
      select count(*)
      from public.review_queue q
      left join public.transactions rt on rt.id = q.transaction_id
      where q.company_id = c.id
        and q.status = 'open'
        and (rt.id is null or rt.removed_at is null)
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
          t.currency,
          coalesce(sum(t.amount_net) filter (where t.direction = 'income'), 0)::bigint as income_minor,
          coalesce(sum(t.amount_net) filter (where t.direction = 'expense'), 0)::bigint as expense_minor,
          count(*)::integer as line_count
        from public.transactions t
        where t.company_id = p_company_id
          and t.removed_at is null
          and t.line_status = 'posted'
          and coalesce(t.currency, 'ILS') <> 'ILS'
          and (
            (
              t.direction = 'income'
              and (
                (basis = 'cash' and t.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              )
              and (
                (select dfrom from bounds) is null
                or (basis = 'cash' and coalesce(t.cash_date, t.doc_date) between (select dfrom from bounds) and (select dto from bounds))
                or (basis = 'invoiced' and t.doc_date between (select dfrom from bounds) and (select dto from bounds))
              )
            )
            or (
              t.direction = 'expense'
              and (
                (select dfrom from bounds) is null
                or t.doc_date between (select dfrom from bounds) and (select dto from bounds)
              )
            )
          )
        group by t.currency
      ) bucket
    ), '[]'::jsonb),
    'by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', cc.currency,
        'income_minor', cc.income_minor,
        'direct_minor', cc.direct_minor,
        'shared_minor', cc.shared_minor,
        'overhead_minor', cc.overhead_minor,
        'expense_minor', cc.expense_minor,
        'net_profit_minor', cc.net_profit_minor,
        'count', coalesce(lc.line_count, 0)
      ) order by cc.currency)
      from company_currency cc
      left join currency_line_counts lc on lc.currency = cc.currency
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
            ) order by pc.currency)
            from project_currency pc
            where pc.project_id = r.id
          ), '[]'::jsonb)
        )
        order by (abs(r.income_net) + abs(r.direct_net)) desc, r.name
      )
      from project_rows r
    ), '[]'::jsonb)
  )
  into result
  from public.companies c
  where c.id = p_company_id;

  return result;
end;
$$;

commit;
