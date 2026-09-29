-- Decision 0076. Append-only.
-- A split expense can return to one project. The full net moves onto that
-- project, the other shares go, and ביטול uses the same undo row as a
-- reassignment. save_split with one share already sets pnl_role, but it
-- returns nothing and writes no undo. reassign_transaction refuses a shared row.

create or replace function public.collapse_split(
  p_id uuid,
  p_project_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  direction public.txn_direction;
  net bigint;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_shares jsonb;
  share_count integer;
  review_id uuid;
  undo_id uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select t.direction, t.amount_net, t.project_id, t.category_id, t.pnl_role, t.user_assigned, t.category_suggested
  into direction, net, prior_project, prior_category, prior_role, prior_assigned, prior_suggested
  from public.transactions t
  where t.id = p_id and t.company_id = cid and t.removed_at is null
  for update;
  if direction is null then
    raise exception 'transaction not found';
  end if;
  if direction <> 'expense' then
    raise exception 'income is not split';
  end if;
  if p_project_id is null or not exists (
    select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
  ) then
    raise exception 'project not found';
  end if;

  select count(*)::integer into share_count
  from public.allocations a
  where a.transaction_id = p_id;

  if prior_role is distinct from 'shared'
    and share_count <= 1
    and not exists (
      select 1
      from public.review_queue q
      where q.transaction_id = p_id
        and q.company_id = cid
        and q.status = 'open'
        and q.reason = 'unallocated_shared'
    )
  then
    raise exception 'transaction is not split';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  )), '[]'::jsonb)
  into prior_shares
  from public.allocations a
  where a.transaction_id = p_id;

  select q.id into review_id
  from public.review_queue q
  where q.transaction_id = p_id
    and q.company_id = cid
    and q.status = 'open'
    and q.reason = 'unallocated_shared'
  order by q.created_at desc
  limit 1;

  delete from public.allocations where transaction_id = p_id and company_id = cid;
  delete from public.overhead where transaction_id = p_id and company_id = cid;

  update public.transactions
  set project_id = p_project_id,
      pnl_role = 'project',
      user_assigned = true
  where id = p_id and company_id = cid;

  insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
  values (cid, p_id, p_project_id, 10000, net);

  if review_id is not null then
    update public.review_queue
    set status = 'changed',
        resolved_at = now(),
        prior_project_id = prior_project,
        prior_category_id = prior_category,
        prior_pnl_role = prior_role,
        prior_user_assigned = prior_assigned,
        prior_category_suggested = prior_suggested,
        prior_allocations = prior_shares
    where id = review_id and company_id = cid;
  end if;

  insert into public.reassign_undo (
    company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
    prior_user_assigned, prior_category_suggested, prior_allocations, prior_review_id
  ) values (
    cid, p_id, prior_project, prior_category, prior_role,
    coalesce(prior_assigned, false), prior_suggested, prior_shares, review_id
  )
  returning id into undo_id;
  return undo_id;
end;
$$;

revoke all on function public.collapse_split(uuid, uuid) from public, anon;
grant execute on function public.collapse_split(uuid, uuid) to authenticated, service_role;
