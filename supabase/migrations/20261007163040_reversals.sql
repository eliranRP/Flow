-- FLOW-104. A reversal is an outflow under an income category (negative income)
-- or an inflow under an expense category (negative expense). Decision 0103.
-- The category kind decides the P&L side. t.direction and the signed amount_net stay as stored.

begin;

create or replace view private.pnl_lines
with (security_invoker = true) as
with split as (
  select
    s.transaction_id,
    count(*) as parts,
    sum(s.amount_minor) as parts_minor,
    bool_or(s.needs_review) as flagged
  from public.loan_splits s
  group by s.transaction_id
)
select
  t.company_id,
  t.id as transaction_id,
  t.project_id,
  case
    when coalesce(c.kind::text, t.direction::text) = 'expense' and t.pnl_role = 'project' and t.project_id is not null
      and t.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    else t.pnl_role
  end as pnl_role,
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
  false as loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income' then t.project_id is null
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations a where a.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind
from public.transactions t
join split sp on sp.transaction_id = t.id and sp.parts = 3 and not sp.flagged
  and sp.parts_minor = abs(t.amount_net)
join public.loan_splits s on s.transaction_id = t.id
left join public.categories c on c.id = s.category_id
left join public.companies co on co.id = t.company_id
where t.removed_at is null
  and t.line_status = 'posted'
  and t.vat_amount = 0
union all
select
  t.company_id,
  t.id as transaction_id,
  t.project_id,
  case
    when coalesce(c.kind::text, t.direction::text) = 'expense' and t.pnl_role = 'project' and t.project_id is not null
      and t.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    else t.pnl_role
  end as pnl_role,
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
  sp.transaction_id is not null as loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income' then t.project_id is null
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations a where a.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind
from public.transactions t
left join public.categories c on c.id = t.category_id
left join public.companies co on co.id = t.company_id
left join split sp on sp.transaction_id = t.id
where t.removed_at is null
  and t.line_status = 'posted'
  and (
    sp.transaction_id is null or sp.parts <> 3 or sp.flagged or t.vat_amount <> 0
    or sp.parts_minor <> abs(t.amount_net)
  );


-- company_pnl: income and expense follow the category kind. A reversal income line (an outflow)
-- counts on both bases by cash date or document date, whatever its document kind.

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
      and l.kind = 'income'
      and (
        l.direction = 'expense'
        or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
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
      l.unassigned,
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
      and l.kind = 'expense'
  ),
  shared_alloc as (
    select
      a.project_id,
      coalesce(private.div_half_even(a.amount_net::numeric * e.amount_net, e.line_amount_net), 0) as amount_net,
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
      l.unassigned,
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
      and l.kind = 'income'
      and (
        l.direction = 'expense'
        or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
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
      l.unassigned,
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
      and l.kind = 'expense'
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
    from private.pnl_lines l
    where l.company_id = p_company_id
      and l.in_pnl
      and (
        (
          l.kind = 'income'
          and (
            l.direction = 'expense'
            or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
            or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          )
          and (
            (select dfrom from bounds) is null
            or (basis = 'cash' and coalesce(l.cash_date, l.doc_date) between (select dfrom from bounds) and (select dto from bounds))
            or (basis = 'invoiced' and l.doc_date between (select dfrom from bounds) and (select dto from bounds))
          )
        )
        or (
          l.kind = 'expense'
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
          coalesce(sum(l.amount_net) filter (where l.kind = 'income'), 0)::bigint as income_minor,
          coalesce(sum(l.amount_net) filter (where l.kind = 'expense'), 0)::bigint as expense_minor,
          count(distinct l.transaction_id)::integer as line_count
        from private.pnl_lines l
        where l.company_id = p_company_id
          and l.in_pnl
          and l.currency <> 'ILS'
          and (
            (
              l.kind = 'income'
              and (
                l.direction = 'expense'
                or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              )
              and (
                (select dfrom from bounds) is null
                or (basis = 'cash' and coalesce(l.cash_date, l.doc_date) between (select dfrom from bounds) and (select dto from bounds))
                or (basis = 'invoiced' and l.doc_date between (select dfrom from bounds) and (select dto from bounds))
              )
            )
            or (
              l.kind = 'expense'
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
        'loan_split_fallback_count', coalesce(fb.fallback_count, 0),
        'unassigned_income_minor', coalesce(un.unassigned_income_minor, 0),
        'unassigned_expense_minor', coalesce(un.unassigned_expense_minor, 0)
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
      left join unassigned_by_currency un on un.currency = k.currency
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

-- The category drill-down follows the category kind too.

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
    and l.kind = 'expense'
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
      else coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
    end,
    t.created_at, true, l.currency
  from public.allocations a
  join private.pnl_lines l on l.transaction_id = a.transaction_id
  join public.transactions t on t.id = l.transaction_id
  where a.project_id = p_project
    and l.company_id = (select private.current_company_id())
    and l.kind = 'expense'
    and l.pnl_role = 'shared'
    and not t.category_suggested
    and l.category_id is not null;
$$;

-- get_project.

create or replace function public.get_project(p_id uuid, p_basis text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  basis text;
  result jsonb;
  profit bigint;
  available boolean;
  share bigint;
  waiting jsonb;
begin
  select c.id into cid
    from public.companies c
    where c.owner_id = (select auth.uid());
  if cid is null then
    return null;
  end if;
  basis := case when p_basis = 'invoiced' then 'invoiced' else 'cash' end;

  waiting := public.project_waiting(p_id);

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
      select sum(l.amount_net) from private.pnl_lines l
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
      select sum(l.amount_net) from private.pnl_lines l
      where l.project_id = p.id and l.kind = 'expense' and l.pnl_role = 'project'
        and l.in_pnl
        and l.currency = 'ILS'
    ), 0),
    'shared_agorot', -coalesce((
      select sum(coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0))
      from public.allocations a
      join private.pnl_lines l on l.transaction_id = a.transaction_id
      where a.project_id = p.id and l.kind = 'expense' and l.pnl_role = 'shared' and l.in_pnl
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
          from private.pnl_lines l
          where l.project_id = p.id
            and l.in_pnl
          union all
          select l.currency as currency,
            0::bigint,
            0::bigint,
            -coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0) as shared_minor
          from public.allocations a
          join private.pnl_lines l on l.transaction_id = a.transaction_id
          where a.project_id = p.id
            and l.kind = 'expense' and l.pnl_role = 'shared'
            and l.in_pnl
        ) parts
        group by parts.currency
      ) b
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'amount_agorot', s.amount,
        'has_shared_share', s.shared
      ) order by s.amount desc, c.name)
      from (
        select e.category_id,
          (-sum(e.amount_net))::bigint as amount,
          bool_or(e.shared) as shared
        from private.project_category_entries(p.id) e
        left join public.categories cat on cat.id = e.category_id
        where not coalesce(cat.excluded_from_pnl, false)
        group by e.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'categories_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', s.currency,
        'id', c.id,
        'name', c.name,
        'amount_minor', s.amount,
        'has_shared_share', s.shared
      ) order by s.currency, s.amount desc, c.name)
      from (
        select e.currency,
          e.category_id,
          (-sum(e.amount_net))::bigint as amount,
          bool_or(e.shared) as shared
        from private.project_category_entries_by_currency(p.id) e
        left join public.categories cat on cat.id = e.category_id
        where not coalesce(cat.excluded_from_pnl, false)
        group by e.currency, e.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'excluded_categories_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', s.currency,
        'id', c.id,
        'name', c.name,
        'amount_minor', s.amount,
        'has_shared_share', s.shared
      ) order by s.currency, s.amount desc, c.name)
      from (
        select e.currency,
          e.category_id,
          (-sum(e.amount_net))::bigint as amount,
          bool_or(e.shared) as shared
        from private.project_category_entries_by_currency(p.id) e
        join public.categories cat on cat.id = e.category_id
        where cat.excluded_from_pnl
        group by e.currency, e.category_id
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
          sum(parts.line_count)::integer as line_count
        from (
          select
            l.currency,
            case when l.kind = 'income' then l.amount_net else 0 end as income_minor,
            case when l.kind = 'expense' then l.amount_net else 0 end as expense_minor,
            1 as line_count
          from private.pnl_lines l
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
          select l.currency, 0, coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0), 1
          from public.allocations a
          join private.pnl_lines l on l.transaction_id = a.transaction_id
          where a.project_id = p.id
            and l.kind = 'expense' and l.pnl_role = 'shared'
            and l.in_pnl
            and l.currency <> 'ILS'
            and l.project_id is distinct from p.id
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
        'category', c.name
      ) order by t.doc_date desc, t.created_at desc)
      from (
        select * from public.transactions t
        where t.company_id = cid
          and t.removed_at is null
          and (t.project_id = p.id or exists (
            select 1 from public.allocations a
            where a.transaction_id = t.id and a.project_id = p.id
          ))
        order by t.doc_date desc, t.created_at desc
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
  select s.available, s.share_agorot into available, share
  from private.overhead_share(p_id) s;
  return result || jsonb_build_object(
    'profit_agorot', profit,
    'overhead_share_agorot', case when coalesce(available, false) then coalesce(share, 0) else null end,
    'overhead_weighted', coalesce(available, false),
    'profit_after_overhead_agorot', profit - case when coalesce(available, false) then coalesce(share, 0) else 0 end
  );
end;
$$;

-- get_home and the overhead weights.
create or replace function public.get_home()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'company_id', c.id,
        'name', c.name,
        'net_profit_agorot', coalesce((
          select sum(
            case
              when l.kind = 'income' and (l.direction = 'expense' or l.doc_kind in ('receipt', 'invoice_receipt')) then l.amount_net
              when l.kind = 'expense' then l.amount_net
              else 0
            end
          )::bigint
          from private.pnl_lines l
          where l.company_id = c.id
            and l.in_pnl
            and l.currency = 'ILS'
        ), 0),
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
              coalesce(sum(l.amount_net) filter (
                where l.kind = 'income' and (l.direction = 'expense' or l.doc_kind in ('receipt', 'invoice_receipt'))
              ), 0)::bigint as income_minor,
              coalesce(sum(l.amount_net) filter (where l.kind = 'expense'), 0)::bigint as expense_minor,
              count(*) filter (
                where (l.kind = 'income' and (l.direction = 'expense' or l.doc_kind in ('receipt', 'invoice_receipt')))
                  or l.kind = 'expense'
              )::integer as line_count
            from private.pnl_lines l
            where l.company_id = c.id
              and l.in_pnl
              and l.currency <> 'ILS'
            group by l.currency
          ) bucket
          where bucket.line_count > 0
        ), '[]'::jsonb),
        'is_demo', c.is_demo
      )
      from public.companies c
      where c.id = (select private.readable_company_id())
    ),
    jsonb_build_object(
      'company_id', null,
      'name', null,
      'net_profit_agorot', 0,
      'other_currencies', '[]'::jsonb,
      'is_demo', false
    )
  );
$$;

create or replace function private.overhead_share(p_project uuid)
returns table (available boolean, share_agorot bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with cid as (
    select private.current_company_id() as id
  ),
  totals as (
    select
      coalesce((
        select sum(l.amount_net)::bigint
        from private.pnl_lines l
        where l.company_id = (select id from cid)
          and l.currency = 'ILS'
          and l.in_pnl
          and l.kind = 'income'
          and (l.direction = 'expense' or l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          and l.project_id is not null
      ), 0) as total_income,
      coalesce((
        select -sum(l.amount_net)::bigint
        from private.pnl_lines l
        where l.company_id = (select id from cid)
          and l.currency = 'ILS'
          and l.in_pnl
          and l.kind = 'expense' and l.pnl_role = 'overhead'
      ), 0) as overhead_cost
  ),
  rounded as (
    select
      p.id as project_id,
      p.name as project_name,
      s.income,
      (select overhead_cost from totals)::numeric * s.income / (select total_income from totals) as exact,
      private.round_agorot_shekel_hundreds(
        (select overhead_cost from totals)::numeric * s.income / (select total_income from totals)
      ) as rounded
    from public.projects p
    join (
      select l.project_id, sum(l.amount_net)::bigint as income
      from private.pnl_lines l
      where l.company_id = (select id from cid)
        and l.currency = 'ILS'
          and l.in_pnl
        and l.kind = 'income'
        and (l.direction = 'expense' or l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
        and l.project_id is not null
      group by l.project_id
      having sum(l.amount_net) > 0
    ) s on s.project_id = p.id
    where p.company_id = (select id from cid)
      and (select id from cid) is not null
      and (select total_income from totals) <> 0
  ),
  chosen as (
    select r.project_id
    from rounded r
    order by
      case when (select max(x.exact - x.rounded) from rounded x) > 0 then (r.exact - r.rounded) end desc nulls last,
      case when (select max(x.exact - x.rounded) from rounded x) <= 0 then r.income end desc nulls last,
      r.project_name asc
    limit 1
  ),
  adjusted as (
    select
      r.project_id,
      r.rounded + case
        when r.project_id = (select c.project_id from chosen c)
          then (select overhead_cost from totals) - (select coalesce(sum(x.rounded), 0) from rounded x)
        else 0
      end as share
    from rounded r
  )
  select
    (select id from cid) is not null and (select total_income from totals) <> 0,
    case
      when (select id from cid) is null or (select total_income from totals) = 0 then null::bigint
      else coalesce((select a.share from adjusted a where a.project_id = p_project), 0)
    end;
$$;

-- resolve_review: the category kind decides the role. The kind may differ from the direction.
create or replace function public.resolve_review(
  p_id uuid,
  p_action text,
  p_project_id uuid default null,
  p_category_id uuid default null,
  p_remember boolean default true,
  p_resolve boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  txn uuid;
  next_status public.review_status;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_shares jsonb;
  prior_remembered uuid;
  written uuid;
  supplier uuid;
  net bigint;
  direction public.txn_direction;
  kind public.doc_kind;
  gross bigint;
  doc_date date;
  description text;
  external_id text;
  reason text;
  cat_kind text;
  eff_kind text;
  share_count integer;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_action not in ('approved', 'skipped', 'changed') then
    raise exception 'unknown review action';
  end if;
  next_status := p_action::public.review_status;
  select q.transaction_id, q.reason into txn, reason
  from public.review_queue q
  where q.id = p_id and q.company_id = cid and q.status = 'open';
  if txn is null then
    raise exception 'review item not found';
  end if;

  select t.project_id, t.category_id, t.pnl_role, t.user_assigned, t.category_suggested, t.supplier_id, t.amount_net,
         t.direction, t.doc_kind, t.amount_gross, t.doc_date, t.description, t.external_id
  into prior_project, prior_category, prior_role, prior_assigned, prior_suggested, supplier, net,
       direction, kind, gross, doc_date, description, external_id
  from public.transactions t
  where t.id = txn and t.company_id = cid
  for update;

  select count(*)::integer into share_count
  from public.allocations a
  where a.transaction_id = txn;

  if not p_resolve then
    if p_action is distinct from 'changed' then
      raise exception 'unknown review action';
    end if;
    if direction is null then
      raise exception 'review item not found';
    end if;
    if p_category_id is null and p_project_id is null then
      raise exception 'project or category is required';
    end if;
    if reason = 'unallocated_shared'
      or (direction is distinct from 'income' and p_project_id is not null) then
      perform private.guard_review_assignment(
        cid,
        txn,
        reason,
        prior_role,
        share_count,
        direction is distinct from 'income' and p_project_id is not null
      );
    end if;
    if p_category_id is not null then
      select c.kind::text into cat_kind
      from public.categories c
      where c.id = p_category_id and c.company_id = cid;
      if cat_kind is null then
        raise exception 'project or category not found';
      end if;
      -- The category is the owner's, including a pick of the suggested id.
      -- user_assigned stays, so a project guess remains.
      update public.transactions
      set category_id = p_category_id,
          category_assigned = true,
          category_suggested = false
      where id = txn and company_id = cid;
    end if;
    if p_project_id is not null then
      if not exists (
        select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
      ) then
        raise exception 'project or category not found';
      end if;
      -- The category kind decides the role: the given category, else the line's own.
      eff_kind := cat_kind;
      if eff_kind is null and prior_category is not null then
        select c.kind::text into eff_kind
        from public.categories c
        where c.id = prior_category and c.company_id = cid;
      end if;
      eff_kind := coalesce(eff_kind, direction::text);
      if eff_kind = 'income' then
        update public.transactions
        set project_id = p_project_id,
            project_assigned = true,
            pnl_role = null
        where id = txn and company_id = cid;
      else
        update public.transactions
        set project_id = p_project_id,
            project_assigned = true,
            pnl_role = 'project'
        where id = txn and company_id = cid;
        delete from public.allocations where transaction_id = txn and company_id = cid;
        insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
        values (cid, txn, p_project_id, 10000, net);
      end if;
    end if;
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  )), '[]'::jsonb)
  into prior_shares
  from public.allocations a
  where a.transaction_id = txn;

  prior_remembered := null;
  if supplier is not null then
    select s.remembered_category_id into prior_remembered
    from public.suppliers s
    where s.id = supplier and s.company_id = cid;
  end if;

  if next_status <> 'skipped' then
    perform private.guard_review_assignment(
      cid,
      txn,
      reason,
      prior_role,
      share_count,
      direction is distinct from 'income'
    );
  end if;

  written := null;
  if next_status <> 'skipped' then
    if p_category_id is null then
      raise exception 'category is required';
    end if;
    select c.kind::text into cat_kind
    from public.categories c
    where c.id = p_category_id and c.company_id = cid;
    if cat_kind is null then
      raise exception 'project or category not found';
    end if;

    delete from public.allocations where transaction_id = txn and company_id = cid;

    if cat_kind = 'income' then
      if not coalesce((
        select c.excluded_from_pnl
        from public.categories c
        where c.id = p_category_id and c.company_id = cid
      ), false) and p_project_id is null then
        raise exception 'project and category are required';
      end if;
      if p_project_id is not null and not exists (
        select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
      ) then
        raise exception 'project or category not found';
      end if;
      update public.transactions
      set project_id = p_project_id,
          category_id = p_category_id,
          pnl_role = null,
          user_assigned = true,
          project_assigned = p_project_id is not null
      where id = txn and company_id = cid;
    else
      if p_project_id is null then
        raise exception 'project and category are required';
      end if;
      if not exists (
        select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
      ) then
        raise exception 'project or category not found';
      end if;
      update public.transactions
      set project_id = p_project_id,
          category_id = p_category_id,
          pnl_role = 'project',
          user_assigned = true
      where id = txn and company_id = cid;
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      values (cid, txn, p_project_id, 10000, net);
      if coalesce(p_remember, true) and supplier is not null then
        update public.suppliers
        set remembered_category_id = p_category_id
        where id = supplier and company_id = cid;
        written := p_category_id;
      end if;
    end if;
  end if;

  update public.review_queue
  set status = next_status,
      resolved_at = now(),
      prior_project_id = prior_project,
      prior_category_id = prior_category,
      prior_pnl_role = prior_role,
      prior_user_assigned = prior_assigned,
      prior_category_suggested = prior_suggested,
      prior_allocations = prior_shares,
      prior_remembered_category_id = prior_remembered,
      written_remembered_category_id = written,
      doc_fingerprint = private.doc_fingerprint(direction::text, kind::text, gross, doc_date, description, external_id)
  where id = p_id and company_id = cid;
end;
$$;

-- reassign_transaction.
create or replace function public.reassign_transaction(
  p_id uuid,
  p_project_id uuid,
  p_category_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  direction public.txn_direction;
  net bigint;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_shares jsonb;
  cat_kind text;
  review_id uuid;
  undo_id uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select t.direction, t.amount_net, t.project_id, t.category_id, t.pnl_role, t.user_assigned, t.category_suggested
  into direction, net, prior_project, prior_category, prior_role, prior_assigned, prior_suggested
  from public.transactions t
  where t.id = p_id and t.company_id = cid and t.removed_at is null
  for update;
  if direction is null then
    raise exception 'transaction not found';
  end if;
  select c.kind::text into cat_kind
  from public.categories c
  where c.id = p_category_id and c.company_id = cid;
  if cat_kind is null then
    raise exception 'category not found';
  end if;
  if prior_role = 'shared' or exists (
    select 1
    from public.review_queue q
    where q.transaction_id = p_id
      and q.company_id = cid
      and q.status = 'open'
      and q.reason = 'unallocated_shared'
  ) then
    raise exception 'shared costs are split, not assigned to one project';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  )), '[]'::jsonb)
  into prior_shares
  from public.allocations a
  where a.transaction_id = p_id;

  select q.id into review_id
  from public.review_queue q
  where q.transaction_id = p_id and q.company_id = cid and q.status = 'open'
  order by q.created_at desc
  limit 1;

  delete from public.allocations where transaction_id = p_id and company_id = cid;
  delete from public.overhead where transaction_id = p_id and company_id = cid;

  if cat_kind = 'income' then
    if not coalesce((
      select c.excluded_from_pnl
      from public.categories c
      where c.id = p_category_id and c.company_id = cid
    ), false) and p_project_id is null then
      raise exception 'project and category are required';
    end if;
    if p_project_id is not null and not exists (
      select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
    ) then
      raise exception 'project not found';
    end if;
    update public.transactions
    set project_id = p_project_id,
        category_id = p_category_id,
        pnl_role = null,
        user_assigned = true,
        project_assigned = p_project_id is not null
    where id = p_id and company_id = cid;
  else
    if p_project_id is null or not exists (
      select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
    ) then
      raise exception 'project not found';
    end if;
    update public.transactions
    set project_id = p_project_id,
        category_id = p_category_id,
        pnl_role = 'project',
        user_assigned = true
    where id = p_id and company_id = cid;
    insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
    values (cid, p_id, p_project_id, 10000, net);
  end if;

  if review_id is not null then
    update public.review_queue
    set status = 'changed',
        resolved_at = now(),
        prior_project_id = prior_project,
        prior_category_id = prior_category,
        prior_pnl_role = prior_role,
        prior_user_assigned = prior_assigned,
        prior_category_suggested = prior_suggested,
        prior_allocations = prior_shares
    where id = review_id and company_id = cid;
  end if;

  insert into public.reassign_undo (
    company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
    prior_user_assigned, prior_category_suggested, prior_allocations, prior_review_id
  ) values (
    cid, p_id, prior_project, prior_category, prior_role,
    coalesce(prior_assigned, false), prior_suggested, prior_shares, review_id
  )
  returning id into undo_id;
  return undo_id;
end;
$$;

-- set_transaction_category.
create or replace function public.set_transaction_category(
  p_id uuid,
  p_category_id uuid,
  p_resolve boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  direction public.txn_direction;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_shares jsonb;
  cat_kind text;
  prior_review uuid;
  undo_id uuid;
  prior_kind text;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select t.direction, t.project_id, t.category_id, t.pnl_role, t.user_assigned, t.category_suggested
  into direction, prior_project, prior_category, prior_role, prior_assigned, prior_suggested
  from public.transactions t
  where t.id = p_id and t.company_id = cid and t.removed_at is null
  for update;
  if direction is null then
    raise exception 'transaction not found';
  end if;
  select c.kind::text into cat_kind
  from public.categories c
  where c.id = p_category_id and c.company_id = cid;
  if cat_kind is null then
    raise exception 'category not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  )), '[]'::jsonb)
  into prior_shares
  from public.allocations a
  where a.transaction_id = p_id;

  prior_review := null;
  if p_resolve then
    select q.id into prior_review
    from public.review_queue q
    where q.transaction_id = p_id
      and q.company_id = cid
      and q.status = 'open'
      and q.reason = 'missing_category'
    order by q.created_at desc
    limit 1;
  end if;

  update public.transactions
  set category_id = p_category_id,
      category_assigned = case when p_resolve then category_assigned else true end,
      category_suggested = case when p_resolve then category_suggested else false end,
      user_assigned = case when p_resolve then true else user_assigned end
  where id = p_id and company_id = cid;

  -- Role follows the category kind, as in reassign_transaction, when the kind changes
  -- on a line filed to one project. Shared and overhead lines keep their role.
  select coalesce((
    select c.kind::text from public.categories c
    where c.id = prior_category and c.company_id = cid
  ), direction::text) into prior_kind;
  if cat_kind is distinct from prior_kind then
    if cat_kind = 'income' and prior_role = 'project' then
      update public.transactions set pnl_role = null where id = p_id and company_id = cid;
      delete from public.allocations where transaction_id = p_id and company_id = cid;
    elsif cat_kind = 'expense' and prior_role is null and prior_project is not null then
      update public.transactions set pnl_role = 'project' where id = p_id and company_id = cid;
      delete from public.allocations where transaction_id = p_id and company_id = cid;
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      select cid, p_id, prior_project, 10000, t.amount_net
      from public.transactions t where t.id = p_id and t.company_id = cid;
    end if;
  end if;

  if prior_review is not null then
    update public.review_queue
    set status = 'changed',
        resolved_at = now(),
        prior_project_id = prior_project,
        prior_category_id = prior_category,
        prior_pnl_role = prior_role,
        prior_user_assigned = prior_assigned,
        prior_category_suggested = prior_suggested,
        prior_allocations = prior_shares
    where id = prior_review and company_id = cid;

    if prior_role = 'shared'
      and not exists (select 1 from public.allocations a where a.transaction_id = p_id)
    then
      insert into public.review_queue (company_id, transaction_id, status, reason)
      values (cid, p_id, 'open', 'unallocated_shared');
    end if;
  end if;

  insert into public.reassign_undo (
    company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
    prior_user_assigned, prior_category_suggested, prior_allocations, prior_review_id
  ) values (
    cid, p_id, prior_project, prior_category, prior_role,
    coalesce(prior_assigned, false), prior_suggested, prior_shares, prior_review
  )
  returning id into undo_id;
  return undo_id;
end;
$$;

-- approve_split_review: a split outflow may take an income category. A missing category is still refused.
create or replace function public.approve_split_review(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  txn uuid;
  reason text;
  item_status public.review_status;
  direction public.txn_direction;
  kind public.doc_kind;
  role public.pnl_role;
  category uuid;
  project uuid;
  assigned boolean;
  suggested boolean;
  supplier uuid;
  net bigint;
  gross bigint;
  doc_date date;
  description text;
  external_id text;
  shares jsonb;
  share_count integer;
  prior_remembered uuid;
  cat_kind text;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;

  select q.transaction_id
  into txn
  from public.review_queue q
  where q.id = p_id and q.company_id = cid;
  if txn is null then
    raise exception 'review item not found';
  end if;

  select t.direction, t.doc_kind, t.pnl_role, t.category_id, t.project_id, t.user_assigned,
         t.category_suggested, t.supplier_id, t.amount_net, t.amount_gross, t.doc_date,
         t.description, t.external_id
  into direction, kind, role, category, project, assigned, suggested, supplier, net, gross,
       doc_date, description, external_id
  from public.transactions t
  where t.id = txn and t.company_id = cid and t.removed_at is null
  for update;
  if direction is null then
    raise exception 'review item not found';
  end if;

  select q.reason, q.status
  into reason, item_status
  from public.review_queue q
  where q.id = p_id and q.company_id = cid
  for update;
  if item_status is distinct from 'open' then
    raise exception 'review item not found';
  end if;
  if direction = 'income' then
    raise exception 'income is not split';
  end if;
  if reason = 'unallocated_shared' then
    raise exception 'shared costs are split, not assigned to one project';
  end if;

  select count(*)::integer into share_count
  from public.allocations a
  where a.transaction_id = txn;
  if role is distinct from 'shared' and share_count <= 1 then
    raise exception 'transaction is not split';
  end if;
  if category is null then
    raise exception 'category is required';
  end if;
  select c.kind::text into cat_kind
  from public.categories c
  where c.id = category and c.company_id = cid;
  if cat_kind is null then
    raise exception 'category kind must match the direction';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  ) order by a.project_id), '[]'::jsonb)
  into shares
  from public.allocations a
  where a.transaction_id = txn;

  prior_remembered := null;
  if supplier is not null then
    select s.remembered_category_id into prior_remembered
    from public.suppliers s
    where s.id = supplier and s.company_id = cid;
  end if;

  update public.review_queue q
  set status = 'approved',
      resolved_at = now(),
      prior_project_id = project,
      prior_category_id = category,
      prior_pnl_role = role,
      prior_user_assigned = assigned,
      prior_category_suggested = suggested,
      prior_allocations = shares,
      prior_remembered_category_id = prior_remembered,
      written_remembered_category_id = null,
      doc_fingerprint = private.doc_fingerprint(direction::text, kind::text, gross, doc_date, description, external_id)
  where q.id = p_id
    and q.company_id = cid
    and q.status = 'open'
    and exists (
      select 1
      from public.transactions t
      where t.id = q.transaction_id
        and t.company_id = q.company_id
        and t.removed_at is null
    );
  if not found then
    raise exception 'review item not found';
  end if;
end;
$$;

commit;
