-- FLOW-128. Unpaid supplier invoices on the cash basis (decision 0118).
-- A supplier invoice or credit note with no payment yet (an expense line of kind invoice or
-- credit with no cash date) stays out of the cash basis, as 0007 intends. On the invoiced
-- basis it still counts by its document date (0101). Every other expense keeps its date.
-- pnl_lines gains an `unpaid` column; company_pnl, get_project, breakdown_rows and get_home
-- read the view through a subquery that drops unpaid lines unless the basis is invoiced.
-- They are otherwise as in 20261007180040_reversals.sql, 20261007223000_kept_out_guesses.sql
-- and 20261007203000_flow_breakdown.sql. overhead_share weights by invoiced income and reads
-- overhead cost on every basis; it is unchanged.

begin;

-- The view takes a short lock. Give up after five seconds rather than queue every read.
set local lock_timeout = '5s';

-- An expense document with no payment behind it yet. Bank and manual expense lines carry a
-- cash date, so only supplier invoices and credit notes waiting for a payment match.
create or replace function private.line_unpaid(
  p_direction public.txn_direction,
  p_doc_kind public.doc_kind,
  p_cash_date date
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_direction = 'expense'
    and p_doc_kind in ('invoice', 'credit')
    and p_cash_date is null;
$$;

revoke all on function private.line_unpaid(public.txn_direction, public.doc_kind, date) from public, anon;
grant execute on function private.line_unpaid(public.txn_direction, public.doc_kind, date) to authenticated, service_role;

-- pnl_lines: as before, plus `unpaid` at the end.
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
),
lsplit as (
  select
    s.transaction_id,
    count(*) as parts,
    sum(s.amount_minor) as parts_minor
  from public.line_splits s
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
  -- By parts: a loan line, so its parts decide and the override does not apply.
  private.line_in_pnl(null, c.excluded_from_pnl, c.loan_part) as in_pnl,
  false as loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income' then t.project_id is null
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations a where a.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind,
  private.line_unpaid(t.direction, t.doc_kind, t.cash_date) as unpaid
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
  coalesce(s.project_id, t.project_id) as project_id,
  case
    when coalesce(c.kind::text, t.direction::text) = 'expense' and s.project_id is not null
      and s.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    when coalesce(c.kind::text, t.direction::text) = 'expense' and s.project_id is not null
      then 'project'::public.pnl_role
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
  null::public.loan_split_part as part,
  case when t.direction = 'expense' then -s.amount_minor else s.amount_minor end as amount_net,
  t.amount_net as line_amount_net,
  private.line_in_pnl(t.in_pnl_override, c.excluded_from_pnl, c.loan_part) as in_pnl,
  false as loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income' then coalesce(s.project_id, t.project_id) is null
    when s.project_id is not null then false
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations a where a.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind,
  private.line_unpaid(t.direction, t.doc_kind, t.cash_date) as unpaid
from public.transactions t
join lsplit lp on lp.transaction_id = t.id and lp.parts >= 2
  and lp.parts_minor = abs(t.amount_net)
join public.line_splits s on s.transaction_id = t.id
left join public.categories c on c.id = s.category_id
left join public.companies co on co.id = t.company_id
where t.removed_at is null
  and t.line_status = 'posted'
  and not exists (select 1 from public.loan_splits ls where ls.transaction_id = t.id)
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
  -- A line with a loan split stays fixed, even when it falls back to its own category.
  private.line_in_pnl(
    case when sp.transaction_id is null then t.in_pnl_override end,
    private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
    c.loan_part
  ) as in_pnl,
  sp.transaction_id is not null as loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income' then t.project_id is null
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations a where a.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind,
  private.line_unpaid(t.direction, t.doc_kind, t.cash_date) as unpaid
from public.transactions t
left join public.categories c on c.id = t.category_id
left join public.companies co on co.id = t.company_id
left join split sp on sp.transaction_id = t.id
left join lsplit lp on lp.transaction_id = t.id
where t.removed_at is null
  and t.line_status = 'posted'
  and (
    sp.transaction_id is null or sp.parts <> 3 or sp.flagged or t.vat_amount <> 0
    or sp.parts_minor <> abs(t.amount_net)
  )
  and (
    sp.transaction_id is not null or lp.transaction_id is null or lp.parts < 2
    or lp.parts_minor <> abs(t.amount_net)
  );


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
    from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
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
    from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
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
    from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
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
    from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
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
    from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
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
        from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
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
      select sum(l.amount_net) from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
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
      select sum(l.amount_net) from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
      where l.project_id = p.id and l.kind = 'expense' and l.pnl_role = 'project'
        and l.in_pnl
        and l.currency = 'ILS'
    ), 0),
    'shared_agorot', -coalesce((
      select sum(coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0))
      from public.allocations a
      join (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l on l.transaction_id = a.transaction_id
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
          from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
          where l.project_id = p.id
            and l.in_pnl
          union all
          select l.currency as currency,
            0::bigint,
            0::bigint,
            -coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0) as shared_minor
          from public.allocations a
          join (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l on l.transaction_id = a.transaction_id
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
        join public.transactions lt on lt.id = e.transaction_id
        where (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
          and private.line_in_pnl(
          case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
            then lt.in_pnl_override end,
          cat.excluded_from_pnl, cat.loan_part
        )
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
        join public.transactions lt on lt.id = e.transaction_id
        where (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
          and private.line_in_pnl(
          case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
            then lt.in_pnl_override end,
          cat.excluded_from_pnl, cat.loan_part
        )
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
        left join public.categories cat on cat.id = e.category_id
        join public.transactions lt on lt.id = e.transaction_id
        where (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
          and not private.line_in_pnl(
          case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
            then lt.in_pnl_override end,
          cat.excluded_from_pnl, cat.loan_part
        )
        group by e.currency, e.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
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
        from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
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
          sum(parts.line_count)::integer as line_count
        from (
          select
            l.currency,
            case when l.kind = 'income' then l.amount_net else 0 end as income_minor,
            case when l.kind = 'expense' then l.amount_net else 0 end as expense_minor,
            1 as line_count
          from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
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
          join (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l on l.transaction_id = a.transaction_id
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
      ) order by t.doc_date desc, t.created_at desc, t.id desc)
      from (
        select * from public.transactions t
        where t.company_id = cid
          and t.removed_at is null
          and (t.project_id = p.id or exists (
            select 1 from public.allocations a
            where a.transaction_id = t.id and a.project_id = p.id
          ))
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
  select s.available, s.share_agorot into available, share
  from private.overhead_share(p_id) s;
  return result || jsonb_build_object(
    'profit_agorot', profit,
    'overhead_share_agorot', case when coalesce(available, false) then coalesce(share, 0) else null end,
    'overhead_weighted', coalesce(available, false),
    'profit_after_overhead_agorot', profit - case when coalesce(available, false) then coalesce(share, 0) else 0 end,
    -- FLOW-105: the loans filed under this project. Nothing above reads them.
    'loans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'name', l.name,
        'currency', l.currency,
        'balance_minor', b.balance_minor
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
$$;

create or replace function private.breakdown_rows(
  p_company_id uuid,
  p_direction text,
  p_from date,
  p_to date,
  p_basis text,
  p_group_by text
)
returns table (
  transaction_id uuid,
  part public.loan_split_part,
  currency text,
  group_key text,
  group_name text,
  amount_minor bigint,
  in_pnl boolean,
  shared boolean,
  doc_date date,
  category_id uuid,
  project_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  with lines as (
    select
      l.transaction_id,
      l.part,
      l.currency,
      l.project_id,
      l.pnl_role,
      l.category_id,
      l.amount_net,
      l.line_amount_net,
      l.in_pnl,
      l.unassigned,
      l.doc_date,
      t.supplier_id
    from (select * from private.pnl_lines u where p_basis = 'invoiced' or not u.unpaid) l
    join public.transactions t on t.id = l.transaction_id
    where l.company_id = p_company_id
      and l.kind = p_direction
      and (
        p_direction = 'expense'
        or l.direction::text = 'expense'
        or (p_basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or (p_basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
      and (
        p_from is null or p_to is null
        or (
          case
            when p_direction = 'income' and p_basis = 'cash' then coalesce(l.cash_date, l.doc_date)
            else l.doc_date
          end
        ) between p_from and p_to
      )
  ),
  signed as (
    select
      x.*,
      (case when p_direction = 'expense' then -x.amount_net else x.amount_net end)::bigint as amount_minor
    from lines x
  )
  -- By category or by supplier/customer: one row per line or part.
  select
    s.transaction_id, s.part, s.currency,
    coalesce(s.category_id::text, 'none'),
    c.name,
    s.amount_minor, s.in_pnl, false, s.doc_date, s.category_id, s.project_id
  from signed s
  left join public.categories c on c.id = s.category_id
  where p_group_by = 'category'
  union all
  select
    s.transaction_id, s.part, s.currency,
    coalesce(s.supplier_id::text, 'none'),
    sup.name,
    s.amount_minor, s.in_pnl, false, s.doc_date, s.category_id, s.project_id
  from signed s
  left join public.suppliers sup on sup.id = s.supplier_id
  where p_group_by = 'payer'
  union all
  -- By project: income by its project; cost by its role. A shared line splits by its
  -- allocations, rounded half to even per part like company_pnl.
  select
    s.transaction_id, s.part, s.currency,
    case
      when s.unassigned then 'unassigned'
      when p_direction = 'expense' and s.pnl_role = 'overhead' then 'overhead'
      else s.project_id::text
    end,
    case
      when s.unassigned or (p_direction = 'expense' and s.pnl_role = 'overhead') then null
      else p.name
    end,
    s.amount_minor, s.in_pnl, false, s.doc_date, s.category_id, s.project_id
  from signed s
  left join public.projects p on p.id = s.project_id
  where p_group_by = 'project'
    and not (p_direction = 'expense' and s.pnl_role = 'shared' and not s.unassigned)
  union all
  select
    s.transaction_id, s.part, s.currency,
    a.project_id::text,
    p.name,
    (-coalesce(private.div_half_even(a.amount_net::numeric * s.amount_net, s.line_amount_net), 0))::bigint,
    s.in_pnl, true, s.doc_date, s.category_id, a.project_id
  from signed s
  join public.allocations a on a.transaction_id = s.transaction_id
  left join public.projects p on p.id = a.project_id
  where p_group_by = 'project'
    and p_direction = 'expense'
    and s.pnl_role = 'shared'
    and not s.unassigned;
$$;

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
          from (select * from private.pnl_lines u where not u.unpaid) l
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
            from (select * from private.pnl_lines u where not u.unpaid) l
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

commit;
