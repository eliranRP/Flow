-- FLOW-309 (Eliran 2026-10-08: skipped cards get a list and an undo).
-- 1. list_skipped_review: the skipped cards, newest first, for a דולגו section under הצג הכול.
-- 2. reopen_review on a skipped row only reopens it. A skip changed nothing on the line, so
--    restoring its snapshot could only undo edits made since. reopen_review is otherwise as in
--    20261008033000_review_undo_followups.sql; grants are kept by create or replace.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function public.reopen_review(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  txn uuid;
  item_status public.review_status;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_cat_assigned boolean;
  prior_shares jsonb;
  prior_remembered uuid;
  written uuid;
  supplier uuid;
  item jsonb;
  updated int;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;

  select q.transaction_id
  into txn
  from public.review_queue q
  where q.id = p_id
    and q.company_id = cid;
  if txn is null then
    raise exception 'review item not found';
  end if;

  select t.supplier_id
  into supplier
  from public.transactions t
  where t.id = txn and t.company_id = cid
  for update;
  if not found then
    raise exception 'review item not found';
  end if;

  select q.prior_project_id, q.prior_category_id, q.prior_pnl_role,
         q.prior_user_assigned, q.prior_category_suggested, q.prior_allocations,
         q.prior_remembered_category_id, q.written_remembered_category_id, q.status, q.prior_category_assigned
  into prior_project, prior_category, prior_role, prior_assigned, prior_suggested, prior_shares,
       prior_remembered, written, item_status, prior_cat_assigned
  from public.review_queue q
  where q.id = p_id
    and q.company_id = cid
  for update;
  if item_status is null or item_status not in ('approved', 'skipped', 'changed') then
    raise exception 'review item not found';
  end if;

  -- FLOW-309: a skip changed nothing on the line, so reopening it only puts the card back.
  -- Restoring the skip-time snapshot would undo edits the owner made since (the skipped list
  -- can reopen a card long after the skip).
  if item_status = 'skipped' then
    update public.review_queue
    set status = 'open',
        resolved_at = null
    where id = p_id and company_id = cid;
    return;
  end if;

  update public.transactions
  set project_id = prior_project,
      category_id = prior_category,
      pnl_role = prior_role,
      user_assigned = coalesce(prior_assigned, false),
      category_suggested = coalesce(prior_suggested, false),
      -- The flag from before the write (FLOW-208). Older snapshots have none: a suggested or
      -- empty category was not the owner's pick, so clear the flag a write set.
      category_assigned = case
        when prior_cat_assigned is not null then prior_cat_assigned
        when coalesce(prior_suggested, false) or prior_category is null then false
        else category_assigned
      end
  where id = txn and company_id = cid;
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'review item not found';
  end if;

  delete from public.allocations where transaction_id = txn and company_id = cid;
  if prior_shares is not null and jsonb_typeof(prior_shares) = 'array' then
    for item in select value from jsonb_array_elements(prior_shares)
    loop
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      values (
        cid,
        txn,
        (item->>'project_id')::uuid,
        (item->>'share_bp')::integer,
        (item->>'amount_net')::bigint
      );
    end loop;
  end if;

  delete from public.overhead where transaction_id = txn and company_id = cid;
  if prior_role = 'overhead' then
    insert into public.overhead (company_id, transaction_id) values (cid, txn);
  end if;

  if supplier is not null and written is not null then
    update public.suppliers
    set remembered_category_id = prior_remembered
    where id = supplier
      and company_id = cid
      and remembered_category_id is not distinct from written;
  end if;

  update public.review_queue
  set status = 'open',
      resolved_at = null
  where id = p_id and company_id = cid;
end;
$function$;

-- Skipped review cards, newest skip first, for the דולגו list. Only a line's latest row, so a
-- card that came back or was settled later is not listed. reopen_review puts one back.
create or replace function public.list_skipped_review()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'transaction_id', t.id,
    'description', t.description,
    'doc_date', t.doc_date,
    'doc_kind', t.doc_kind,
    'amount_net', t.amount_net,
    'amount_original', t.amount_original,
    'currency', t.currency,
    'direction', t.direction,
    'line_status', t.line_status,
    'source', t.source,
    'project_id', t.project_id,
    'category_id', t.category_id,
    'project_name', p.name,
    'category_name', c.name,
    'supplier_name', s.name,
    'skipped_at', q.resolved_at
  ) order by q.resolved_at desc nulls last, q.id), '[]'::jsonb)
  from public.review_queue q
  join public.transactions t on t.id = q.transaction_id
  left join public.suppliers s on s.id = t.supplier_id
  left join public.projects p on p.id = t.project_id
  left join public.categories c on c.id = t.category_id
  where q.company_id = (select private.current_company_id())
    and q.status = 'skipped'
    and t.removed_at is null
    and t.line_status <> 'void'
    and not exists (
      select 1 from public.review_queue newer
      where newer.transaction_id = q.transaction_id
        and newer.created_at > q.created_at
    );
$$;

revoke all on function public.list_skipped_review() from public, anon;
grant execute on function public.list_skipped_review() to authenticated, service_role;

commit;
