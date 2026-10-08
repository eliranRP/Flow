-- Profit by month, server half (plan profit-by-month.md §5, decision 0129).
-- 1. private.pnl_in_range: the one date rule company_pnl uses. Income on the cash basis counts by
--    its cash date (else its document date); everything else counts by its document date.
-- 2. FLOW-409: private.overhead_share_for weights the overhead split by the basis' own income
--    (receipts on cash, invoices on invoiced) and takes a range. overhead_share keeps its two
--    signatures and calls it for all time.
-- 3. get_project and list_project_category take an optional range (p_from and p_to, both or
--    neither; one alone or from after to is 'invalid range') as new last arguments with null
--    defaults, so every existing call stays all time.
--    Each is dropped and created again with its grants. get_project's body is
--    otherwise as in 20261008100000_line_split_followups.sql, list_project_category's as in
--    20260929250000_category_drilldown.sql.
-- 4. public.get_profit_months: the company's or one project's profit per calendar month of a
--    range, per currency, on company_pnl's and get_project's rules.

begin;

set local lock_timeout = '5s';

create or replace function private.pnl_in_range(
  p_kind text,
  p_basis text,
  p_doc_date date,
  p_cash_date date,
  p_from date,
  p_to date
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_from is null or p_to is null
    or (
      case when p_kind = 'income' and p_basis = 'cash' then coalesce(p_cash_date, p_doc_date) else p_doc_date end
    ) between p_from and p_to;
$$;

revoke all on function private.pnl_in_range(text, text, date, date, date, date) from public, anon;
grant execute on function private.pnl_in_range(text, text, date, date, date, date) to authenticated, service_role;

-- The overhead of the range, spread over the projects by their share of the range's income on
-- the same basis. Rounding as before: whole shekels by hundreds, the remainder on one project.
create or replace function private.overhead_share_for(
  p_company uuid,
  p_project uuid,
  p_basis text,
  p_from date,
  p_to date
)
returns table (available boolean, share_agorot bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with cid as (
    select
      p_company as id,
      (select c.overhead_project_id from public.companies c where c.id = p_company) as overhead_project,
      case when p_basis = 'invoiced' then 'invoiced' else 'cash' end as basis
  ),
  income as (
    select l.project_id, l.amount_net
    from private.pnl_lines l
    where l.company_id = (select id from cid)
      and l.currency = 'ILS'
      and l.in_pnl
      and l.kind = 'income'
      and ((select basis from cid) = 'invoiced' or not l.unpaid)
      and (
        l.direction = 'expense'
        or ((select basis from cid) = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
        or ((select basis from cid) = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      )
      and l.project_id is not null
      and l.project_id is distinct from (select overhead_project from cid)
      and private.pnl_in_range(l.kind, (select basis from cid), l.doc_date, l.cash_date, p_from, p_to)
  ),
  totals as (
    select
      coalesce((select sum(i.amount_net) from income i), 0)::bigint as total_income,
      coalesce((
        select -sum(l.amount_net)::bigint
        from private.pnl_lines l
        where l.company_id = (select id from cid)
          and l.currency = 'ILS'
          and l.in_pnl
          and l.kind = 'expense' and l.pnl_role = 'overhead'
          and ((select basis from cid) = 'invoiced' or not l.unpaid)
          and private.pnl_in_range(l.kind, (select basis from cid), l.doc_date, l.cash_date, p_from, p_to)
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

revoke all on function private.overhead_share_for(uuid, uuid, text, date, date) from public, anon;
grant execute on function private.overhead_share_for(uuid, uuid, text, date, date) to authenticated, service_role;

create or replace function private.overhead_share(p_project uuid, p_basis text)
returns table (available boolean, share_agorot bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.available, s.share_agorot
  from private.overhead_share_for(private.current_company_id(), p_project, p_basis, null, null) s;
$$;

-- One function with the range at the end, so a call with two arguments is all time.
drop function public.get_project(uuid, text);

create function public.get_project(p_id uuid, p_basis text, p_from date default null, p_to date default null)
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
  if (p_from is null) <> (p_to is null) or p_from > p_to then
    raise exception 'invalid range' using errcode = '22023';
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
      select sum(l.amount_net) from (select * from private.pnl_lines u where (basis = 'invoiced' or not u.unpaid)
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
      select sum(l.amount_net) from (select * from private.pnl_lines u where (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l
      where l.project_id = p.id and l.kind = 'expense' and l.pnl_role = 'project'
        and l.in_pnl
        and l.currency = 'ILS'
    ), 0),
    'shared_agorot', -coalesce((
      select sum(coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0))
      from public.allocations a
      join (select * from private.pnl_lines u where (basis = 'invoiced' or not u.unpaid)
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
          from (select * from private.pnl_lines u where (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l
          where l.project_id = p.id
            and l.in_pnl
          union all
          select l.currency as currency,
            0::bigint,
            0::bigint,
            -coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0) as shared_minor
          from public.allocations a
          join (select * from private.pnl_lines u where (basis = 'invoiced' or not u.unpaid)
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
        from (select * from private.pnl_lines u where (basis = 'invoiced' or not u.unpaid)
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
          from (select * from private.pnl_lines u where (basis = 'invoiced' or not u.unpaid)
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
          join (select * from private.pnl_lines u where (basis = 'invoiced' or not u.unpaid)
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
        'parts_minor', case when exists (
          select 1 from public.line_splits s0
          where s0.transaction_id = t.id and s0.company_id = cid
        ) then coalesce((
          select sum(s.amount_minor)
          from public.line_splits s
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
  return result || jsonb_build_object(
    'from', case when p_from is null or p_to is null then null else p_from end,
    'to', case when p_from is null or p_to is null then null else p_to end,
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

revoke all on function public.get_project(uuid, text, date, date) from public, anon;
grant execute on function public.get_project(uuid, text, date, date) to authenticated, service_role;

drop function public.list_project_category(uuid, uuid, integer, integer);

create function public.list_project_category(
  p_project uuid,
  p_category uuid,
  p_offset integer default 0,
  p_limit integer default 40,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  off integer;
  lim integer;
  total bigint;
  n bigint;
  listed jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    return null;
  end if;
  if not exists (
    select 1 from public.projects p where p.id = p_project and p.company_id = cid
  ) or not exists (
    select 1 from public.categories c where c.id = p_category and c.company_id = cid
  ) then
    return null;
  end if;
  if (p_from is null) <> (p_to is null) or p_from > p_to then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  off := greatest(coalesce(p_offset, 0), 0);
  lim := least(greatest(coalesce(p_limit, 40), 1), 100);
  select coalesce((-sum(e.amount_net))::bigint, 0), count(*)::bigint
    into total, n
  from private.project_category_entries(p_project) e
  where e.category_id = p_category
    and private.pnl_in_range('expense', 'invoiced', e.doc_date, null, p_from, p_to);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page.transaction_id,
    'description', page.description,
    'doc_date', page.doc_date,
    'amount_net', page.amount_net
  ) order by page.doc_date desc, page.created_at desc, page.transaction_id), '[]'::jsonb)
  into listed
  from (
    select e.transaction_id, e.description, e.doc_date, e.amount_net, e.created_at
    from private.project_category_entries(p_project) e
    where e.category_id = p_category
      and private.pnl_in_range('expense', 'invoiced', e.doc_date, null, p_from, p_to)
    order by e.doc_date desc, e.created_at desc, e.transaction_id
    offset off
    limit lim
  ) page;
  return jsonb_build_object(
    'category_name', (select c.name from public.categories c where c.id = p_category),
    'project_name', (select p.name from public.projects p where p.id = p_project),
    'from', case when p_from is null or p_to is null then null else p_from end,
    'to', case when p_from is null or p_to is null then null else p_to end,
    'total_agorot', total,
    'rows', listed,
    'next_offset', case when n > off + lim then off + lim else null end
  );
end;
$$;

revoke all on function public.list_project_category(uuid, uuid, integer, integer, date, date) from public, anon;
grant execute on function public.list_project_category(uuid, uuid, integer, integer, date, date) to authenticated, service_role;

-- Profit per calendar month of a range, newest first. Without p_project_id: the company, as
-- company_pnl's by_currency (income, expense, net). With it: the project, as get_project's
-- by_currency (income, direct and shared cost), plus its ILS overhead share of each month.
-- Both dates or neither; neither runs from the first month with a line to the current month.
-- A month cut by the range covers only the days inside it.
create or replace function public.get_profit_months(
  p_from date default null,
  p_to date default null,
  p_basis text default 'cash',
  p_project_id uuid default null
)
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
  basis := case when p_basis = 'invoiced' then 'invoiced' else 'cash' end;

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
    cross join (select 'ILS'::text as currency union select x.currency from parts x) k
    left join sums s on s.month = m.month and s.currency = k.currency
    where k.currency = 'ILS' or s.month is not null
  ),
  overhead as (
    select m.month, o.available, o.share_agorot
    from months m
    cross join lateral private.overhead_share_for(cid, p_project_id, basis, m.mfrom, m.mto) o
    where p_project_id is not null
  )
  select jsonb_build_object(
    'basis', basis,
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
          ) order by c.currency <> 'ILS', c.currency)
          from cells c
          where c.month = m.month
        ),
        'overhead_weighted', case when p_project_id is null then null else coalesce(o.available, false) end,
        'overhead_share_agorot', case when coalesce(o.available, false) then coalesce(o.share_agorot, 0) else null end
      ) order by m.month desc)
      from months m
      left join overhead o on o.month = m.month
    ), '[]'::jsonb),
    'by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', t.currency,
        'income_minor', t.income_minor,
        'expense_minor', t.expense_minor,
        'profit_minor', t.income_minor - t.expense_minor
      ) order by t.currency <> 'ILS', t.currency)
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
$$;

revoke all on function public.get_profit_months(date, date, text, uuid) from public, anon;
grant execute on function public.get_profit_months(date, date, text, uuid) to authenticated, service_role;

commit;
