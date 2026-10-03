-- A card-line pick writes one field and leaves the review open.
-- p_resolve defaults to true, so אישור, דלג, and a complete שינוי still close the item.
-- A field-only save owns only that field. project_assigned marks the project
-- without setting user_assigned, so the category guess stays. Decision 0081.

alter table public.transactions
  add column project_assigned boolean not null default false;

comment on column public.transactions.project_assigned is
  'True when the owner picked the project and the category guess may still stand. Decision 0081.';

-- The project write and the resolving write share one guard: the same raises,
-- then the overhead row is removed. A split is not collapsed into one project.
create or replace function private.guard_review_assignment(
  p_company uuid,
  p_txn uuid,
  p_reason text,
  p_role public.pnl_role,
  p_share_count integer,
  p_assign_project boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_reason = 'unallocated_shared' then
    raise exception 'shared costs are split, not assigned to one project';
  end if;
  if p_assign_project and (p_role = 'shared' or coalesce(p_share_count, 0) > 1) then
    raise exception 'shared costs are split, not assigned to one project';
  end if;
  delete from public.overhead
  where transaction_id = p_txn and company_id = p_company;
end;
$$;

revoke all on function private.guard_review_assignment(uuid, uuid, text, public.pnl_role, integer, boolean) from public, anon, authenticated;

drop function if exists public.resolve_review(uuid, text, uuid, uuid, boolean);

create function public.resolve_review(
  p_id uuid,
  p_action text,
  p_project_id uuid default null,
  p_category_id uuid default null,
  p_remember boolean default true,
  p_resolve boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  txn uuid;
  next_status public.review_status;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_shares jsonb;
  prior_remembered uuid;
  written uuid;
  supplier uuid;
  net bigint;
  direction public.txn_direction;
  kind public.doc_kind;
  gross bigint;
  doc_date date;
  description text;
  external_id text;
  reason text;
  cat_kind text;
  share_count integer;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_action not in ('approved', 'skipped', 'changed') then
    raise exception 'unknown review action';
  end if;
  next_status := p_action::public.review_status;
  select q.transaction_id, q.reason into txn, reason
  from public.review_queue q
  where q.id = p_id and q.company_id = cid and q.status = 'open';
  if txn is null then
    raise exception 'review item not found';
  end if;

  select t.project_id, t.category_id, t.pnl_role, t.user_assigned, t.category_suggested, t.supplier_id, t.amount_net,
         t.direction, t.doc_kind, t.amount_gross, t.doc_date, t.description, t.external_id
  into prior_project, prior_category, prior_role, prior_assigned, prior_suggested, supplier, net,
       direction, kind, gross, doc_date, description, external_id
  from public.transactions t
  where t.id = txn and t.company_id = cid
  for update;

  select count(*)::integer into share_count
  from public.allocations a
  where a.transaction_id = txn;

  if not p_resolve then
    if p_action is distinct from 'changed' then
      raise exception 'unknown review action';
    end if;
    if direction is null then
      raise exception 'review item not found';
    end if;
    if p_category_id is null and (direction = 'income' or p_project_id is null) then
      raise exception 'project or category is required';
    end if;
    if reason = 'unallocated_shared'
      or (direction is distinct from 'income' and p_project_id is not null) then
      perform private.guard_review_assignment(
        cid,
        txn,
        reason,
        prior_role,
        share_count,
        direction is distinct from 'income' and p_project_id is not null
      );
    end if;
    if p_category_id is not null then
      select c.kind::text into cat_kind
      from public.categories c
      where c.id = p_category_id and c.company_id = cid;
      if cat_kind is null then
        raise exception 'project or category not found';
      end if;
      if cat_kind is distinct from direction::text then
        raise exception 'category kind must match the direction';
      end if;
      -- The category is the owner's. user_assigned stays, so a project guess remains.
      update public.transactions
      set category_id = p_category_id
      where id = txn and company_id = cid;
    end if;
    if direction is distinct from 'income' and p_project_id is not null then
      if not exists (
        select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
      ) then
        raise exception 'project or category not found';
      end if;
      update public.transactions
      set project_id = p_project_id,
          project_assigned = true,
          pnl_role = 'project'
      where id = txn and company_id = cid;
      delete from public.allocations where transaction_id = txn and company_id = cid;
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      values (cid, txn, p_project_id, 10000, net);
    end if;
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  )), '[]'::jsonb)
  into prior_shares
  from public.allocations a
  where a.transaction_id = txn;

  prior_remembered := null;
  if supplier is not null then
    select s.remembered_category_id into prior_remembered
    from public.suppliers s
    where s.id = supplier and s.company_id = cid;
  end if;

  if next_status <> 'skipped' then
    perform private.guard_review_assignment(
      cid,
      txn,
      reason,
      prior_role,
      share_count,
      direction is distinct from 'income'
    );
  end if;

  written := null;
  if next_status <> 'skipped' then
    if p_category_id is null then
      raise exception 'category is required';
    end if;
    select c.kind::text into cat_kind
    from public.categories c
    where c.id = p_category_id and c.company_id = cid;
    if cat_kind is null then
      raise exception 'project or category not found';
    end if;
    if cat_kind is distinct from direction::text then
      raise exception 'category kind must match the direction';
    end if;

    delete from public.allocations where transaction_id = txn and company_id = cid;

    if direction = 'income' then
      update public.transactions
      set project_id = null,
          category_id = p_category_id,
          pnl_role = null,
          user_assigned = true
      where id = txn and company_id = cid;
    else
      if p_project_id is null then
        raise exception 'project and category are required';
      end if;
      if not exists (
        select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
      ) then
        raise exception 'project or category not found';
      end if;
      update public.transactions
      set project_id = p_project_id,
          category_id = p_category_id,
          pnl_role = 'project',
          user_assigned = true
      where id = txn and company_id = cid;
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      values (cid, txn, p_project_id, 10000, net);
      if coalesce(p_remember, true) and supplier is not null then
        update public.suppliers
        set remembered_category_id = p_category_id
        where id = supplier and company_id = cid;
        written := p_category_id;
      end if;
    end if;
  end if;

  update public.review_queue
  set status = next_status,
      resolved_at = now(),
      prior_project_id = prior_project,
      prior_category_id = prior_category,
      prior_pnl_role = prior_role,
      prior_user_assigned = prior_assigned,
      prior_category_suggested = prior_suggested,
      prior_allocations = prior_shares,
      prior_remembered_category_id = prior_remembered,
      written_remembered_category_id = written,
      doc_fingerprint = private.doc_fingerprint(direction::text, kind::text, gross, doc_date, description, external_id)
  where id = p_id and company_id = cid;
end;
$$;

revoke all on function public.resolve_review(uuid, text, uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.resolve_review(uuid, text, uuid, uuid, boolean, boolean) to authenticated, service_role;

drop function if exists public.set_transaction_category(uuid, uuid);

create function public.set_transaction_category(
  p_id uuid,
  p_category_id uuid,
  p_resolve boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  direction public.txn_direction;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_shares jsonb;
  cat_kind text;
  prior_review uuid;
  undo_id uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select t.direction, t.project_id, t.category_id, t.pnl_role, t.user_assigned, t.category_suggested
  into direction, prior_project, prior_category, prior_role, prior_assigned, prior_suggested
  from public.transactions t
  where t.id = p_id and t.company_id = cid and t.removed_at is null
  for update;
  if direction is null then
    raise exception 'transaction not found';
  end if;
  select c.kind::text into cat_kind
  from public.categories c
  where c.id = p_category_id and c.company_id = cid;
  if cat_kind is null then
    raise exception 'category not found';
  end if;
  if cat_kind is distinct from direction::text then
    raise exception 'category kind must match the direction';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  )), '[]'::jsonb)
  into prior_shares
  from public.allocations a
  where a.transaction_id = p_id;

  prior_review := null;
  if p_resolve then
    select q.id into prior_review
    from public.review_queue q
    where q.transaction_id = p_id
      and q.company_id = cid
      and q.status = 'open'
      and q.reason = 'missing_category'
    order by q.created_at desc
    limit 1;
  end if;

  update public.transactions
  set category_id = p_category_id,
      user_assigned = case when p_resolve then true else user_assigned end
  where id = p_id and company_id = cid;

  if prior_review is not null then
    update public.review_queue
    set status = 'changed',
        resolved_at = now(),
        prior_project_id = prior_project,
        prior_category_id = prior_category,
        prior_pnl_role = prior_role,
        prior_user_assigned = prior_assigned,
        prior_category_suggested = prior_suggested,
        prior_allocations = prior_shares
    where id = prior_review and company_id = cid;

    if prior_role = 'shared'
      and not exists (select 1 from public.allocations a where a.transaction_id = p_id)
    then
      insert into public.review_queue (company_id, transaction_id, status, reason)
      values (cid, p_id, 'open', 'unallocated_shared');
    end if;
  end if;

  insert into public.reassign_undo (
    company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
    prior_user_assigned, prior_category_suggested, prior_allocations, prior_review_id
  ) values (
    cid, p_id, prior_project, prior_category, prior_role,
    coalesce(prior_assigned, false), prior_suggested, prior_shares, prior_review
  )
  returning id into undo_id;
  return undo_id;
end;
$$;

revoke all on function public.set_transaction_category(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_transaction_category(uuid, uuid, boolean) to authenticated, service_role;

-- project_suggested stays a computed flag. A project the owner picked is not a guess,
-- even while user_assigned is still false and the category guess remains.
create or replace function public.list_review()
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
    'vat_agorot', t.vat_amount,
    'direction', t.direction,
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
    'auto_approved_today', (
      select count(*)::int
      from public.transactions filed
      where filed.company_id = q.company_id
        and filed.source = 'sumit'
        and filed.removed_at is null
        and filed.created_at >= (date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem')
        and filed.category_id is not null
        and (
          coalesce(filed.pnl_role, 'project') <> 'project'
          or filed.project_id is not null
          or filed.direction <> 'expense'
        )
        and not exists (
          select 1
          from public.review_queue open_row
          where open_row.transaction_id = filed.id
            and open_row.status = 'open'
        )
    )
  ) order by t.doc_date, q.created_at), '[]'::jsonb)
  from public.review_queue q
  join public.transactions t on t.id = q.transaction_id
  left join public.suppliers s on s.id = t.supplier_id
  left join public.projects p on p.id = t.project_id
  left join public.categories c on c.id = t.category_id
  where q.company_id = (select private.current_company_id())
    and q.status = 'open'
    and t.removed_at is null;
$$;

revoke all on function public.list_review() from public, anon;
grant execute on function public.list_review() to authenticated, service_role;
