-- A shared expense waiting in לאישור (unallocated_shared) can be approved with no split (owner,
-- 2026-10-26): the split screen's לאשר בלי פיצול puts the whole line on one project, as the older
-- split between projects did with one share (save_split, which the app no longer holds). The line
-- becomes that project's own cost and its review closes as changed, keeping what it was before so
-- reopen_review can put it back. The assistant does the same with assign_expense_split and one share.

begin;

set local lock_timeout = '5s';

create function public.approve_shared_whole(p_transaction_id uuid, p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.current_company_id();
  line record;
begin
  if cid is null then
    raise exception 'no company';
  end if;
  select t.id, t.pnl_role, t.project_id, t.category_id, t.user_assigned into line
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;
  if not exists (
    select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
  ) then
    raise exception 'project not found';
  end if;
  if not exists (
    select 1 from public.review_queue q
    where q.transaction_id = p_transaction_id and q.company_id = cid
      and q.status = 'open' and q.reason = 'unallocated_shared'
  ) then
    raise exception 'line is not a shared expense in review';
  end if;

  update public.review_queue q
  set status = 'changed',
      resolved_at = now(),
      prior_project_id = line.project_id,
      prior_category_id = line.category_id,
      prior_pnl_role = line.pnl_role,
      prior_user_assigned = line.user_assigned,
      prior_allocations = coalesce((
        select jsonb_agg(jsonb_build_object('project_id', a.project_id, 'share_bp', a.share_bp))
        from public.allocations a where a.transaction_id = p_transaction_id
      ), '[]'::jsonb)
  where q.transaction_id = p_transaction_id and q.company_id = cid
    and q.status = 'open' and q.reason = 'unallocated_shared';

  delete from public.allocations a where a.transaction_id = p_transaction_id;
  update public.transactions t
  set pnl_role = 'project'::public.pnl_role,
      project_id = p_project_id,
      user_assigned = true
  where t.id = p_transaction_id and t.company_id = cid;
end;
$$;

revoke all on function public.approve_shared_whole(uuid, uuid) from public, anon, service_role;
grant execute on function public.approve_shared_whole(uuid, uuid) to authenticated;

comment on function public.approve_shared_whole(uuid, uuid) is
  'A shared expense in review approved with no split: the whole line on one project of the caller''s company; its unallocated_shared review closes as changed.';

commit;
