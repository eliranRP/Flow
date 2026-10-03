-- L1a posted totals. Pending and void lines stay out of the sums.
-- Review lists, project_waiting, and the project transaction list are unchanged.

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
      where id = p_company_id and owner_id = (select auth.uid())
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
      and t.direction = 'expense'
  ),
  shared_alloc as (
    select a.project_id, a.amount_net, e.in_period, e.in_prev
    from public.allocations a
    join expense e on e.id = a.transaction_id
    where e.pnl_role = 'shared'
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
          'profit_agorot', r.income_net + r.direct_net + r.shared_net
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
              when t.direction = 'income' and t.doc_kind in ('receipt', 'invoice_receipt') then t.amount_net
              when t.direction = 'expense' then t.amount_net
              else 0
            end
          )::bigint
          from public.transactions t
          where t.company_id = c.id
            and t.removed_at is null
            and t.line_status = 'posted'
        ), 0),
        'is_demo', c.is_demo
      )
      from public.companies c
      where c.owner_id = (select auth.uid())
    ),
    jsonb_build_object(
      'company_id', null,
      'name', null,
      'net_profit_agorot', 0,
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
        select sum(t.amount_net)::bigint
        from public.transactions t
        where t.company_id = (select id from cid)
          and t.removed_at is null
          and t.line_status = 'posted'
          and t.direction = 'income'
          and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')
          and t.project_id is not null
      ), 0) as total_income,
      coalesce((
        select -sum(t.amount_net)::bigint
        from public.transactions t
        where t.company_id = (select id from cid)
          and t.removed_at is null
          and t.line_status = 'posted'
          and t.pnl_role = 'overhead'
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
      select t.project_id, sum(t.amount_net)::bigint as income
      from public.transactions t
      where t.company_id = (select id from cid)
        and t.removed_at is null
        and t.line_status = 'posted'
        and t.direction = 'income'
        and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')
        and t.project_id is not null
      group by t.project_id
      having sum(t.amount_net) > 0
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

revoke all on function private.overhead_share(uuid) from public, anon;
grant execute on function private.overhead_share(uuid) to authenticated, service_role;

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
  select t.category_id, t.id, t.description, t.doc_date, t.amount_net, t.created_at, false
  from public.transactions t
  where t.project_id = p_project
    and t.company_id = (select private.current_company_id())
    and t.direction = 'expense'
    and t.pnl_role = 'project'
    and t.removed_at is null
    and t.line_status = 'posted'
    and not t.category_suggested
    and not exists (
      select 1
      from public.review_queue q
      where q.transaction_id = t.id
        and q.company_id = t.company_id
        and q.status = 'open'
    )
  union all
  select t.category_id, t.id, t.description, t.doc_date, a.amount_net, t.created_at, true
  from public.allocations a
  join public.transactions t on t.id = a.transaction_id
  where a.project_id = p_project
    and t.company_id = (select private.current_company_id())
    and t.direction = 'expense'
    and t.pnl_role = 'shared'
    and t.removed_at is null
    and t.line_status = 'posted'
    and not t.category_suggested
    and t.category_id is not null;
$$;

revoke all on function private.project_category_entries(uuid) from public, anon;
grant execute on function private.project_category_entries(uuid) to authenticated, service_role;

create or replace function public.get_project(p_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cid uuid;
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

  waiting := public.project_waiting(p_id);

  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'status', p.status,
    'state_label', p.state_label,
    'budget_agorot', p.budget_agorot,
    'sumit_budget_section_id', p.sumit_budget_section_id,
    'after_overhead', coalesce(p.after_overhead, (select c.after_overhead from public.companies c where c.id = cid)),
    'income_agorot', coalesce((
      select sum(t.amount_net) from public.transactions t
      where t.project_id = p.id and t.direction = 'income'
        and t.removed_at is null
        and t.line_status = 'posted'
        and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')
    ), 0),
    'direct_agorot', -coalesce((
      select sum(t.amount_net) from public.transactions t
      where t.project_id = p.id and t.direction = 'expense' and t.pnl_role = 'project'
        and t.removed_at is null
        and t.line_status = 'posted'
    ), 0),
    'shared_agorot', -coalesce((
      select sum(a.amount_net) from public.allocations a
      join public.transactions t on t.id = a.transaction_id
      where a.project_id = p.id and t.pnl_role = 'shared' and t.removed_at is null
        and t.line_status = 'posted'
    ), 0),
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
        group by e.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'pending_count', coalesce(jsonb_array_length(waiting), 0),
    'pending_agorot', coalesce((
      select (-sum((row->>'amount_net')::bigint))::bigint
      from jsonb_array_elements(waiting) row
    ), 0),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'description', t.description,
        'doc_date', t.doc_date,
        'amount_net', t.amount_net,
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
