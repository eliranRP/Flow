-- Faster recurring and project reads, with the same results.
-- - private.recurring_stream_lines: a line with no project joins the charge of the party's project whose
--   latest filed amount is closest. That was a subquery per line, which Postgres ran by scanning and sorting
--   every line again for each one (about 640 times on an 800-line company). The projects filed are now read
--   once (filed, materialized) and each projectless line's pick is one set-based distinct on, ordered as the
--   subquery's order by ... limit 1 was. Every reader of the stream lines follows: recurring_parties,
--   payment_recurring_state, the arrivals and changes, expected months, the schedule, project changes,
--   missing bills and party charges. The body is 20261019063254's otherwise.
-- - private.line_pnl_states(ids, project, category): line_pnl_state for a set of lines read once, scoped to a
--   project and category as line_pnl_state(id, project, category) is. project_waiting and
--   list_project_category called line_pnl_state once per row; they read this once instead. Their bodies are
--   20261018085732's and the live 20261010180000 one otherwise.
begin;
set local lock_timeout = '5s';

-- The stream lines (decisions 0185, 0189), set-based: the same rows and the same stream project.
create or replace function private.recurring_stream_lines(p_company uuid, p_today date)
returns table(id uuid, direction public.txn_direction, party_id uuid, currency text, doc_date date,
  created_at timestamptz, amount_net bigint, project_id uuid, category_id uuid, stream_project uuid)
language sql
stable
security definer
set search_path = ''
as $function$
  with lines as (
    select lp.id, lp.direction, lp.party_id, lp.currency, lp.doc_date, lp.created_at, lp.amount_net,
      lp.project_id, lp.category_id
    from private.recurring_line_parts(p_company, (date_trunc('month', p_today) - interval '24 months')::date, p_today) lp
  ),
  -- Each project a party's filed lines went to, with its latest filed amount (of one line's parts, the largest).
  -- Materialized, so it is built once and not again for each line below.
  filed as materialized (
    select distinct on (l.direction, l.party_id, l.currency, l.project_id)
      l.direction, l.party_id, l.currency, l.project_id, abs(l.amount_net) as amount, l.doc_date
    from lines l
    where l.project_id is not null
    order by l.direction, l.party_id, l.currency, l.project_id, l.doc_date desc, l.created_at desc, abs(l.amount_net) desc
  ),
  -- A line with no project joins the party's project whose latest filed amount is closest, then the latest
  -- filed, then the lowest id. The pick depends only on the line's party and amount, so it is keyed by both.
  pick as (
    select distinct on (l.id, l.amount_net) l.id, l.amount_net, f.project_id
    from lines l
    join filed f on f.direction = l.direction and f.party_id = l.party_id and f.currency = l.currency
    where l.project_id is null
    order by l.id, l.amount_net, abs(f.amount - abs(l.amount_net)), f.doc_date desc, f.project_id
  )
  select l.id, l.direction, l.party_id, l.currency, l.doc_date, l.created_at, l.amount_net, l.project_id, l.category_id,
    coalesce(l.project_id, p.project_id) as stream_project
  from lines l
  left join pick p on l.project_id is null and p.id = l.id and p.amount_net = l.amount_net;
$function$;

revoke all on function private.recurring_stream_lines(uuid, date) from public, anon, authenticated;

-- line_pnl_state(id, project, category) for a set of lines, in one read of private.pnl_lines. A line's parts
-- on the project (a shared line's parts match any project) and category give its state when it has any;
-- else every part of the line; a line pnl_lines does not hold yet follows the line rule in_pnl uses.
create or replace function private.line_pnl_states(p_ids uuid[], p_project_id uuid, p_category_id uuid)
returns table (transaction_id uuid, state text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  -- Executed, so each call is planned for its own ids. The parts' states are one id-keyed map
  -- read once, so the lines never nested-loop against them.
  return query execute $q$
    with parts as (
      select pl.transaction_id,
        case
          when count(*) filter (where scoped.on_it) = 0 then null
          when bool_and(pl.in_pnl) filter (where scoped.on_it) then 'in'
          when not bool_or(pl.in_pnl) filter (where scoped.on_it) then 'out'
          else 'mixed'
        end as scoped_state,
        case
          when bool_and(pl.in_pnl) then 'in'
          when not bool_or(pl.in_pnl) then 'out'
          else 'mixed'
        end as state
      from private.pnl_lines pl
      cross join lateral (
        select ($2 is not null or $3 is not null)
          and ($2 is null or pl.project_id = $2 or pl.pnl_role = 'shared')
          and ($3 is null or pl.category_id = $3) as on_it
      ) scoped
      where pl.transaction_id = any($1)
      group by pl.transaction_id
    ),
    states as (
      select coalesce(jsonb_object_agg(p.transaction_id, coalesce(p.scoped_state, p.state)), '{}'::jsonb) as map
      from parts p
    )
    select t.id,
      case
        when t.line_status = 'posted' then coalesce((select s.map from states s) ->> t.id::text, pending.state)
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
    where t.id = any($1)
      and ((select auth.role()) = 'service_role' or t.company_id = (select private.readable_company_id()))
  $q$ using p_ids, p_project_id, p_category_id;
end;
$function$;

revoke all on function private.line_pnl_states(uuid[], uuid, uuid) from public, anon;
grant execute on function private.line_pnl_states(uuid[], uuid, uuid) to authenticated, service_role;

-- A project's waiting lines: kept_out read for every row at once.
create or replace function public.project_waiting(p_project uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with held as (
    select t.id as transaction_id, jsonb_build_object(
      'review_id', q.id,
      'transaction_id', t.id,
      'description', t.description,
      'doc_date', t.doc_date,
      'amount_net', t.amount_net,
      'direction', t.direction,
      'reason', q.reason,
      'project_id', t.project_id,
      'category_id', t.category_id,
      'category_name', c.name,
      'supplier_name', s.name,
    'currency', t.currency,
    'source', t.source
    ) as item
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    left join public.categories c on c.id = t.category_id
    left join public.suppliers s on s.id = t.supplier_id
    where q.company_id = (select private.readable_company_id())
      and q.status = 'open'
      and t.removed_at is null
      and t.line_status <> 'pending'
      and t.project_id = p_project
      and t.direction = 'expense'
      and t.pnl_role = 'project'
    union all
    select t.id, jsonb_build_object(
      'review_id', null,
      'transaction_id', t.id,
      'description', t.description,
      'doc_date', t.doc_date,
      'amount_net', t.amount_net,
      'direction', t.direction,
      'reason', 'suggested',
      'project_id', t.project_id,
      'category_id', t.category_id,
      'category_name', c.name,
      'supplier_name', s.name,
    'currency', t.currency,
    'source', t.source
    )
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    left join public.suppliers s on s.id = t.supplier_id
    where t.company_id = (select private.readable_company_id())
      and t.project_id = p_project
      and t.direction = 'expense'
      and t.pnl_role = 'project'
      and t.removed_at is null
      and t.line_status <> 'pending'
      and t.category_suggested
      and not exists (
        select 1
        from public.review_queue q
        where q.transaction_id = t.id
          and q.company_id = t.company_id
          and q.status = 'open'
      )
  ),
  states as (
    select st.transaction_id, st.state
    from private.line_pnl_states(array(select h.transaction_id from held h), p_project, null) st
  )
  select coalesce(jsonb_agg(item order by item->>'doc_date', item->>'description'), '[]'::jsonb)
  from (
    select h.item || jsonb_build_object('kept_out', st.state = 'out') as item
    from held h
    left join states st on st.transaction_id = h.transaction_id
  ) waiting;
$function$;

revoke all on function public.project_waiting(uuid) from public, anon;
grant execute on function public.project_waiting(uuid) to authenticated, service_role;

-- A project category's lines: kept_out read for the page at once.
create or replace function public.list_project_category(p_project uuid, p_category uuid, p_offset integer DEFAULT 0, p_limit integer DEFAULT 40, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_basis text DEFAULT NULL::text, p_currency text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  off integer;
  lim integer;
  total bigint;
  n bigint;
  listed jsonb;
  basis text;
  cur text;
begin
  cid := private.readable_company_id();
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
  basis := private.pnl_basis(cid, p_basis);
  cur := coalesce(
    upper(nullif(btrim(p_currency), '')),
    (
      select e.currency
      from private.project_category_entries_by_currency(p_project) e
      where e.category_id = p_category
      order by e.currency <> 'ILS', e.currency
      limit 1
    ),
    'ILS'
  );
  off := greatest(coalesce(p_offset, 0), 0);
  lim := least(greatest(coalesce(p_limit, 40), 1), 100);
  select coalesce((-sum(e.amount_net))::bigint, 0), count(*)::bigint
    into total, n
  from private.project_category_entries_by_currency(p_project) e
  join public.transactions lt on lt.id = e.transaction_id
  where e.category_id = p_category and e.currency = cur
    and (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
    and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to);
  with page as (
    select e.transaction_id, e.description, e.doc_date, e.amount_net, e.created_at, lt.source
    from private.project_category_entries_by_currency(p_project) e
    join public.transactions lt on lt.id = e.transaction_id
    where e.category_id = p_category and e.currency = cur
      and (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
      and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to)
    order by e.doc_date desc, e.created_at desc, e.transaction_id
    offset off
    limit lim
  ),
  states as (
    select st.transaction_id, st.state
    from private.line_pnl_states(array(select pg.transaction_id from page pg), p_project, p_category) st
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page.transaction_id,
    'description', page.description,
    'doc_date', page.doc_date,
    'amount_net', page.amount_net,
    'source', page.source,
    'kept_out', st.state = 'out'
  ) order by page.doc_date desc, page.created_at desc, page.transaction_id), '[]'::jsonb)
  into listed
  from page
  left join states st on st.transaction_id = page.transaction_id;
  return jsonb_build_object(
    'category_name', (select c.name from public.categories c where c.id = p_category),
    'project_name', (select p.name from public.projects p where p.id = p_project),
    'from', case when p_from is null or p_to is null then null else p_from end,
    'to', case when p_from is null or p_to is null then null else p_to end,
    'basis', basis,
    'currency', cur,
    'total_agorot', total,
    'rows', listed,
    'next_offset', case when n > off + lim then off + lim else null end
  );
end;
$function$;

revoke all on function public.list_project_category(uuid, uuid, integer, integer, date, date, text, text) from public, anon;
grant execute on function public.list_project_category(uuid, uuid, integer, integer, date, date, text, text) to authenticated, service_role;

commit;
