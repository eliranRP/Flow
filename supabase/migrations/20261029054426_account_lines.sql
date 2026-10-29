-- FLOW-165: a balance-sheet account's movements, and one project's lines in the category drill-down.
--   1. public.get_account_lines (MCP get_account_lines, the reports screen's /reports/account): one asset,
--      liability or equity account's legs up to a date, optionally for one project and one currency: per
--      currency the balance, the opening balance on 1 January of as_of's year and the year's movement, and
--      the year's movements newest first, one per line (its legs on the account summed), paged. Signed as
--      get_balance_sheet shows them: an asset's debit is positive, a liability's and equity's credit is.
--      The same rule as the balance sheet: a line's legs count from its doc_date, posted lines that are
--      not removed, draft legs excluded. Another company's account or project, or an unknown one, is null.
--   2. public.get_breakdown_lines gains p_project_id (last, default null): the lines of a category (or a
--      parent) for one project, read by project key as get_pnl_statement reads a project (a shared cost
--      counts as the project's allocation), so FLOW-161's one-project drill-down pages like the rest. The
--      project is looked up first: another company's project reads as unknown (null). With group_by
--      project or payer a project is 'validation'. The result also carries total_minor and count, the
--      whole group's, so a screen that loads one page shows the full figure. Every other argument and
--      field is kept; the old ten-argument function is dropped, so positional calls resolve to the new one.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. get_account_lines
-- ---------------------------------------------------------------------------
create function public.get_account_lines(
  p_account_id uuid,
  p_as_of date default null,
  p_project_id uuid default null,
  p_currency text default null,
  p_limit integer default 50,
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
  as_of date := coalesce(p_as_of, current_date);
  year_start date;
  proj_name text;
  acct public.accounts%rowtype;
  sign integer;
  lim integer;
  off integer;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  -- The project first: another company's project reads as unknown, before any other check on it.
  if p_project_id is not null then
    select p.name into proj_name from public.projects p where p.id = p_project_id and p.company_id = cid;
    if not found then
      return null;
    end if;
  end if;
  select * into acct from public.accounts a
  where a.id = p_account_id and a.company_id = cid and a.type in ('asset', 'liability', 'equity');
  if not found then
    return null;
  end if;
  if p_currency is not null and p_currency !~ '^[A-Z]{3}$' then
    raise exception 'validation';
  end if;
  year_start := date_trunc('year', as_of)::date;
  sign := case when acct.type = 'asset' then 1 else -1 end;
  lim := least(greatest(coalesce(p_limit, 50), 1), 200);
  off := greatest(coalesce(p_offset, 0), 0);

  with legs as (
    select l.transaction_id, l.amount_minor, l.project_id, l.part, l.loan_id, t.doc_date,
      coalesce(t.currency, 'ILS') as currency
    from public.legs l
    join public.transactions t
      on t.id = l.transaction_id and t.company_id = l.company_id
     and t.removed_at is null and t.line_status = 'posted' and t.doc_date <= as_of
    where l.company_id = cid and l.account_id = acct.id and not l.draft
      and (p_project_id is null or l.project_id = p_project_id)
      and (p_currency is null or coalesce(t.currency, 'ILS') = p_currency)
  ),
  -- The year's movements: a line's legs on the account are one movement.
  moves as (
    select g.transaction_id, g.currency, max(g.doc_date) as doc_date, (sign * sum(g.amount_minor))::bigint as amount_minor,
      case when count(distinct g.project_id) = 1 and count(g.project_id) = count(*) then min(g.project_id::text)::uuid end as project_id,
      case when count(distinct g.part) = 1 and count(g.part) = count(*) then min(g.part::text) end as part,
      case when count(distinct g.loan_id) = 1 and count(g.loan_id) = count(*) then min(g.loan_id::text)::uuid end as loan_id
    from legs g
    where g.doc_date >= year_start
    group by g.transaction_id, g.currency
    having sum(g.amount_minor) <> 0
  ),
  page as (
    select m.*, row_number() over (order by m.doc_date desc, m.transaction_id, m.currency) as n
    from moves m
  )
  select jsonb_build_object(
    'account_id', acct.id,
    'name', acct.name,
    'type', acct.type,
    'is_system', acct.is_system,
    'as_of', as_of,
    'year_start', year_start,
    'project_id', p_project_id,
    'project_name', proj_name,
    'currency', p_currency,
    'rule', 'a line''s legs count from its doc_date; posted, non-removed lines; draft legs excluded',
    -- The loans whose parts post here (a loan's principal): the screen links the loan's page.
    'loan_ids', coalesce((select jsonb_agg(distinct g.loan_id) from legs g where g.loan_id is not null), '[]'::jsonb),
    'currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
          'currency', c.currency,
          'opening_minor', c.opening,
          'movement_minor', c.balance - c.opening,
          'balance_minor', c.balance,
          'count', (select count(*) from moves m where m.currency = c.currency)
        ) order by c.currency)
      from (
        select g.currency,
          (sign * coalesce(sum(g.amount_minor) filter (where g.doc_date < year_start), 0))::bigint as opening,
          (sign * sum(g.amount_minor))::bigint as balance
        from legs g
        group by g.currency
      ) c
    ), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
          'transaction_id', pg.transaction_id,
          'doc_date', pg.doc_date,
          'currency', pg.currency,
          'amount_minor', pg.amount_minor,
          'description', t.description,
          'party_name', coalesce(sup.name, cus.name),
          'project_id', pr.id,
          'project_name', pr.name,
          'part', pg.part,
          'loan_id', pg.loan_id,
          'line_amount_minor', t.amount_gross
        ) order by pg.n)
      from page pg
      join public.transactions t on t.id = pg.transaction_id and t.company_id = cid
      left join public.suppliers sup on sup.id = t.supplier_id and sup.company_id = cid
      left join public.customers cus on cus.id = t.customer_id and cus.company_id = cid
      left join public.projects pr on pr.id = pg.project_id and pr.company_id = cid
      where pg.n > off and pg.n <= off + lim
    ), '[]'::jsonb),
    'has_more', exists (select 1 from page pg where pg.n > off + lim)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_account_lines(uuid, date, uuid, text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.get_account_lines(uuid, date, uuid, text, integer, integer) to authenticated;
comment on function public.get_account_lines(uuid, date, uuid, text, integer, integer) is
  'MCP get_account_lines and the reports screen: one balance-sheet account''s balance, opening balance on 1 January of as_of''s year and the year''s movements (one per line, signed as get_balance_sheet shows them), optionally for one project and currency, paged; another company''s account or project is null. FLOW-165.';

-- ---------------------------------------------------------------------------
-- 2. get_breakdown_lines: p_project_id
-- ---------------------------------------------------------------------------
drop function public.get_breakdown_lines(text, text, text, text, date, date, text, boolean, integer, integer);

create function public.get_breakdown_lines(
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
    group by r.transaction_id, r.part, r.shared, case when coalesce(p_excluded, false) then r.drill_key end
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
      row_number() over (order by m.doc_date desc, m.transaction_id, m.part, m.shared, m.category_id nulls first) as n
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
    'count', (select count(*)::integer from page pg)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_breakdown_lines(text, text, text, text, date, date, text, boolean, integer, integer, uuid) from public, anon;
grant execute on function public.get_breakdown_lines(text, text, text, text, date, date, text, boolean, integer, integer, uuid) to authenticated, service_role;

commit;
