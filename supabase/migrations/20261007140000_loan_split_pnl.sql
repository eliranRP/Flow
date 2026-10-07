-- FLOW-101. A loan payment counts by its split parts in every P&L read. Decision 0100.

begin;

create or replace view private.pnl_lines
with (security_invoker = true) as
with split as (
  select
    s.transaction_id,
    count(*) as parts,
    bool_or(s.needs_review) as flagged
  from public.loan_splits s
  group by s.transaction_id
)
select
  t.company_id,
  t.id as transaction_id,
  t.project_id,
  t.pnl_role,
  t.direction,
  t.doc_kind,
  t.doc_date,
  t.cash_date,
  coalesce(t.currency, 'ILS') as currency,
  s.category_id,
  s.part,
  case when t.direction = 'expense' then -s.amount_minor else s.amount_minor end as amount_net,
  t.amount_net as line_amount_net,
  not coalesce(c.excluded_from_pnl, false) as in_pnl,
  false as loan_split_fallback
from public.transactions t
join split sp on sp.transaction_id = t.id and sp.parts = 3 and not sp.flagged
join public.loan_splits s on s.transaction_id = t.id
left join public.categories c on c.id = s.category_id
where t.removed_at is null
  and t.line_status = 'posted'
  and t.vat_amount = 0
union all
select
  t.company_id,
  t.id as transaction_id,
  t.project_id,
  t.pnl_role,
  t.direction,
  t.doc_kind,
  t.doc_date,
  t.cash_date,
  coalesce(t.currency, 'ILS') as currency,
  t.category_id,
  null::public.loan_split_part as part,
  t.amount_net,
  t.amount_net as line_amount_net,
  not coalesce(c.excluded_from_pnl, false) as in_pnl,
  sp.transaction_id is not null as loan_split_fallback
from public.transactions t
left join public.categories c on c.id = t.category_id
left join split sp on sp.transaction_id = t.id
where t.removed_at is null
  and t.line_status = 'posted'
  and (sp.transaction_id is null or sp.parts <> 3 or sp.flagged or t.vat_amount <> 0);

revoke all on private.pnl_lines from public, anon;
grant select on private.pnl_lines to authenticated, service_role;

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
      l.project_id,
      l.amount_net,
      l.in_pnl,
      case
        when (select dfrom from bounds) is null then true
        when basis = 'cash' then coalesce(l.cash_date, l.doc_date) between (select dfrom from bounds) and (select dto from bounds)
        else l.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        when basis = 'cash' then coalesce(l.cash_date, l.doc_date) between (select pfrom from bounds) and (select pto from bounds)
        else l.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from private.pnl_lines l
    where l.company_id = p_company_id
      and l.currency = 'ILS'
      and l.direction = 'income'
      and (
        (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
  ),
  expense as (
    select
      l.transaction_id as id,
      l.project_id,
      l.pnl_role,
      l.amount_net,
      l.line_amount_net,
      l.in_pnl,
      l.doc_date,
      case
        when (select dfrom from bounds) is null then true
        else l.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        else l.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from private.pnl_lines l
    where l.company_id = p_company_id
      and l.currency = 'ILS'
      and l.direction = 'expense'
  ),
  shared_alloc as (
    select
      a.project_id,
      coalesce(a.amount_net * e.amount_net / nullif(e.line_amount_net, 0), 0)::bigint as amount_net,
      e.in_period,
      e.in_prev
    from public.allocations a
    join expense e on e.id = a.transaction_id
    where e.pnl_role = 'shared'
      and e.in_pnl
  ),
  income_all as (
    select
      l.project_id,
      l.currency,
      l.amount_net,
      l.in_pnl,
      case
        when (select dfrom from bounds) is null then true
        when basis = 'cash' then coalesce(l.cash_date, l.doc_date) between (select dfrom from bounds) and (select dto from bounds)
        else l.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        when basis = 'cash' then coalesce(l.cash_date, l.doc_date) between (select pfrom from bounds) and (select pto from bounds)
        else l.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from private.pnl_lines l
    where l.company_id = p_company_id
      and l.direction = 'income'
      and (
        (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
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
      l.doc_date,
      case
        when (select dfrom from bounds) is null then true
        else l.doc_date between (select dfrom from bounds) and (select dto from bounds)
      end as in_period,
      case
        when (select pfrom from bounds) is null then false
        else l.doc_date between (select pfrom from bounds) and (select pto from bounds)
      end as in_prev
    from private.pnl_lines l
    where l.company_id = p_company_id
      and l.direction = 'expense'
  ),
  shared_alloc_all as (
    select
      a.project_id,
      e.currency,
      coalesce(a.amount_net * e.amount_net / nullif(e.line_amount_net, 0), 0)::bigint as amount_net,
      e.in_period,
      e.in_prev
    from public.allocations a
    join expense_all e on e.id = a.transaction_id
    where e.pnl_role = 'shared'
      and e.in_pnl
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
        case when e.pnl_role = 'project' then e.amount_net else 0::bigint end,
        case when e.pnl_role = 'shared' then e.amount_net else 0::bigint end,
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
      count(*)::integer as line_count
    from private.pnl_lines l
    where l.company_id = p_company_id
      and l.in_pnl
      and (
        (
          l.direction = 'income'
          and (
            (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
            or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          )
          and (
            (select dfrom from bounds) is null
            or (basis = 'cash' and coalesce(l.cash_date, l.doc_date) between (select dfrom from bounds) and (select dto from bounds))
            or (basis = 'invoiced' and l.doc_date between (select dfrom from bounds) and (select dto from bounds))
          )
        )
        or (
          l.direction = 'expense'
          and (
            (select dfrom from bounds) is null
            or l.doc_date between (select dfrom from bounds) and (select dto from bounds)
          )
        )
      )
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
    'from', p_from,
    'to', p_to,
    'income_agorot', coalesce((select sum(amount_net) from income where in_period and in_pnl), 0),
    'direct_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'project' and in_period and in_pnl), 0),
    'shared_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'shared' and in_period and in_pnl), 0),
    'overhead_agorot', -coalesce((select sum(amount_net) from expense where pnl_role = 'overhead' and in_period and in_pnl), 0),
    'expense_agorot', -coalesce((select sum(amount_net) from expense where in_period and in_pnl), 0),
    'net_profit_agorot',
      coalesce((select sum(amount_net) from income where in_period and in_pnl), 0)
      + coalesce((select sum(amount_net) from expense where in_period and in_pnl), 0),
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
          l.currency,
          coalesce(sum(l.amount_net) filter (where l.direction = 'income'), 0)::bigint as income_minor,
          coalesce(sum(l.amount_net) filter (where l.direction = 'expense'), 0)::bigint as expense_minor,
          count(*)::integer as line_count
        from private.pnl_lines l
        where l.company_id = p_company_id
          and l.in_pnl
          and l.currency <> 'ILS'
          and (
            (
              l.direction = 'income'
              and (
                (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              )
              and (
                (select dfrom from bounds) is null
                or (basis = 'cash' and coalesce(l.cash_date, l.doc_date) between (select dfrom from bounds) and (select dto from bounds))
                or (basis = 'invoiced' and l.doc_date between (select dfrom from bounds) and (select dto from bounds))
              )
            )
            or (
              l.direction = 'expense'
              and (
                (select dfrom from bounds) is null
                or l.doc_date between (select dfrom from bounds) and (select dto from bounds)
              )
            )
          )
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
        'loan_split_fallback_count', coalesce(fb.fallback_count, 0)
      ) order by k.currency)
      from (
        select currency from company_currency
        union
        select currency from excluded_by_currency
      ) k
      left join company_currency cc on cc.currency = k.currency
      left join currency_line_counts lc on lc.currency = k.currency
      left join excluded_by_currency ex on ex.currency = k.currency
      left join fallback_by_currency fb on fb.currency = k.currency
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

revoke all on function public.company_pnl(uuid, date, date, text) from public, anon;
grant execute on function public.company_pnl(uuid, date, date, text) to authenticated, service_role;

-- The project category totals and the category drill-down read these two helpers.
-- They now read the view, so a split line shows under its part categories.
create or replace function private.project_category_entries_by_currency(p_project uuid)
returns table (
  category_id uuid,
  transaction_id uuid,
  description text,
  doc_date date,
  amount_net bigint,
  created_at timestamptz,
  shared boolean,
  currency text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.category_id, l.transaction_id, t.description, l.doc_date, l.amount_net, t.created_at, false, l.currency
  from private.pnl_lines l
  join public.transactions t on t.id = l.transaction_id
  where l.project_id = p_project
    and l.company_id = (select private.current_company_id())
    and l.direction = 'expense'
    and l.pnl_role = 'project'
    and not t.category_suggested
    and not exists (
      select 1
      from public.review_queue q
      where q.transaction_id = t.id
        and q.company_id = t.company_id
        and q.status = 'open'
    )
  union all
  select l.category_id, l.transaction_id, t.description, l.doc_date,
    case
      when l.part is null then a.amount_net
      else coalesce(a.amount_net * l.amount_net / nullif(l.line_amount_net, 0), 0)::bigint
    end,
    t.created_at, true, l.currency
  from public.allocations a
  join private.pnl_lines l on l.transaction_id = a.transaction_id
  join public.transactions t on t.id = l.transaction_id
  where a.project_id = p_project
    and l.company_id = (select private.current_company_id())
    and l.direction = 'expense'
    and l.pnl_role = 'shared'
    and not t.category_suggested
    and l.category_id is not null;
$$;

revoke all on function private.project_category_entries_by_currency(uuid) from public, anon;
grant execute on function private.project_category_entries_by_currency(uuid) to authenticated, service_role;

create or replace function private.project_category_entries(p_project uuid)
returns table (
  category_id uuid,
  transaction_id uuid,
  description text,
  doc_date date,
  amount_net bigint,
  created_at timestamptz,
  shared boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.category_id, e.transaction_id, e.description, e.doc_date, e.amount_net, e.created_at, e.shared
  from private.project_category_entries_by_currency(p_project) e
  where e.currency = 'ILS';
$$;

revoke all on function private.project_category_entries(uuid) from public, anon;
grant execute on function private.project_category_entries(uuid) to authenticated, service_role;

commit;
