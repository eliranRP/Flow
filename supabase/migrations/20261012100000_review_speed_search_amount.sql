-- list_review timed out (statement timeout, 500) when two loads of a 586-line queue overlapped
-- (Production QA, 2026-10-08). Each open line called private.line_pnl_state for kept_out, and
-- under row security the planner read private.pnl_lines through a scan of the company's lines
-- instead of the line's own index: about 11 ms a line. line_pnl_state becomes security definer
-- with the caller's company checked in its own where clause, a new private.line_pnl_states gives
-- the same answer for a set of lines in one read, and list_review uses it and reads the lines
-- filed today once instead of twice. Decision 0155.
--
-- FLOW-211 (from the Flow MCP agent): search_transactions finds a line by its amount, the bank
-- figure without its sign, exact or within a range (p_amount_min, p_amount_max), and each row
-- carries amount_gross. The new arguments have defaults, so the app's calls read as before.

begin;

set local lock_timeout = '5s';

create or replace function private.line_pnl_state(p_transaction_id uuid, p_project_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid)
 RETURNS text
 language sql
 stable
 security definer
 set search_path = ''
as $function$
  select case
    when t.line_status = 'posted' then coalesce(
      -- The parts on this project and category, when the caller names them. A shared line's
      -- parts sit on the line's own project, so they match the category alone.
      (
        select case
          when bool_and(pl.in_pnl) then 'in'
          when not bool_or(pl.in_pnl) then 'out'
          else 'mixed'
        end
        from private.pnl_lines pl
        where pl.transaction_id = t.id
          and (p_project_id is not null or p_category_id is not null)
          and (p_project_id is null or pl.project_id = p_project_id or pl.pnl_role = 'shared')
          and (p_category_id is null or pl.category_id = p_category_id)
        having count(*) > 0
      ),
      -- Every part of the line.
      (
        select case
          when bool_and(pl.in_pnl) then 'in'
          when not bool_or(pl.in_pnl) then 'out'
          else 'mixed'
        end
        from private.pnl_lines pl
        where pl.transaction_id = t.id
        having count(*) > 0
      ),
      pending.state
    )
    else pending.state
  end
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  -- A pending line, which pnl_lines does not hold yet, follows the line rule in_pnl uses.
  cross join lateral (
    select case when private.line_in_pnl(
      case when not exists (
        select 1 from public.loan_splits ls where ls.transaction_id = t.id and ls.company_id = t.company_id
      ) then t.in_pnl_override end,
      private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
      c.loan_part
    ) then 'in' else 'out' end as state
  ) pending
  where t.id = p_transaction_id
    -- Definer, so the reads skip row security, which kept the planner off the line's own index
    -- (11 ms a line on a 3,600-line company). The caller still sees only its own company.
    and (auth.role() = 'service_role' or t.company_id = private.readable_company_id());
$function$;

revoke all on function private.line_pnl_state(uuid, uuid, uuid) from public, anon;
grant execute on function private.line_pnl_state(uuid, uuid, uuid) to authenticated, service_role;

-- The same state for a set of lines in one read of private.pnl_lines: list_review asks for
-- every open line at once instead of one call each.
create or replace function private.line_pnl_states(p_ids uuid[])
returns table (transaction_id uuid, state text)
language sql
stable
security definer
set search_path = ''
as $function$
  select t.id,
    case
      when t.line_status = 'posted' then coalesce(parts.state, pending.state)
      else pending.state
    end
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  left join (
    select pl.transaction_id,
      case
        when bool_and(pl.in_pnl) then 'in'
        when not bool_or(pl.in_pnl) then 'out'
        else 'mixed'
      end as state
    from private.pnl_lines pl
    where pl.transaction_id = any(p_ids)
    group by pl.transaction_id
  ) parts on parts.transaction_id = t.id
  -- A pending line, which pnl_lines does not hold yet, follows the line rule in_pnl uses.
  cross join lateral (
    select case when private.line_in_pnl(
      case when not exists (
        select 1 from public.loan_splits ls where ls.transaction_id = t.id and ls.company_id = t.company_id
      ) then t.in_pnl_override end,
      private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
      c.loan_part
    ) then 'in' else 'out' end as state
  ) pending
  where t.id = any(p_ids)
    and (auth.role() = 'service_role' or t.company_id = private.readable_company_id());
$function$;

revoke all on function private.line_pnl_states(uuid[]) from public, anon;
grant execute on function private.line_pnl_states(uuid[]) to authenticated, service_role;

create or replace function public.list_review()
 RETURNS jsonb
 language sql
 stable
 set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'transaction_id', t.id,
    'description', t.description,
    'doc_date', t.doc_date,
    'doc_kind', t.doc_kind,
    'amount_net', t.amount_net,
    'amount_original', t.amount_original,
    'currency', t.currency,
    'vat_agorot', t.vat_amount,
    'direction', t.direction,
    'line_status', t.line_status,
    'source', t.source,
    'kept_out', kept.state = 'out',
    'reason', q.reason,
    'pnl_role', t.pnl_role,
    'share_count', (
      select count(*)::int
      from public.allocations a
      where a.transaction_id = t.id
    ),
    'project_id', t.project_id,
    'category_id', t.category_id,
    'project_name', p.name,
    'category_name', c.name,
    'category_suggested', t.category_suggested,
    'project_suggested', (
      t.project_id is not null
      and not t.user_assigned
      and not t.project_assigned
      and coalesce(t.pnl_role, 'project') is distinct from 'shared'
      and (
        select count(*)
        from public.allocations a
        where a.transaction_id = t.id
          and a.company_id = t.company_id
      ) <= 1
      and not exists (
        select 1
        from public.suppliers sp
        where sp.id = t.supplier_id
          and sp.company_id = t.company_id
          and sp.remembered_project_id = t.project_id
      )
    ),
    'confidence', null,
    'supplier_name', s.name,
    'customer_name', cu.name,
    'auto_approved_today', filed.n,
    'assistant_filed_today', filed.assistant
  ) order by t.doc_date, q.created_at), '[]'::jsonb)
  from public.review_queue q
  -- The lines filed today, read once for the whole list (it was read twice).
  cross join (
    select count(*)::int as n, coalesce(bool_or(f.assistant), false) as assistant
    from private.filed_today_rows() f
  ) filed
  left join (
    select st.transaction_id, st.state
    from private.line_pnl_states(array(
      select open_row.transaction_id
      from public.review_queue open_row
      where open_row.company_id = (select private.readable_company_id())
        and open_row.status = 'open'
    )) st
  ) kept on kept.transaction_id = q.transaction_id
  join public.transactions t on t.id = q.transaction_id
  left join public.suppliers s on s.id = t.supplier_id
  left join public.customers cu on cu.id = t.customer_id and cu.company_id = t.company_id
  left join public.projects p on p.id = t.project_id
  left join public.categories c on c.id = t.category_id
  where q.company_id = (select private.readable_company_id())
    and q.status = 'open'
    and t.removed_at is null;
$function$;

revoke all on function public.list_review() from public, anon;
grant execute on function public.list_review() to authenticated, service_role;

drop function if exists public.search_transactions(text, text, integer, integer, date, date, text, text, text);

create function public.search_transactions(
  p_query text default null,
  p_scope text default 'all',
  p_limit integer default 50,
  p_offset integer default 0,
  p_from date default null,
  p_to date default null,
  p_project text default null,
  p_category text default null,
  p_direction text default null,
  p_amount_min bigint default null,
  p_amount_max bigint default null
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
  -- An amount is the line's bank amount (gross) without its sign, in minor units of the line's
  -- own currency; both ends are included, so min = max finds one figure (FLOW-211).
  if p_amount_min < 0 or p_amount_max < 0
     or (p_amount_min is not null and p_amount_max is not null and p_amount_min > p_amount_max) then
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
        t.amount_gross,
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
        and (p_amount_min is null or abs(t.amount_gross) >= p_amount_min)
        and (p_amount_max is null or abs(t.amount_gross) <= p_amount_max)
        and (
          needle is null
          or t.description ilike '%' || needle || '%'
          or coalesce(s.name, '') ilike '%' || needle || '%'
          or coalesce(cu.name, '') ilike '%' || needle || '%'
        )
        -- A project: the line's own, a share of a shared cost, or a split part on it. A split
        -- part with no project is on the line's project (0138); a line split whose parts all
        -- name a project holds none of it on the line's own.
        and (
          want_project is null
          or (
            t.project_id = want_project
            and not exists (
              select 1 from public.line_splits sp
              where sp.transaction_id = t.id and sp.company_id = cid
              having bool_and(sp.project_id is not null)
            )
          )
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
        -- A category: the line's own, or a part of its line split or its loan split. A split
        -- line counts by its parts, so its own category matches only through a part. A loan
        -- payment with a part waiting for review counts whole under its own category (0136).
        and (
          want_category is null
          or (
            t.category_id = want_category
            and not exists (
              select 1 from public.line_splits sp
              where sp.transaction_id = t.id and sp.company_id = cid
            )
            and not exists (
              select 1 from public.loan_splits ls
              where ls.transaction_id = t.id and ls.company_id = cid
              having not bool_or(ls.needs_review)
            )
          )
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
          'amount_gross', page.amount_gross,
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

revoke all on function public.search_transactions(text, text, integer, integer, date, date, text, text, text, bigint, bigint)
  from public, anon;
grant execute on function public.search_transactions(text, text, integer, integer, date, date, text, text, text, bigint, bigint)
  to authenticated, service_role;

commit;
