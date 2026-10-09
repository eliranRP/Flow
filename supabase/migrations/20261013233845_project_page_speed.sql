-- Project page speed: get_project took 0.7 to 11 s live and hit the 8 s statement timeout.
-- Two costs grew with the company, not the project:
--   1. private.pnl_lines joined two whole-table split aggregates (CTEs). With a poor row
--      estimate the planner nested-looped them, so every line rescanned every split: lines
--      times splits. Each line now reads its own splits by index (lateral), same rows out.
--   2. get_project, private.project_category_entries_by_currency and private.project_investment
--      joined allocations to pnl_lines and scanned every line of the company to find the few
--      shared to this project. They now read only the lines filed, shared or split to it.
-- private.overhead_share_for reads the company's lines once instead of twice, and get_project
-- reuses the shekel share when the company's base currency is ILS.
-- Nothing a caller sees changes. Functions are as in their latest migrations otherwise.

create or replace view private.pnl_lines
with (security_invoker = true) as
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
join public.loan_splits s on s.transaction_id = t.id
join lateral (
  select
    count(*) as parts,
    sum(x.amount_minor) as parts_minor,
    bool_or(x.needs_review) as flagged
  from public.loan_splits x
  where x.transaction_id = t.id
) sp on sp.parts in (3, 4) and not sp.flagged
  and sp.parts_minor = abs(t.amount_net)
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
join public.line_splits s on s.transaction_id = t.id
join lateral (
  select
    count(*) as parts,
    sum(x.amount_minor) as parts_minor
  from public.line_splits x
  where x.transaction_id = t.id
) lp on lp.parts >= 2
  and lp.parts_minor = abs(t.amount_net)
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
    case when sp.parts = 0 then t.in_pnl_override end,
    private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
    c.loan_part
  ) as in_pnl,
  sp.parts > 0 as loan_split_fallback,
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
cross join lateral (
  select
    count(*) as parts,
    sum(x.amount_minor) as parts_minor,
    bool_or(x.needs_review) as flagged
  from public.loan_splits x
  where x.transaction_id = t.id
) sp
cross join lateral (
  select
    count(*) as parts,
    sum(x.amount_minor) as parts_minor
  from public.line_splits x
  where x.transaction_id = t.id
) lp
where t.removed_at is null
  and t.line_status = 'posted'
  and (
    sp.parts = 0 or sp.parts not in (3, 4) or sp.flagged or t.vat_amount <> 0
    or sp.parts_minor <> abs(t.amount_net)
  )
  and (
    sp.parts > 0 or lp.parts < 2
    or lp.parts_minor <> abs(t.amount_net)
  );

revoke all on private.pnl_lines from public, anon;
grant select on private.pnl_lines to authenticated, service_role;

create or replace function private.overhead_share_for(p_company uuid, p_project uuid, p_basis text, p_from date, p_to date)
returns table(available boolean, share_agorot bigint)
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
  -- One pass over the company's lines feeds both the income weights and the overhead cost.
  lines as (
    select l.project_id, l.kind, l.pnl_role, l.direction, l.doc_kind, l.amount_net
    from private.pnl_lines l
    where l.company_id = (select id from cid)
      and l.currency = 'ILS'
      and l.in_pnl
      and ((select basis from cid) = 'invoiced' or not l.unpaid)
      and private.pnl_in_range(l.kind, (select basis from cid), l.doc_date, l.cash_date, p_from, p_to)
  ),
  income as (
    select l.project_id, l.amount_net
    from lines l
    where l.kind = 'income'
      and (
        l.direction = 'expense'
        or ((select basis from cid) = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or ((select basis from cid) = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
      and l.project_id is not null
      and l.project_id is distinct from (select overhead_project from cid)
  ),
  totals as (
    select
      coalesce((select sum(i.amount_net) from income i), 0)::bigint as total_income,
      coalesce((
        select -sum(l.amount_net)::bigint
        from lines l
        where l.kind = 'expense' and l.pnl_role = 'overhead'
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
      select i.project_id, sum(i.amount_net)::bigint as income
      from income i
      group by i.project_id
      having sum(i.amount_net) > 0
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

create or replace function private.overhead_share_for(p_company uuid, p_project uuid, p_basis text, p_from date, p_to date, p_currency text)
returns table(available boolean, share_agorot bigint)
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
  -- One pass over the company's lines feeds both the income weights and the overhead cost.
  lines as (
    select l.project_id, l.kind, l.pnl_role, l.direction, l.doc_kind, l.amount_net
    from private.pnl_lines l
    where l.company_id = (select id from cid)
      and l.currency = p_currency
      and l.in_pnl
      and ((select basis from cid) = 'invoiced' or not l.unpaid)
      and private.pnl_in_range(l.kind, (select basis from cid), l.doc_date, l.cash_date, p_from, p_to)
  ),
  income as (
    select l.project_id, l.amount_net
    from lines l
    where l.kind = 'income'
      and (
        l.direction = 'expense'
        or ((select basis from cid) = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or ((select basis from cid) = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
      and l.project_id is not null
      and l.project_id is distinct from (select overhead_project from cid)
  ),
  totals as (
    select
      coalesce((select sum(i.amount_net) from income i), 0)::bigint as total_income,
      coalesce((
        select -sum(l.amount_net)::bigint
        from lines l
        where l.kind = 'expense' and l.pnl_role = 'overhead'
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
      select i.project_id, sum(i.amount_net)::bigint as income
      from income i
      group by i.project_id
      having sum(i.amount_net) > 0
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

create or replace function private.project_category_entries_by_currency(p_project uuid)
returns table(category_id uuid, transaction_id uuid, description text, doc_date date, amount_net bigint, created_at timestamp with time zone, shared boolean, currency text)
language sql
stable
set search_path = ''
as $$
  select l.category_id, l.transaction_id, t.description, l.doc_date, l.amount_net, t.created_at, false, l.currency
  from private.pnl_lines l
  join public.transactions t on t.id = l.transaction_id
  where l.project_id = p_project
    and l.transaction_id = any(array(
      select t2.id from public.transactions t2 where t2.project_id = p_project
      union
      select s2.transaction_id from public.line_splits s2 where s2.project_id = p_project
    ))
    and l.company_id = (select private.readable_company_id())
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
      when l.part is null and l.amount_net = l.line_amount_net then a.amount_net
      else coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
    end,
    t.created_at, true, l.currency
  from public.allocations a
  join private.pnl_lines l on l.transaction_id = a.transaction_id
  join public.transactions t on t.id = l.transaction_id
  where a.project_id = p_project
    and l.transaction_id = any(array(
      select a2.transaction_id from public.allocations a2 where a2.project_id = p_project
    ))
    and l.company_id = (select private.readable_company_id())
    and l.kind = 'expense'
    and l.pnl_role = 'shared'
    and not t.category_suggested
    and l.category_id is not null;
$$;

create or replace function private.project_investment(p_company_id uuid, p_project_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  p record;
  cur text;
  rehab bigint;
  rehab_other jsonb;
  rehab_rows jsonb;
  loan_balance bigint;
  loan_other jsonb;
begin
  select pr.investment_currency, pr.purchase_minor, pr.arv_minor, pr.value_minor, pr.value_date into p
  from public.projects pr
  where pr.id = p_project_id and pr.company_id = p_company_id;
  if not found then
    return null;
  end if;
  cur := p.investment_currency;

  with costs as (
    select l.currency, l.category_id, l.amount_net
    from private.pnl_lines l
    left join public.categories c on c.id = l.category_id
    where l.company_id = p_company_id
      and l.project_id = p_project_id
      and l.kind = 'expense'
      and l.pnl_role = 'project'
      and not l.unpaid
      and private.category_in_rehab(c.rehab, c.excluded_from_pnl, coalesce(c.loan_part, l.part))
    union all
    select l.currency, l.category_id, coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
    from public.allocations a
    join private.pnl_lines l on l.transaction_id = a.transaction_id
    left join public.categories c on c.id = l.category_id
    where a.project_id = p_project_id
      and l.transaction_id = any(array(
        select a2.transaction_id from public.allocations a2
        where a2.company_id = p_company_id and a2.project_id = p_project_id
      ))
      and l.company_id = p_company_id
      and l.kind = 'expense'
      and l.pnl_role = 'shared'
      and not l.unpaid
      and private.category_in_rehab(c.rehab, c.excluded_from_pnl, coalesce(c.loan_part, l.part))
  ),
  by_currency as (
    select x.currency, (-sum(x.amount_net))::bigint as amount_minor
    from costs x
    group by x.currency
  ),
  -- FLOW-404: the project-currency total by category, from the same lines, so the list adds
  -- up to rehab_minor. A line with no category is one row with a null id.
  by_category as (
    select x.category_id, (-sum(x.amount_net))::bigint as amount_minor
    from costs x
    where x.currency = cur
    group by x.category_id
  )
  select
    coalesce((select b.amount_minor from by_currency b where b.currency = cur), 0),
    coalesce((
      select jsonb_agg(jsonb_build_object('currency', b.currency, 'amount_minor', b.amount_minor) order by b.currency)
      from by_currency b
      where b.currency <> cur and b.amount_minor <> 0
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', g.category_id,
        'name', c.name,
        'hidden', coalesce(c.hidden, false),
        'amount_minor', g.amount_minor
      ) order by g.amount_minor desc, c.name nulls last, g.category_id)
      from by_category g
      left join public.categories c on c.id = g.category_id and c.company_id = p_company_id
      where g.amount_minor <> 0
    ), '[]'::jsonb)
  into rehab, rehab_other, rehab_rows;

  select coalesce(sum(b.balance_minor), 0)::bigint into loan_balance
  from public.loans l
  join public.loan_balances b on b.company_id = l.company_id and b.loan_id = l.id
  where l.company_id = p_company_id
    and l.project_id = p_project_id
    and l.status = 'open'::public.loan_status
    and l.currency = cur;

  select coalesce(jsonb_agg(jsonb_build_object('currency', x.currency, 'balance_minor', x.balance_minor)
           order by x.currency), '[]'::jsonb)
  into loan_other
  from (
    select l.currency, sum(b.balance_minor)::bigint as balance_minor
    from public.loans l
    join public.loan_balances b on b.company_id = l.company_id and b.loan_id = l.id
    where l.company_id = p_company_id
      and l.project_id = p_project_id
      and l.status = 'open'::public.loan_status
      and l.currency <> cur
    group by l.currency
    having sum(b.balance_minor) <> 0
  ) x;

  return jsonb_build_object(
    'currency', cur,
    'purchase_minor', p.purchase_minor,
    'arv_minor', p.arv_minor,
    'value_minor', p.value_minor,
    'value_date', p.value_date,
    'rehab_minor', rehab,
    'rehab_by_category', rehab_rows,
    'rehab_other_currencies', rehab_other,
    'loan_balance_minor', loan_balance,
    'loan_balance_other_currencies', loan_other,
    'forced_equity_minor', case when rehab_other = '[]'::jsonb then p.arv_minor - p.purchase_minor - rehab end,
    'current_equity_minor', case when loan_other = '[]'::jsonb then p.value_minor - loan_balance end
  );
end;
$$;

create or replace function public.get_project(p_id uuid, p_basis text, p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
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
  ids uuid[];
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
  basis := case when p_basis = 'invoiced' then 'invoiced' else 'cash' end;

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
      select sum(l.amount_net) from (select * from private.pnl_lines u where u.transaction_id = any(ids) and (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l
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
      select sum(l.amount_net) from (select * from private.pnl_lines u where u.transaction_id = any(ids) and (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l
      where l.project_id = p.id and l.kind = 'expense' and l.pnl_role = 'project'
        and l.in_pnl
        and l.currency = 'ILS'
    ), 0),
    'shared_agorot', -coalesce((
      select sum(coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0))
      from public.allocations a
      join (select * from private.pnl_lines u where u.transaction_id = any(ids) and (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l on l.transaction_id = a.transaction_id
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
          from (select * from private.pnl_lines u where u.transaction_id = any(ids) and (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l
          where l.project_id = p.id
            and l.in_pnl
          union all
          select l.currency as currency,
            0::bigint,
            0::bigint,
            -coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0) as shared_minor
          from public.allocations a
          join (select * from private.pnl_lines u where u.transaction_id = any(ids) and (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l on l.transaction_id = a.transaction_id
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
          and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to)
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
          and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to)
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
          and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to)
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
        from (select * from private.pnl_lines u where u.transaction_id = any(ids) and (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l
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
          from (select * from private.pnl_lines u where u.transaction_id = any(ids) and (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l
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
          from public.allocations a
          join (select * from private.pnl_lines u where u.transaction_id = any(ids) and (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l on l.transaction_id = a.transaction_id
          where a.project_id = p.id
            and l.kind = 'expense' and l.pnl_role = 'shared'
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
            from private.pnl_lines pl
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
  select s.available, s.share_agorot into available, share
  from private.overhead_share_for(cid, p_id, basis, p_from, p_to) s;
  base := private.company_base_currency(cid);
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
    -- A company kept in shekels has the same share as above: no second pass over its lines.
    'overhead_share_minor', case
      when base = 'ILS' then case when coalesce(available, false) then coalesce(share, 0) else null end
      else (
        select case when s.available then coalesce(s.share_agorot, 0) else null end
        from private.overhead_share_for(cid, p_id, basis, p_from, p_to, base) s
      )
    end,
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
        'kind', l.kind
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
