-- FLOW-984. Review loads its open items in pages.
--   public.list_review_page(p_limit, p_after_date, p_after_created, p_after_id, p_project) returns
--   {items, total, next}: the next page of open review items after a cursor (doc date, created at, id),
--   the total open count (of the project when p_project is given) and the cursor of the page after, or
--   null on the last page. A cursor missing any of its three parts reads from the start. p_item reads that one
--   open item (a link to a card the app has not loaded yet) and nothing else. The page is chosen
--   first, from the queue and its lines alone; the per-row parts
--   (the share count, the receipts, the kept-out state, the forecast match) then run for those rows only.
--   private.review_row_items(p_ids) is the row body, taken out of list_review() unchanged so the two reads
--   cannot drift; list_review() now calls it for every open row and returns the same array as before.
--   private.review_forecast_matches takes the lines to match (the zero-argument one had no other caller).
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.
begin;
set local lock_timeout = '5s';

create or replace function private.review_forecast_matches(p_ids uuid[])
 returns table(transaction_id uuid, forecast_match jsonb)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select f.transaction_id, jsonb_build_object(
    'month', f.month,
    'amount_minor', f.amount_minor,
    'category_name', f.category_name,
    'project_name', f.project_name
  )
  from private.forecast_match_rows(private.readable_company_id(), p_ids) f;
$function$;

revoke all on function private.review_forecast_matches(uuid[]) from public, anon;
grant execute on function private.review_forecast_matches(uuid[]) to authenticated, service_role;

create or replace function private.review_row_items(p_ids uuid[])
 returns table(q_id uuid, sort_date date, sort_created timestamptz, item jsonb)
 language sql
 stable
 set search_path to ''
as $function$
  with picked as materialized (
    select coalesce(array_agg(x.transaction_id), array[]::uuid[]) as tx
    from public.review_queue x
    where x.id = any(p_ids)
      and x.company_id = (select private.readable_company_id())
      and x.status = 'open'
  )
  select q.id, t.doc_date, q.created_at, jsonb_build_object(
    'id', q.id,
    'company_id', q.company_id,
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
    'assistant_filed_today', filed.assistant,
    'receipts', coalesce(pair.receipts, '[]'::jsonb),
    'paid', coalesce(
      pair.receipts is not null
        and t.amount_gross + pair.credit_gross - pair.receipt_gross <= 0,
      false
    ),
    'paid_on', pair.paid_on,
    'forecast_match', fm.forecast_match
  )
  from public.review_queue q
  -- The lines filed today, read once for the whole list (it was read twice).
  cross join (
    select count(*)::int as n, coalesce(bool_or(f.assistant), false) as assistant
    from private.filed_today_rows() f
  ) filed
  left join (
    select st.transaction_id, st.state
    from private.line_pnl_states((select picked.tx from picked)) st
  ) kept on kept.transaction_id = q.transaction_id
  -- Decision 0187: the forecast line the user added that this line is.
  left join private.review_forecast_matches((select picked.tx from picked)) fm on fm.transaction_id = q.transaction_id
  join public.transactions t on t.id = q.transaction_id
  left join public.suppliers s on s.id = t.supplier_id
  left join public.customers cu on cu.id = t.customer_id and cu.company_id = t.company_id
  left join public.projects p on p.id = t.project_id
  left join public.categories c on c.id = t.category_id
  -- FLOW-309: the invoice's receipts (the matching rule in private.invoice_receipts).
  left join lateral (
    select
      jsonb_agg(jsonb_build_object(
        'transaction_id', r.id,
        'doc_date', r.doc_date,
        'amount_gross', r.amount_gross,
        'currency', r.currency
      ) order by r.doc_date, r.id) as receipts,
      sum(r.amount_gross)::bigint as receipt_gross,
      max(r.doc_date) as paid_on,
      coalesce((
        select sum(cred.amount_gross)::bigint
        from public.transactions cred
        where cred.company_id = t.company_id
          and cred.removed_at is null
          and cred.doc_kind = 'credit'
          and cred.linked_external_id = t.external_id
      ), 0) as credit_gross
    from public.transactions r
    where t.direction = 'income'
      and t.doc_kind = 'invoice'
      and t.external_id is not null
      and private.is_connector_source(t.source)
      and r.company_id = t.company_id
      and r.source = t.source
      and r.linked_external_id = t.external_id
      and r.direction = 'income'
      and r.doc_kind = 'receipt'
      and r.removed_at is null
      and r.line_status <> 'void'
    having count(*) > 0
  ) pair on true
  where q.id = any(p_ids)
    and q.company_id = (select private.readable_company_id())
    and q.status = 'open'
    and t.removed_at is null
    and t.line_status <> 'pending';
$function$;

revoke all on function private.review_row_items(uuid[]) from public, anon;
grant execute on function private.review_row_items(uuid[]) to authenticated, service_role;

-- The zero-argument read keeps its answer: the same rows, built by the same body, in the same order. Rows
-- that share a date and a created-at (a bulk import) had no set order; they now follow by id, as the pages do.
create or replace function public.list_review()
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$
  select coalesce(jsonb_agg(r.item order by r.sort_date, r.sort_created, r.q_id), '[]'::jsonb)
  from private.review_row_items(array(
    select open_row.id
    from public.review_queue open_row
    where open_row.company_id = (select private.readable_company_id())
      and open_row.status = 'open'
  )) r;
$function$;

drop function if exists private.review_forecast_matches();

create or replace function public.list_review_page(
  p_limit integer default 50,
  p_after_date date default null,
  p_after_created timestamptz default null,
  p_after_id uuid default null,
  p_project uuid default null,
  p_item uuid default null
)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  lim constant integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  page_ids uuid[];
  more boolean;
  last_row jsonb;
  open_total bigint;
  shown jsonb;
begin
  -- The page, chosen from the queue and its lines alone: lim rows after the cursor, and one more to
  -- know whether a page follows.
  with eligible as (
    select q.id, q.created_at, t.doc_date
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where q.company_id = (select private.readable_company_id())
      and q.status = 'open'
      and t.removed_at is null
      and t.line_status <> 'pending'
      and (p_project is null or t.project_id = p_project)
  ), page as (
    select e.id, e.created_at, e.doc_date,
      row_number() over (order by e.doc_date, e.created_at, e.id) as rn
    from eligible e
    where case
      -- One open item by its review id (a link to a card the app has not loaded): just that row.
      when p_item is not null then e.id = p_item
      else num_nulls(p_after_date, p_after_created, p_after_id) > 0
        or (e.doc_date, e.created_at, e.id) > (p_after_date, p_after_created, p_after_id)
    end
    order by e.doc_date, e.created_at, e.id
    limit lim + 1
  )
  select
    array(select page.id from page where page.rn <= lim order by page.rn),
    exists (select 1 from page where page.rn > lim),
    (select jsonb_build_object('doc_date', page.doc_date, 'created_at', page.created_at, 'id', page.id)
      from page where page.rn = lim),
    (select count(*) from eligible)
  into page_ids, more, last_row, open_total;
  select coalesce(jsonb_agg(r.item order by r.sort_date, r.sort_created, r.q_id), '[]'::jsonb)
  into shown
  from private.review_row_items(page_ids) r;
  return jsonb_build_object(
    'items', shown,
    'total', open_total,
    'next', case when more then last_row end
  );
end;
$function$;

revoke all on function public.list_review_page(integer, date, timestamptz, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_review_page(integer, date, timestamptz, uuid, uuid, uuid) to authenticated, service_role;

commit;
