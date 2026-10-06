-- Income without a project enters review. USD lines show no VAT hint in the app.
-- Default category fallback skips off-P&L and loan-payment defaults. Decision 0090.

begin;

create or replace function public.sync_review_queue(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
  income_inserted integer := 0;
  pending_inserted integer := 0;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  insert into public.review_queue (company_id, transaction_id, status, reason)
  select
    t.company_id,
    t.id,
    'open',
    case
      when t.pnl_role = 'shared'
        and not exists (
          select 1 from public.allocations a where a.transaction_id = t.id
        )
        then 'unallocated_shared'
      when t.category_id is null then 'missing_category'
      when coalesce(t.pnl_role, 'project') = 'project' and t.project_id is null then 'missing_project'
      else 'suggested'
    end
  from public.transactions t
  where t.company_id = p_company_id
    and private.is_connector_source(t.source)
    and t.removed_at is null
    and t.direction = 'expense'
    and (
      (
        t.pnl_role = 'shared'
        and not exists (
          select 1 from public.allocations a where a.transaction_id = t.id
        )
      )
      or t.category_id is null
      or (
        coalesce(t.pnl_role, 'project') = 'project'
        and t.project_id is null
      )
      or (t.category_suggested and not t.user_assigned)
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status = 'open'
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id
        and q.status = 'skipped'
        and q.doc_fingerprint = private.doc_fingerprint(
          t.direction::text, t.doc_kind::text, t.amount_gross, t.doc_date, t.description, t.external_id
        )
        and not exists (
          select 1 from public.review_queue newer
          where newer.transaction_id = t.id
            and newer.created_at > q.created_at
        )
    );
  get diagnostics inserted = row_count;


  insert into public.review_queue (company_id, transaction_id, status, reason)
  select
    t.company_id,
    t.id,
    'open',
    case
      when t.category_id is null then 'missing_category'
      else 'missing_project'
    end
  from public.transactions t
  left join public.categories c on c.id = t.category_id and c.company_id = t.company_id
  where t.company_id = p_company_id
    and private.is_connector_source(t.source)
    and t.removed_at is null
    and t.direction = 'income'
    and t.line_status = 'posted'
    and t.project_id is null
    and (t.category_id is null or coalesce(c.excluded_from_pnl, false) = false)
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status = 'open'
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id
        and q.status = 'skipped'
        and q.doc_fingerprint = private.doc_fingerprint(
          t.direction::text, t.doc_kind::text, t.amount_gross, t.doc_date, t.description, t.external_id
        )
        and not exists (
          select 1 from public.review_queue newer
          where newer.transaction_id = t.id
            and newer.created_at > q.created_at
        )
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status = 'approved'
    );
  get diagnostics income_inserted = row_count;


  insert into public.review_queue (company_id, transaction_id, status, reason)
  select t.company_id, t.id, 'open', 'pending_income'
  from public.transactions t
  where t.company_id = p_company_id
    and private.is_connector_source(t.source)
    and t.removed_at is null
    and t.direction = 'income'
    and t.line_status = 'pending'
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status = 'open'
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id
        and q.status = 'skipped'
        and q.doc_fingerprint = private.doc_fingerprint(
          t.direction::text, t.doc_kind::text, t.amount_gross, t.doc_date, t.description, t.external_id
        )
        and not exists (
          select 1 from public.review_queue newer
          where newer.transaction_id = t.id
            and newer.created_at > q.created_at
        )
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status = 'approved'
    );
  get diagnostics pending_inserted = row_count;

  update public.review_queue q
  set reason = null
  from public.transactions t
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.reason = 'pending_income'
    and t.line_status = 'posted'
    and t.removed_at is null;

  delete from public.review_queue q
  using public.transactions t
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status = 'open'
    and (t.line_status = 'void' or t.removed_at is not null);

  update public.transactions t
  set category_suggested = true
  from public.review_queue q
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status = 'open'
    and t.company_id = p_company_id
    and t.direction = 'income'
    and not t.user_assigned
    and not t.category_assigned;

  return inserted + income_inserted + pending_inserted;
end;
$$;

create or replace function public.resolve_review(
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
    if p_category_id is null and p_project_id is null then
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
      -- The category is the owner's, including a pick of the suggested id.
      -- user_assigned stays, so a project guess remains.
      update public.transactions
      set category_id = p_category_id,
          category_assigned = true,
          category_suggested = false
      where id = txn and company_id = cid;
    end if;
    if p_project_id is not null then
      if not exists (
        select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
      ) then
        raise exception 'project or category not found';
      end if;
      if direction = 'income' then
        update public.transactions
        set project_id = p_project_id,
            project_assigned = true,
            pnl_role = null
        where id = txn and company_id = cid;
      else
        update public.transactions
        set project_id = p_project_id,
            project_assigned = true,
            pnl_role = 'project'
        where id = txn and company_id = cid;
        delete from public.allocations where transaction_id = txn and company_id = cid;
        insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
        values (cid, txn, p_project_id, 10000, net);
      end if;
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
      if not coalesce((
        select c.excluded_from_pnl
        from public.categories c
        where c.id = p_category_id and c.company_id = cid
      ), false) and p_project_id is null then
        raise exception 'project and category are required';
      end if;
      if p_project_id is not null and not exists (
        select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
      ) then
        raise exception 'project or category not found';
      end if;
      update public.transactions
      set project_id = p_project_id,
          category_id = p_category_id,
          pnl_role = null,
          user_assigned = true,
          project_assigned = p_project_id is not null
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
    if not coalesce((
      select c.excluded_from_pnl
      from public.categories c
      where c.id = p_category_id and c.company_id = cid
    ), false) and p_project_id is null then
      raise exception 'project not found';
    end if;
    if p_project_id is not null and not exists (
      select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
    ) then
      raise exception 'project not found';
    end if;
    update public.transactions
    set project_id = p_project_id,
        category_id = p_category_id,
        pnl_role = null,
        user_assigned = true,
        project_assigned = p_project_id is not null
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

create or replace function private.fill_suggested_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  picked uuid;
begin
  -- The owner's category is not a guess, and a sync must not replace it.
  if new.user_assigned or new.category_assigned then
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
      and not c.excluded_from_pnl
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


-- Backfill posted connector income without a project into review.
insert into public.review_queue (company_id, transaction_id, status, reason)
select
  t.company_id,
  t.id,
  'open',
  case
    when t.category_id is null then 'missing_category'
    else 'missing_project'
  end
from public.transactions t
left join public.categories c on c.id = t.category_id and c.company_id = t.company_id
where private.is_connector_source(t.source)
  and t.removed_at is null
  and t.direction = 'income'
  and t.line_status = 'posted'
  and t.project_id is null
  and (t.category_id is null or coalesce(c.excluded_from_pnl, false) = false)
  and not exists (
    select 1 from public.review_queue q
    where q.transaction_id = t.id and q.status = 'open'
  )
  and not exists (
    select 1 from public.review_queue q
    where q.transaction_id = t.id
      and q.status = 'skipped'
      and q.doc_fingerprint = private.doc_fingerprint(
        t.direction::text, t.doc_kind::text, t.amount_gross, t.doc_date, t.description, t.external_id
      )
      and not exists (
        select 1 from public.review_queue newer
        where newer.transaction_id = t.id
          and newer.created_at > q.created_at
      )
  )
  and not exists (
    select 1 from public.review_queue q
    where q.transaction_id = t.id and q.status = 'approved'
  );

update public.transactions t
set category_suggested = true
from public.review_queue q
where q.transaction_id = t.id
  and q.status = 'open'
  and t.direction = 'income'
  and not t.user_assigned
  and not t.category_assigned;


create or replace function public.mcp_assign_expense(
  p_idempotency_key text,
  p_transaction_id uuid,
  p_project_id uuid,
  p_category_id uuid,
  p_remember boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  review uuid;
  outcome jsonb;
  undo_id uuid;
  response jsonb;
  locked boolean;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or p_category_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'assign|' || p_transaction_id::text || '|' || coalesce(p_project_id::text, '') || '|'
    || p_category_id::text || '|' || coalesce(p_remember, false)::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    -- Lock the line before the review so assign and category share one order.
    select true into locked
    from public.transactions t
    where t.id = p_transaction_id
      and t.company_id = cid
      and t.removed_at is null
    for update;
    locked := found;

    if exists (
      select 1
      from public.review_queue q
      where q.id = p_transaction_id
        and q.company_id = cid
    ) and not locked then
      response := private.mcp_error(
        'validation',
        'id is not a transaction; list_review.id is the review id'
      );
    elsif not locked then
      response := private.mcp_refused('transaction not found');
    else
      if p_project_id is null and not exists (
        select 1
        from public.categories c
        where c.id = p_category_id
          and c.company_id = cid
          and c.excluded_from_pnl
      ) then
        response := private.mcp_error('validation', 'validation');
      elsif p_project_id is not null and not exists (
        select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
      ) then
        response := private.mcp_refused('project or category not found');
      else
      select q.id into review
      from public.review_queue q
      where q.transaction_id = p_transaction_id
        and q.company_id = cid
        and q.status = 'open'
      order by q.created_at desc
      limit 1
      for update;

      if review is not null then
        outcome := public.approve_review_item(
          review,
          p_project_id,
          p_category_id,
          coalesce(p_remember, false),
          null,
          null,
          false
        );
        if outcome->>'ok' is distinct from 'true' then
          response := outcome;
        else
          response := private.mcp_record_write(token, p_transaction_id, review, null, 'review');
        end if;
      else
        undo_id := public.reassign_transaction(p_transaction_id, p_project_id, p_category_id);
        response := private.mcp_record_write(token, p_transaction_id, null, undo_id, 'reassign');
      end if;
      end if;
    end if;
  exception
    when deadlock_detected or serialization_failure then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_assign_expense(text, uuid, uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.mcp_assign_expense(text, uuid, uuid, uuid, boolean) to authenticated;

commit;
