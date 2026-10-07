-- FLOW-301. Home's income and expense figures broken down by category, project, or
-- supplier/customer, and one group's lines. Reads private.pnl_lines with the same
-- period and basis rules as company_pnl, so the groups add up to Home. Decision 0110.

begin;

-- One row per counted line, loan-split part, or shared allocation, with the group it
-- falls in. amount_minor is signed like company_pnl's income_minor / expense_minor:
-- positive for income and for a normal expense.
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
  doc_date date
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
    from private.pnl_lines l
    join public.transactions t on t.id = l.transaction_id
    where l.company_id = p_company_id
      and l.direction::text = p_direction
      and (
        p_direction = 'expense'
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
    s.amount_minor, s.in_pnl, false, s.doc_date
  from signed s
  left join public.categories c on c.id = s.category_id
  where p_group_by = 'category'
  union all
  select
    s.transaction_id, s.part, s.currency,
    coalesce(s.supplier_id::text, 'none'),
    sup.name,
    s.amount_minor, s.in_pnl, false, s.doc_date
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
    s.amount_minor, s.in_pnl, false, s.doc_date
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
    s.in_pnl, true, s.doc_date
  from signed s
  join public.allocations a on a.transaction_id = s.transaction_id
  left join public.projects p on p.id = a.project_id
  where p_group_by = 'project'
    and p_direction = 'expense'
    and s.pnl_role = 'shared'
    and not s.unassigned;
$$;

revoke all on function private.breakdown_rows(uuid, text, date, date, text, text) from public, anon, authenticated;

-- company_pnl counts nothing when only one date is given, while breakdown_rows would
-- count all time. A half-open period is refused so the totals never drift from Home.
create or replace function private.breakdown_company(p_direction text, p_group_by text, p_from date, p_to date)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if p_direction is null or p_direction not in ('income', 'expense') then
    raise exception 'validation';
  end if;
  if p_group_by is null or p_group_by not in ('category', 'project', 'payer') then
    raise exception 'validation';
  end if;
  if (p_from is null) <> (p_to is null) then
    raise exception 'validation';
  end if;
  return cid;
end;
$$;

revoke all on function private.breakdown_company(text, text, date, date) from public, anon;
grant execute on function private.breakdown_company(text, text, date, date) to authenticated, service_role;

-- Group totals for Home's income or expenses. Totals and groups count only lines in the
-- P&L; lines in kept-out categories are in excluded and nowhere else.
create or replace function public.get_breakdown(
  p_direction text,
  p_from date default null,
  p_to date default null,
  p_group_by text default 'category',
  p_basis text default 'cash'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  basis text;
  result jsonb;
begin
  cid := private.breakdown_company(p_direction, p_group_by, p_from, p_to);
  if cid is null then
    return null;
  end if;
  basis := case when p_basis = 'invoiced' then 'invoiced' else 'cash' end;

  with r as (
    select * from private.breakdown_rows(cid, p_direction, p_from, p_to, basis, p_group_by)
  ),
  groups as (
    select
      r.currency,
      r.group_key,
      max(r.group_name) as group_name,
      sum(r.amount_minor)::bigint as amount_minor,
      count(distinct r.transaction_id)::integer as line_count,
      bool_or(r.shared) as shared
    from r
    where r.in_pnl
    group by r.currency, r.group_key
  ),
  by_line as (
    -- Totals count each line or part once, so a shared line is the line, not its rounded shares.
    select * from private.breakdown_rows(cid, p_direction, p_from, p_to, basis, 'category')
  ),
  all_totals as (
    select b.currency, sum(b.amount_minor)::bigint as amount_minor, count(distinct b.transaction_id)::integer as line_count
    from by_line b
    where b.in_pnl
    group by b.currency
  ),
  excluded as (
    select r.currency, sum(r.amount_minor)::bigint as amount_minor, count(distinct r.transaction_id)::integer as line_count
    from by_line r
    where not r.in_pnl
    group by r.currency
  )
  select jsonb_build_object(
    'direction', p_direction,
    'basis', basis,
    'group_by', p_group_by,
    'from', p_from,
    'to', p_to,
    'totals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', t.currency, 'amount_minor', t.amount_minor, 'count', t.line_count
      ) order by (t.currency <> 'ILS'), t.currency)
      from all_totals t
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', g.group_key,
        'name', g.group_name,
        'currency', g.currency,
        'amount_minor', g.amount_minor,
        'count', g.line_count,
        'shared', g.shared
      ) order by (g.currency <> 'ILS'), g.currency, g.amount_minor desc, g.group_name nulls last, g.group_key)
      from groups g
    ), '[]'::jsonb),
    'excluded', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', e.currency, 'amount_minor', e.amount_minor, 'count', e.line_count
      ) order by (e.currency <> 'ILS'), e.currency)
      from excluded e
    ), '[]'::jsonb),
    'review_count', (
      select count(*)::integer
      from public.review_queue q
      join public.transactions t on t.id = q.transaction_id
      where q.company_id = cid
        and q.status = 'open'
        and t.removed_at is null
        and t.direction::text = p_direction
        and (p_from is null or p_to is null or t.doc_date between p_from and p_to)
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_breakdown(text, date, date, text, text) from public, anon;
grant execute on function public.get_breakdown(text, date, date, text, text) to authenticated, service_role;

-- One group's lines, newest first. p_excluded lists the kept-out lines of a currency
-- instead of a group.
create or replace function public.get_breakdown_lines(
  p_direction text,
  p_group_by text,
  p_group_key text,
  p_currency text,
  p_from date default null,
  p_to date default null,
  p_basis text default 'cash',
  p_excluded boolean default false,
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  basis text;
  lim integer;
  off integer;
  result jsonb;
begin
  cid := private.breakdown_company(p_direction, p_group_by, p_from, p_to);
  if cid is null then
    return null;
  end if;
  basis := case when p_basis = 'invoiced' then 'invoiced' else 'cash' end;
  lim := least(greatest(coalesce(p_limit, 40), 1), 200);
  off := greatest(coalesce(p_offset, 0), 0);

  with r as (
    select *
    from private.breakdown_rows(cid, p_direction, p_from, p_to, basis, p_group_by) x
    where x.currency = coalesce(p_currency, 'ILS')
      and (
        (coalesce(p_excluded, false) and not x.in_pnl)
        or (not coalesce(p_excluded, false) and x.in_pnl and x.group_key = p_group_key)
      )
  ),
  page as (
    select
      r.transaction_id,
      r.part,
      r.amount_minor,
      r.doc_date,
      r.shared,
      t.description,
      sup.name as supplier_name,
      p.name as project_name,
      c.name as category_name,
      row_number() over (order by r.doc_date desc, r.transaction_id, r.part) as n
    from r
    join public.transactions t on t.id = r.transaction_id
    left join public.suppliers sup on sup.id = t.supplier_id
    left join public.projects p on p.id = t.project_id
    -- A loan-split part names its own category, not the bank line's.
    left join public.loan_splits ls on ls.transaction_id = r.transaction_id and ls.part = r.part
    left join public.categories c on c.id = coalesce(ls.category_id, t.category_id)
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'transaction_id', pg.transaction_id,
        'part', pg.part,
        'description', pg.description,
        'supplier_name', pg.supplier_name,
        'project_name', pg.project_name,
        'category_name', pg.category_name,
        'doc_date', pg.doc_date,
        'currency', coalesce(p_currency, 'ILS'),
        'amount_minor', pg.amount_minor,
        'shared', pg.shared
      ) order by pg.n)
      from page pg
      where pg.n > off and pg.n <= off + lim
    ), '[]'::jsonb),
    'has_more', exists (select 1 from page pg where pg.n > off + lim)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_breakdown_lines(text, text, text, text, date, date, text, boolean, integer, integer) from public, anon;
grant execute on function public.get_breakdown_lines(text, text, text, text, date, date, text, boolean, integer, integer) to authenticated, service_role;

commit;
