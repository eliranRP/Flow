-- FLOW-160 follow-up: get_pnl_statement looks up the project before any other check on it, so another
-- company's project reads as unknown (null) even when by_project is also set; a project of the
-- caller's own company with by_project is still 'validation'. Found by the cross-company sweep on main.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

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
  if p_project_id is not null then
    select p.name into proj_name from public.projects p where p.id = p_project_id and p.company_id = cid;
    if not found then
      -- Another company's project reads as unknown, before any other check on it.
      return null;
    end if;
  end if;
  if p_project_id is not null and coalesce(p_by_project, false) then
    raise exception 'validation';
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

commit;
