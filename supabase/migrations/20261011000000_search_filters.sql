-- FLOW-323, server part. search_transactions gains filters for the transaction search: a
-- doc_date range, a project, a category and a direction, and the pending scope. The text also
-- matches the customer, so income lines are found by payer. Each row says which currency it is
-- in, whether it waits for review, whether it counts in the P&L and how it is split.
-- Decision 0139. The company is still private.readable_company_id(): a caller cannot pass
-- another company, and another company's project or category id matches nothing.
-- Replaces the 4-argument function from 20260930160000_mcp_search.sql; the new arguments all
-- have defaults, so a call with the old ones reads the same lines.

begin;

set local lock_timeout = '5s';

drop function if exists public.search_transactions(text, text, integer, integer);

create function public.search_transactions(
  p_query text default null,
  p_scope text default 'all',
  p_limit integer default 50,
  p_offset integer default 0,
  p_from date default null,
  p_to date default null,
  p_project text default null,
  p_category text default null,
  p_direction text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  lim integer;
  off integer;
  needle text;
  scope text;
  want_project uuid;
  no_project boolean := false;
  want_category uuid;
  no_category boolean := false;
begin
  if p_scope is not null and p_scope not in ('pending', 'filed', 'all') then
    raise exception 'validation';
  end if;
  if p_direction is not null and p_direction not in ('income', 'expense') then
    raise exception 'validation';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'validation';
  end if;
  -- A project or category is an id, or 'none' for lines with none.
  if p_project = 'none' then
    no_project := true;
  elsif p_project is not null then
    if p_project !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'validation';
    end if;
    want_project := p_project::uuid;
  end if;
  if p_category = 'none' then
    no_category := true;
  elsif p_category is not null then
    if p_category !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'validation';
    end if;
    want_category := p_category::uuid;
  end if;

  cid := private.readable_company_id();
  if cid is null then
    return jsonb_build_object('total', 0, 'expenses', '[]'::jsonb);
  end if;
  scope := coalesce(p_scope, 'all');
  lim := least(greatest(coalesce(p_limit, 50), 0), 100);
  off := greatest(coalesce(p_offset, 0), 0);
  -- The text is matched literally: % and _ in it are not wildcards.
  needle := nullif(btrim(coalesce(p_query, '')), '');
  needle := replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_');

  return (
    with matched as (
      select
        t.id,
        t.description,
        t.doc_date,
        t.doc_kind,
        t.amount_net,
        t.vat_amount,
        t.direction,
        t.currency,
        t.amount_original,
        t.line_status,
        t.project_id,
        t.category_id,
        p.name as project_name,
        c.name as category_name,
        s.name as supplier_name,
        cu.name as customer_name,
        waiting.open as waiting_review
      from public.transactions t
      left join public.projects p on p.id = t.project_id
      left join public.categories c on c.id = t.category_id
      left join public.suppliers s on s.id = t.supplier_id
      left join public.customers cu on cu.id = t.customer_id
      cross join lateral (
        select exists (
          select 1
          from public.review_queue q
          where q.transaction_id = t.id
            and q.company_id = cid
            and q.status = 'open'
        ) as open
      ) waiting
      where t.company_id = cid
        and t.removed_at is null
        and (
          scope = 'all'
          or (scope = 'pending' and waiting.open)
          or (scope = 'filed' and not waiting.open)
        )
        and (p_from is null or t.doc_date >= p_from)
        and (p_to is null or t.doc_date <= p_to)
        and (p_direction is null or t.direction::text = p_direction)
        and (
          needle is null
          or t.description ilike '%' || needle || '%'
          or coalesce(s.name, '') ilike '%' || needle || '%'
          or coalesce(cu.name, '') ilike '%' || needle || '%'
        )
        -- A project: the line's own, a share of a shared cost, or a split part on it. A split
        -- part with no project is on the line's project (0138), so the line's own covers it.
        and (
          want_project is null
          or t.project_id = want_project
          or exists (
            select 1 from public.allocations a
            where a.transaction_id = t.id and a.company_id = cid and a.project_id = want_project
          )
          or exists (
            select 1 from public.line_splits sp
            where sp.transaction_id = t.id and sp.company_id = cid and sp.project_id = want_project
          )
        )
        and (
          not no_project
          or (
            t.project_id is null
            and not exists (
              select 1 from public.allocations a
              where a.transaction_id = t.id and a.company_id = cid
            )
            and not exists (
              select 1 from public.line_splits sp
              where sp.transaction_id = t.id and sp.company_id = cid and sp.project_id is not null
            )
          )
        )
        -- A category: the line's own, or a part of its line split or its loan split.
        and (
          want_category is null
          or t.category_id = want_category
          or exists (
            select 1 from public.line_splits sp
            where sp.transaction_id = t.id and sp.company_id = cid and sp.category_id = want_category
          )
          or exists (
            select 1 from public.loan_splits ls
            where ls.transaction_id = t.id and ls.company_id = cid and ls.category_id = want_category
          )
        )
        and (
          not no_category
          or (
            t.category_id is null
            and not exists (
              select 1 from public.line_splits sp
              where sp.transaction_id = t.id and sp.company_id = cid
            )
            and not exists (
              select 1 from public.loan_splits ls
              where ls.transaction_id = t.id and ls.company_id = cid
            )
          )
        )
    )
    select jsonb_build_object(
      'total', (select count(*) from matched),
      'expenses', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', page.id,
          'description', page.description,
          'doc_date', page.doc_date,
          'doc_kind', page.doc_kind,
          'amount_net', page.amount_net,
          'vat_agorot', page.vat_amount,
          'direction', page.direction,
          'currency', page.currency,
          'amount_original', page.amount_original,
          'line_status', page.line_status,
          'project_id', page.project_id,
          'category_id', page.category_id,
          'project_name', page.project_name,
          'category_name', page.category_name,
          'supplier_name', page.supplier_name,
          'customer_name', page.customer_name,
          'waiting_review', page.waiting_review,
          'kept_out', private.line_pnl_state(page.id) = 'out',
          'split_parts', (
            select count(*)::int from public.line_splits sp
            where sp.transaction_id = page.id and sp.company_id = cid
          ),
          'loan_matched', exists (
            select 1 from public.loan_splits ls
            where ls.transaction_id = page.id and ls.company_id = cid
          )
        ) order by page.doc_date desc, page.description, page.id)
        from (
          select *
          from matched
          order by doc_date desc, description, id
          limit lim
          offset off
        ) page
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.search_transactions(text, text, integer, integer, date, date, text, text, text)
  from public, anon;
grant execute on function public.search_transactions(text, text, integer, integer, date, date, text, text, text)
  to authenticated, service_role;

commit;
