-- FLOW-160: one P&L statement read for the reports screen, its PDF and the MCP.
-- public.get_pnl_statement(from, to, project_id, by_project, basis) returns the P&L as a statement:
-- per currency, the income and expense categories (a parent with its sub-categories rolled up and
-- listed under it), the totals and the net profit; the kept-out categories with the balance-sheet
-- account they post to; and the open review count. It reads private.breakdown_rows, the rows
-- get_breakdown sums, so its totals are get_breakdown's: by category for the company, by project
-- (a shared cost split by its allocations, overhead and unassigned apart) for one project and for
-- by_project, which adds one statement per project key.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- One statement per currency from a set of breakdown rows (signed: income and cost both positive).
-- p_rows is jsonb so the same body serves the company, one project and each project key.
create or replace function private.pnl_statement_body(p_company_id uuid, p_rows jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with r as (
    select
      x.direction,
      x.transaction_id,
      x.currency,
      x.category_id,
      x.amount_minor,
      x.in_pnl
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
      direction text, transaction_id uuid, currency text, category_id uuid, amount_minor bigint, in_pnl boolean
    )
  ),
  counted as (
    select
      r.direction,
      r.currency,
      r.category_id,
      c.name as category_name,
      coalesce(c.parent_id, r.category_id) as node_id,
      r.amount_minor,
      r.transaction_id
    from r
    left join public.categories c on c.company_id = p_company_id and c.id = r.category_id
    where r.in_pnl
  ),
  -- A sub-category under its parent; a parent's own lines are its own row among the children.
  leaves as (
    select
      k.direction, k.currency, k.node_id, k.category_id, max(k.category_name) as name,
      sum(k.amount_minor)::bigint as amount_minor,
      count(distinct k.transaction_id)::integer as line_count
    from counted k
    group by k.direction, k.currency, k.node_id, k.category_id
  ),
  nodes as (
    select
      l.direction, l.currency, l.node_id,
      sum(l.amount_minor)::bigint as amount_minor,
      sum(l.line_count)::integer as line_count,
      coalesce(sum(l.amount_minor) filter (where l.category_id is not distinct from l.node_id), 0)::bigint as own_minor,
      count(*) filter (where l.category_id is distinct from l.node_id)::integer as child_count
    from leaves l
    group by l.direction, l.currency, l.node_id
  ),
  node_json as (
    select
      n.direction,
      n.currency,
      n.amount_minor,
      jsonb_build_object(
        'id', n.node_id,
        'name', pc.name,
        'amount_minor', n.amount_minor,
        'count', n.line_count,
        'own_minor', n.own_minor,
        'children', case when n.child_count = 0 then '[]'::jsonb else (
          select jsonb_agg(jsonb_build_object(
            'id', l.category_id, 'name', l.name, 'amount_minor', l.amount_minor, 'count', l.line_count
          ) order by l.amount_minor desc, l.name nulls last, l.category_id)
          from leaves l
          where l.direction = n.direction and l.currency = n.currency and l.node_id is not distinct from n.node_id
        ) end
      ) as body,
      pc.name as node_name,
      n.node_id
    from nodes n
    left join public.categories pc on pc.company_id = p_company_id and pc.id = n.node_id
  ),
  totals as (
    select
      k.currency,
      coalesce(sum(k.amount_minor) filter (where k.direction = 'income'), 0)::bigint as income_minor,
      coalesce(sum(k.amount_minor) filter (where k.direction = 'expense'), 0)::bigint as expense_minor
    from counted k
    group by k.currency
  ),
  kept as (
    select
      r.currency, r.direction, r.category_id, max(c.name) as name,
      sum(r.amount_minor)::bigint as amount_minor,
      count(distinct r.transaction_id)::integer as line_count,
      max(a.name) as account_name,
      max(a.type) as account_type
    from r
    left join public.categories c on c.company_id = p_company_id and c.id = r.category_id
    left join public.accounts a on a.company_id = p_company_id
      and a.id = private.kept_out_account(p_company_id, r.category_id, c.loan_part)
    where not r.in_pnl
    group by r.currency, r.direction, r.category_id
  ),
  currencies as (
    select t.currency from totals t
    union
    select k.currency from kept k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'currency', cu.currency,
    'income_minor', coalesce(t.income_minor, 0),
    'expense_minor', coalesce(t.expense_minor, 0),
    'net_minor', coalesce(t.income_minor, 0) - coalesce(t.expense_minor, 0),
    'income', coalesce((
      select jsonb_agg(j.body order by j.amount_minor desc, j.node_name nulls last, j.node_id)
      from node_json j where j.currency = cu.currency and j.direction = 'income'
    ), '[]'::jsonb),
    'expense', coalesce((
      select jsonb_agg(j.body order by j.amount_minor desc, j.node_name nulls last, j.node_id)
      from node_json j where j.currency = cu.currency and j.direction = 'expense'
    ), '[]'::jsonb),
    'kept_out', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.category_id, 'name', k.name, 'direction', k.direction, 'amount_minor', k.amount_minor,
        'count', k.line_count, 'account_name', k.account_name, 'account_type', k.account_type
      ) order by k.direction, k.amount_minor desc, k.name nulls last, k.category_id)
      from kept k where k.currency = cu.currency
    ), '[]'::jsonb)
  ) order by (cu.currency <> 'ILS'), cu.currency), '[]'::jsonb)
  from currencies cu
  left join totals t on t.currency = cu.currency;
$$;

revoke all on function private.pnl_statement_body(uuid, jsonb) from public, anon, authenticated;

comment on function private.pnl_statement_body(uuid, jsonb) is
  'FLOW-160: one P&L statement per currency from breakdown rows (income and cost positive).';

create or replace function public.get_pnl_statement(
  p_from date default null,
  p_to date default null,
  p_project_id uuid default null,
  p_by_project boolean default false,
  p_basis text default null
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
  proj_name text;
  mode text;
  rows jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if (p_from is null) <> (p_to is null) or p_from > p_to then
    raise exception 'validation';
  end if;
  if p_project_id is not null and coalesce(p_by_project, false) then
    raise exception 'validation';
  end if;
  if p_project_id is not null then
    select p.name into proj_name from public.projects p where p.id = p_project_id and p.company_id = cid;
    if not found then
      -- Another company's project reads as unknown.
      return null;
    end if;
  end if;
  basis := private.pnl_basis(cid, p_basis);
  -- The company reads by category, the rows get_breakdown totals; a project, and by project, read by
  -- project key, so a shared cost counts as each project's allocation.
  mode := case when p_project_id is null and not coalesce(p_by_project, false) then 'category' else 'project' end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'direction', d.dir, 'key', b.group_key, 'name', b.group_name, 'transaction_id', b.transaction_id,
    'currency', b.currency, 'category_id', b.category_id, 'amount_minor', b.amount_minor, 'in_pnl', b.in_pnl
  )), '[]'::jsonb)
  into rows
  from (values ('income'), ('expense')) as d(dir)
  cross join lateral private.breakdown_rows(cid, d.dir, p_from, p_to, basis, mode) b
  where p_project_id is null or b.group_key = p_project_id::text;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'basis', basis,
    'project_id', p_project_id,
    'project_name', proj_name,
    'by_project', coalesce(p_by_project, false),
    -- The scope's statement: the company (by category), or the one project.
    'currencies', case
      when mode = 'category' or p_project_id is not null then private.pnl_statement_body(cid, rows)
      -- By project, the company line is still the company read by category, as get_breakdown totals it.
      else private.pnl_statement_body(cid, (
        select coalesce(jsonb_agg(jsonb_build_object(
          'direction', d.dir, 'transaction_id', b.transaction_id, 'currency', b.currency,
          'category_id', b.category_id, 'amount_minor', b.amount_minor, 'in_pnl', b.in_pnl
        )), '[]'::jsonb)
        from (values ('income'), ('expense')) as d(dir)
        cross join lateral private.breakdown_rows(cid, d.dir, p_from, p_to, basis, 'category') b
      ))
    end,
    'projects', case when not coalesce(p_by_project, false) then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', g.key,
        'project_id', case when g.key in ('overhead', 'unassigned') then null else g.key::uuid end,
        'name', g.name,
        'currencies', private.pnl_statement_body(cid, g.rows)
      ) order by (g.key in ('overhead', 'unassigned')), g.key = 'unassigned', g.name nulls last, g.key)
      from (
        select x ->> 'key' as key, max(x ->> 'name') as name, jsonb_agg(x) as rows
        from jsonb_array_elements(rows) x
        group by x ->> 'key'
      ) g
    ), '[]'::jsonb) end,
    'review_count', (
      select count(*)::integer
      from public.review_queue q
      join public.transactions t on t.id = q.transaction_id
      where q.company_id = cid
        and q.status = 'open'
        and t.removed_at is null
        and t.line_status = 'posted'
        and (p_from is null or p_to is null or t.doc_date between p_from and p_to)
        and (p_project_id is null or t.project_id = p_project_id)
    )
  );
end;
$$;

revoke all on function public.get_pnl_statement(date, date, uuid, boolean, text) from public, anon;
grant execute on function public.get_pnl_statement(date, date, uuid, boolean, text) to authenticated, service_role;

comment on function public.get_pnl_statement(date, date, uuid, boolean, text) is
  'FLOW-160: the P&L as a statement for the reports screen, its PDF and MCP get_pnl_statement: per '
  'currency income and expense categories (parents with sub-categories), totals, net, kept-out '
  'categories; one project or by project. Totals are get_breakdown''s for the same range and basis.';

commit;
