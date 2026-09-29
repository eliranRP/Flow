-- Decision 0071 point 6, amended. Append-only.
-- Undo of an approval restores category_suggested. A guess already undone is
-- put back when a suggested review, its undo row, or the audit meta shows it.
-- Older audit rows stored an empty meta; a transaction update from here writes
-- the flag. A failed sync waits before it can fill the drain page again.

alter table public.review_queue
  add column prior_category_suggested boolean;

comment on column public.review_queue.prior_category_suggested is
  'Whether the category stored for reopen_review was a suggestion. Decision 0071.';

alter table public.reassign_undo
  add column prior_category_suggested boolean;

comment on column public.reassign_undo.prior_category_suggested is
  'Whether the category stored for undo_reassign was a suggestion. Decision 0071.';

create or replace function private.fill_suggested_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  picked uuid;
begin
  if new.user_assigned then
    new.category_suggested := false;
    return new;
  end if;

  if new.category_id is not null then
    if tg_op = 'INSERT' then
      new.category_suggested := false;
    elsif new.category_id is distinct from old.category_id
      and new.category_suggested is not distinct from old.category_suggested then
      new.category_suggested := false;
    end if;
    return new;
  end if;

  picked := null;
  if new.supplier_id is not null then
    select s.remembered_category_id into picked
    from public.suppliers s
    join public.categories c
      on c.id = s.remembered_category_id
     and c.company_id = s.company_id
    where s.id = new.supplier_id
      and s.company_id = new.company_id
      and not c.hidden
      and c.kind::text = new.direction::text;
  end if;

  if picked is null and new.supplier_id is not null then
    select chosen.category_id into picked
    from (
      select t.category_id
      from public.transactions t
      join public.categories c
        on c.id = t.category_id
       and c.company_id = t.company_id
      where t.company_id = new.company_id
        and t.supplier_id = new.supplier_id
        and t.direction = new.direction
        and t.id is distinct from new.id
        and t.removed_at is null
        and t.user_assigned
        and not c.hidden
        and c.kind::text = new.direction::text
      group by t.category_id
      order by count(*) desc, max(t.doc_date) desc
      limit 1
    ) chosen;
  end if;

  if picked is null then
    select c.id into picked
    from public.categories c
    where c.company_id = new.company_id
      and c.kind::text = new.direction::text
      and c.is_default
      and not c.hidden
    order by c.sort_order, c.name
    limit 1;
  end if;

  if picked is null then
    new.category_suggested := false;
    return new;
  end if;

  new.category_id := picked;
  -- A remembered supplier rule is the assignment. History and the default stay a suggestion.
  new.category_suggested := not exists (
    select 1
    from public.suppliers s
    where s.id = new.supplier_id
      and s.company_id = new.company_id
      and s.remembered_category_id = picked
  );
  return new;
end;
$$;

create or replace function public.resolve_review(
  p_id uuid,
  p_action text,
  p_project_id uuid default null,
  p_category_id uuid default null,
  p_remember boolean default true
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

  if reason = 'unallocated_shared' and next_status <> 'skipped' then
    raise exception 'shared costs are split, not assigned to one project';
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
    delete from public.overhead where transaction_id = txn and company_id = cid;

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

create or replace function public.reopen_review(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  txn uuid;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
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
  select q.transaction_id, q.prior_project_id, q.prior_category_id, q.prior_pnl_role,
         q.prior_user_assigned, q.prior_category_suggested, q.prior_allocations, q.prior_remembered_category_id,
         q.written_remembered_category_id
  into txn, prior_project, prior_category, prior_role, prior_assigned, prior_suggested, prior_shares,
       prior_remembered, written
  from public.review_queue q
  where q.id = p_id
    and q.company_id = cid
    and q.status in ('approved', 'skipped', 'changed')
  for update;
  if txn is null then
    raise exception 'review item not found';
  end if;

  select t.supplier_id into supplier
  from public.transactions t
  where t.id = txn and t.company_id = cid;

  update public.transactions
  set project_id = prior_project,
      category_id = prior_category,
      pnl_role = prior_role,
      user_assigned = coalesce(prior_assigned, false),
      category_suggested = coalesce(prior_suggested, false)
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
$$;

create or replace function public.reassign_transaction(
  p_id uuid,
  p_project_id uuid,
  p_category_id uuid
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
  cat_kind text;
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
  select c.kind::text into cat_kind
  from public.categories c
  where c.id = p_category_id and c.company_id = cid;
  if cat_kind is null then
    raise exception 'category not found';
  end if;
  if cat_kind is distinct from direction::text then
    raise exception 'category kind must match the direction';
  end if;
  if prior_role = 'shared' or exists (
    select 1
    from public.review_queue q
    where q.transaction_id = p_id
      and q.company_id = cid
      and q.status = 'open'
      and q.reason = 'unallocated_shared'
  ) then
    raise exception 'shared costs are split, not assigned to one project';
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
  where q.transaction_id = p_id and q.company_id = cid and q.status = 'open'
  order by q.created_at desc
  limit 1;

  delete from public.allocations where transaction_id = p_id and company_id = cid;
  delete from public.overhead where transaction_id = p_id and company_id = cid;

  if direction = 'income' then
    update public.transactions
    set project_id = null,
        category_id = p_category_id,
        pnl_role = null,
        user_assigned = true
    where id = p_id and company_id = cid;
  else
    if p_project_id is null or not exists (
      select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
    ) then
      raise exception 'project not found';
    end if;
    update public.transactions
    set project_id = p_project_id,
        category_id = p_category_id,
        pnl_role = 'project',
        user_assigned = true
    where id = p_id and company_id = cid;
    insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
    values (cid, p_id, p_project_id, 10000, net);
  end if;

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

create or replace function public.set_transaction_category(
  p_id uuid,
  p_category_id uuid
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

  select q.id into prior_review
  from public.review_queue q
  where q.transaction_id = p_id
    and q.company_id = cid
    and q.status = 'open'
    and q.reason = 'missing_category'
  order by q.created_at desc
  limit 1;

  update public.transactions
  set category_id = p_category_id,
      user_assigned = true
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

create or replace function public.undo_reassign(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  txn uuid;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_shares jsonb;
  review_id uuid;
  item jsonb;
  updated int;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select u.transaction_id, u.prior_project_id, u.prior_category_id, u.prior_pnl_role,
         u.prior_user_assigned, u.prior_category_suggested, u.prior_allocations, u.prior_review_id
  into txn, prior_project, prior_category, prior_role, prior_assigned, prior_suggested, prior_shares, review_id
  from public.reassign_undo u
  where u.id = p_id and u.company_id = cid and u.undone_at is null
  for update;
  if txn is null then
    raise exception 'undo not found';
  end if;

  update public.transactions
  set project_id = prior_project,
      category_id = prior_category,
      pnl_role = prior_role,
      user_assigned = prior_assigned,
      category_suggested = coalesce(prior_suggested, false)
  where id = txn and company_id = cid;
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'transaction not found';
  end if;

  delete from public.allocations where transaction_id = txn and company_id = cid;
  delete from public.overhead where transaction_id = txn and company_id = cid;
  if prior_shares is not null and jsonb_typeof(prior_shares) = 'array' then
    for item in select value from jsonb_array_elements(prior_shares)
    loop
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      values (
        cid, txn,
        (item->>'project_id')::uuid,
        (item->>'share_bp')::integer,
        (item->>'amount_net')::bigint
      );
    end loop;
  end if;
  if prior_role = 'overhead' then
    insert into public.overhead (company_id, transaction_id) values (cid, txn);
  end if;

  if review_id is not null then
    update public.review_queue
    set status = 'open',
        resolved_at = null
    where id = review_id and company_id = cid and status = 'changed';

    if prior_role = 'shared'
      and (prior_shares is null or prior_shares = '[]'::jsonb)
      and exists (
        select 1 from public.review_queue q
        where q.id = review_id and q.company_id = cid and q.reason = 'missing_category'
      )
    then
      delete from public.review_queue q
      where q.id = (
        select q2.id
        from public.review_queue q2
        where q2.company_id = cid
          and q2.transaction_id = txn
          and q2.status = 'open'
          and q2.reason = 'unallocated_shared'
        order by q2.created_at desc
        limit 1
      );
    end if;
  end if;

  update public.reassign_undo
  set undone_at = now()
  where id = p_id and company_id = cid;
end;
$$;

create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  eid uuid;
  meta jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'companies' then
    cid := coalesce(new.id, old.id);
    eid := cid;
  else
    cid := coalesce(new.company_id, old.company_id);
    eid := coalesce(new.id, old.id);
  end if;
  -- A company DELETE cascades to children and then to audit_log. An AFTER
  -- DELETE row that still points at that company fails the FK (23503) and
  -- rolls the delete back. Skip the audit once the company row is gone,
  -- including the companies DELETE itself.
  if tg_op = 'DELETE' and not exists (select 1 from public.companies where id = cid) then
    return old;
  end if;
  -- to_jsonb keeps this trigger valid on tables that have no category columns.
  if tg_table_name = 'transactions' and tg_op = 'UPDATE' then
    meta := jsonb_build_object(
      'category_suggested', to_jsonb(old) -> 'category_suggested',
      'category_id', to_jsonb(old) ->> 'category_id'
    );
  end if;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, meta)
  values (
    cid,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    eid,
    meta
  );
  return coalesce(new, old);
end;
$$;

revoke all on function private.fill_suggested_category() from public, anon, authenticated;

create or replace function private.restore_undone_suggestions()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.review_queue q
  set prior_category_suggested = true
  where q.reason = 'suggested'
    and q.prior_category_id is not null
    and q.prior_category_suggested is null;

  update public.reassign_undo u
  set prior_category_suggested = true
  from public.review_queue q
  where q.id = u.prior_review_id
    and q.company_id = u.company_id
    and q.reason = 'suggested'
    and u.prior_category_suggested is null;

  update public.reassign_undo u
  set prior_category_suggested = true
  where u.prior_category_suggested is null
    and exists (
      select 1
      from public.audit_log a
      where a.company_id = u.company_id
        and a.entity = 'transactions'
        and a.entity_id = u.transaction_id
        and a.action = 'update'
        and a.meta->>'category_suggested' = 'true'
        and a.meta->>'category_id' is not distinct from u.prior_category_id::text
        and a.created_at <= u.created_at
    );

  update public.transactions t
  set category_suggested = true
  where t.category_suggested = false
    and t.user_assigned = false
    and t.category_id is not null
    and t.removed_at is null
    and (
      exists (
        select 1
        from public.review_queue q
        where q.company_id = t.company_id
          and q.transaction_id = t.id
          and q.reason = 'suggested'
          and q.status = 'open'
          and q.prior_category_id is not distinct from t.category_id
      )
      or exists (
        select 1
        from public.reassign_undo u
        join public.review_queue q
          on q.id = u.prior_review_id
         and q.company_id = u.company_id
        where u.company_id = t.company_id
          and u.transaction_id = t.id
          and u.undone_at is not null
          and q.reason = 'suggested'
          and u.prior_category_id is not distinct from t.category_id
      )
      or exists (
        select 1
        from public.audit_log a
        where a.company_id = t.company_id
          and a.entity = 'transactions'
          and a.entity_id = t.id
          and a.action = 'update'
          and a.meta->>'category_suggested' = 'true'
          and a.meta->>'category_id' is not distinct from t.category_id::text
      )
    );
end;
$$;

revoke all on function private.restore_undone_suggestions() from public, anon, authenticated;

select private.restore_undone_suggestions();

create or replace function public.note_sync_failure(p_company uuid, p_code text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  retry timestamptz;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_code is distinct from 'sync_failed' and p_code is distinct from 'sync_page_cap' then
    raise exception 'unknown sync failure';
  end if;
  retry := now() + interval '15 minutes';
  update public.sumit_connections
  set last_error = p_code,
      next_attempt_at = retry
  where company_id = p_company;
  if not found then
    raise exception 'SUMIT is not connected';
  end if;
  return retry;
end;
$$;

revoke all on function public.note_sync_failure(uuid, text) from public, anon, authenticated;
grant execute on function public.note_sync_failure(uuid, text) to service_role;
