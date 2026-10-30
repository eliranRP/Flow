-- FLOW-989: the category drill-down's "by project" split counts a split line by its parts.
--   get_breakdown_lines merged a line's rows in one group by (line, loan part, shared). A split by category
--   has no loan part, so a line's two parts in one category on two projects became one row with no project,
--   and the screen put the whole amount under "no project". Now:
--   1. The rows are merged by project too: each part shows on its own project, with its own amount.
--   2. The result carries 'projects': the whole group's totals by project, read as get_pnl_statement with
--      by_project reads them (private.breakdown_rows by project: a split line by its parts, a shared cost by
--      its allocations, a whole line by its project), so the screen's split equals the P&L by project.
--      Empty when one project is read (p_project_id), for kept-out lines, and by payer.
--   Every argument and every other field is kept.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function public.get_breakdown_lines(
  p_direction text,
  p_group_by text,
  p_group_key text,
  p_currency text,
  p_from date default null,
  p_to date default null,
  p_basis text default null,
  p_excluded boolean default false,
  p_limit integer default 40,
  p_offset integer default 0,
  p_project_id uuid default null
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
  -- FLOW-165: the project first, so another company's project reads as unknown before any other check.
  if p_project_id is not null then
    cid := private.readable_company_id();
    if cid is null then
      return null;
    end if;
    perform 1 from public.projects p where p.id = p_project_id and p.company_id = cid;
    if not found then
      return null;
    end if;
  end if;
  cid := private.breakdown_company(p_direction, p_group_by, p_from, p_to);
  if cid is null then
    return null;
  end if;
  if p_project_id is not null and p_group_by not in ('category', 'parent') then
    raise exception 'validation';
  end if;
  basis := private.pnl_basis(cid, p_basis);
  lim := least(greatest(coalesce(p_limit, 40), 1), 200);
  off := greatest(coalesce(p_offset, 0), 0);

  with src as (
    -- One project reads by project key (its allocation of a shared cost), keyed again by category or parent.
    select x.*,
      case
        when p_project_id is null then x.group_key
        when p_group_by = 'parent' then coalesce(coalesce(pc.parent_id, x.category_id)::text, 'none')
        else coalesce(x.category_id::text, 'none')
      end as drill_key
    from private.breakdown_rows(cid, p_direction, p_from, p_to, basis,
      case when p_project_id is null then p_group_by else 'project' end) x
    left join public.categories pc on p_project_id is not null and p_group_by = 'parent' and pc.id = x.category_id
    where p_project_id is null or x.group_key = p_project_id::text
  ),
  r as (
    select *
    from src x
    where x.currency = coalesce(p_currency, 'ILS')
      and (
        (coalesce(p_excluded, false) and not x.in_pnl)
        or (not coalesce(p_excluded, false) and x.in_pnl and x.drill_key = p_group_key)
      )
  ),
  -- A line split by category can put two parts of one line in the same group; they show
  -- as one row. Each part names its own category and project (loan or line split).
  merged as (
    select
      r.transaction_id,
      r.part,
      r.shared,
      max(r.doc_date) as doc_date,
      sum(r.amount_minor)::bigint as amount_minor,
      case when count(distinct r.category_id) = 1 and count(r.category_id) = count(*) then min(r.category_id::text)::uuid end as category_id,
      case when count(distinct r.project_id) = 1 and count(r.project_id) = count(*) then min(r.project_id::text)::uuid end as project_id,
      bool_or(r.gross_up) as gross_up
    from r
    -- FLOW-989: and by project, so a line's parts on two projects stay two rows, each with its own amount.
    group by r.transaction_id, r.part, r.shared, r.project_id, case when coalesce(p_excluded, false) then r.drill_key end
  ),
  page as (
    select
      m.transaction_id,
      m.part,
      m.amount_minor,
      m.doc_date,
      m.shared,
      t.description,
      t.source,
      sup.name as supplier_name,
      p.name as project_name,
      c.name as category_name,
      m.gross_up,
      m.category_id,
      row_number() over (order by m.doc_date desc, m.transaction_id, m.part, m.shared, m.category_id nulls first, p.name nulls first, m.project_id) as n
    from merged m
    join public.transactions t on t.id = m.transaction_id
    left join public.suppliers sup on sup.id = t.supplier_id
    left join public.projects p on p.id = m.project_id
    left join public.categories c on c.id = m.category_id
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
        'shared', pg.shared,
        'source', pg.source,
        'kept_out', coalesce(p_excluded, false),
        'gross_up', pg.gross_up,
        'category_id', pg.category_id
      ) order by pg.n)
      from page pg
      where pg.n > off and pg.n <= off + lim
    ), '[]'::jsonb),
    'has_more', exists (select 1 from page pg where pg.n > off + lim),
    -- FLOW-165: the whole group's total and row count, so a screen that loads a page shows the full figure.
    'total_minor', (select coalesce(sum(pg.amount_minor), 0)::bigint from page pg),
    'count', (select count(*)::integer from page pg),
    -- FLOW-989: the whole group by project, read as get_pnl_statement reads by project: a split line by its
    -- parts (each on its own project, only the parts in this group), a shared cost by its allocations, a
    -- whole line by its own project. Keys and names as get_pnl_statement's projects: a project id,
    -- 'overhead', 'unassigned', or null (no project). Largest first. Empty for one project and kept-out lines.
    'projects', case when p_project_id is not null or coalesce(p_excluded, false) or p_group_by not in ('category', 'parent') then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', g.key,
        'project_id', case when g.key in ('overhead', 'unassigned') then null else g.key::uuid end,
        'name', g.name,
        'total_minor', g.total
      ) order by g.total desc, g.name nulls last, g.key nulls first)
      from (
        select x.group_key as key, max(x.group_name) as name, sum(x.amount_minor)::bigint as total
        from private.breakdown_rows(cid, p_direction, p_from, p_to, basis, 'project') x
        left join public.categories pc on p_group_by = 'parent' and pc.id = x.category_id
        where x.currency = coalesce(p_currency, 'ILS')
          and x.in_pnl
          and case
            when p_group_by = 'parent' then coalesce(coalesce(pc.parent_id, x.category_id)::text, 'none')
            else coalesce(x.category_id::text, 'none')
          end = p_group_key
        group by x.group_key
        having sum(x.amount_minor) <> 0
      ) g
    ), '[]'::jsonb) end
  ) into result;

  return result;
end;
$$;

commit;
