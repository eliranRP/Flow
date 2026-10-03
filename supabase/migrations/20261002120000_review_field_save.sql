-- A card-line pick writes one field and leaves the review open.
-- p_resolve defaults to true, so אישור, דלג, and a complete שינוי still close the item.
-- A field-only save owns only that field. project_assigned marks the project
-- and category_assigned marks the category, without setting user_assigned,
-- so the other guess stays. A later SUMIT sync keeps an owned field.
-- Decision 0081.

alter table public.transactions
  add column project_assigned boolean not null default false;

alter table public.transactions
  add column category_assigned boolean not null default false;

comment on column public.transactions.project_assigned is
  'True when the owner picked the project and the category guess may still stand. Decision 0081.';

comment on column public.transactions.category_assigned is
  'True when the owner picked the category and the project guess may still stand. Decision 0081.';

-- The project write and the resolving write share one guard: the same raises,
-- then the overhead row is removed. A split is not collapsed into one project.
-- resolve_review therefore raises on a shared or split expense, including
-- p_resolve true. אישור of those cards calls approve_split_review instead.
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
      -- The category is the owner's, including a pick of the suggested id.
      -- user_assigned stays, so a project guess remains.
      update public.transactions
      set category_id = p_category_id,
          category_assigned = true,
          category_suggested = false
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
      category_assigned = case when p_resolve then category_assigned else true end,
      category_suggested = case when p_resolve then category_suggested else false end,
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

-- An owned field survives the next SUMIT sync. user_assigned still owns the
-- whole row. project_assigned keeps the project, role, shares, and overhead.
-- category_assigned keeps the category. Decision 0081.

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

create or replace function public.upsert_sumit_documents(p_company uuid, p_docs jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  doc jsonb;
  seen text[] := array[]::text[];
  key text;
  party_name text;
  party_kind text;
  party_external bigint;
  section_name text;
  section_id bigint;
  project uuid;
  named uuid;
  mapped_section bigint;
  supplier uuid;
  customer uuid;
  remembered uuid;
  income_category uuid;
  role public.pnl_role;
  direction public.txn_direction;
  kind public.doc_kind;
  gross bigint;
  net bigint;
  vat bigint;
  txn uuid;
  assigned boolean;
  written integer := 0;
  allocated bigint;
  existing_count integer;
  remove_count integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_company is null or not exists (select 1 from public.companies c where c.id = p_company) then
    raise exception 'no company';
  end if;
  if jsonb_typeof(p_docs) <> 'array' then
    raise exception 'documents must be an array';
  end if;

  perform 1 from public.companies where id = p_company for update;

  select c.id into income_category
  from public.categories c
  where c.company_id = p_company
    and c.kind = 'income'
    and c.is_default = true
    and c.hidden = false
  order by c.sort_order
  limit 1;

  for doc in select value from jsonb_array_elements(p_docs)
  loop
    key := doc->>'idempotency_key';
    if key is null or key = '' then
      raise exception 'document is missing an idempotency key';
    end if;
    seen := array_append(seen, key);
    direction := (doc->>'direction')::public.txn_direction;
    kind := (doc->>'doc_kind')::public.doc_kind;
    role := nullif(doc->>'pnl_role', '')::public.pnl_role;
    gross := (doc->>'amount_gross')::bigint;
    net := (doc->>'amount_net')::bigint;
    vat := (doc->>'vat_amount')::bigint;
    if gross is null or net is null or vat is null or gross <> net + vat then
      raise exception 'document amounts do not balance';
    end if;

    section_name := nullif(btrim(coalesce(doc->>'budget_section_name', '')), '');
    section_id := nullif(doc->>'budget_section_id', '')::bigint;
    project := null;
    if section_id is not null then
      select p.id into project
      from public.projects p
      where p.company_id = p_company and p.sumit_budget_section_id = section_id
      limit 1;
    end if;
    if project is null and section_name is not null then
      select p.id, p.sumit_budget_section_id into named, mapped_section
      from public.projects p
      where p.company_id = p_company and p.name = section_name;
      if named is null then
        insert into public.projects (company_id, name, sumit_budget_section_id)
        values (p_company, section_name, section_id)
        on conflict (company_id, name) do update
          set sumit_budget_section_id = coalesce(public.projects.sumit_budget_section_id, excluded.sumit_budget_section_id)
        returning id into project;
        select p.sumit_budget_section_id into mapped_section
        from public.projects p where p.id = project;
        if section_id is not null and mapped_section is distinct from section_id then
          project := null;
        end if;
      elsif mapped_section is null then
        update public.projects
        set sumit_budget_section_id = section_id
        where id = named and sumit_budget_section_id is null;
        project := named;
      elsif section_id is null or mapped_section = section_id then
        project := named;
      end if;
    end if;

    party_name := nullif(btrim(coalesce(doc->>'party_name', '')), '');
    party_kind := doc->>'party_kind';
    party_external := nullif(doc->>'party_external_id', '')::bigint;
    supplier := null;
    customer := null;
    remembered := null;
    if party_name is not null and party_kind = 'supplier' then
      insert into public.suppliers (company_id, name, sumit_external_id)
      values (p_company, party_name, party_external)
      on conflict (company_id, name) do update
        set sumit_external_id = coalesce(excluded.sumit_external_id, public.suppliers.sumit_external_id)
      returning id, remembered_category_id into supplier, remembered;
    elsif party_name is not null and party_kind = 'customer' then
      insert into public.customers (company_id, name, sumit_external_id)
      values (p_company, party_name, party_external)
      on conflict (company_id, name) do update
        set sumit_external_id = coalesce(excluded.sumit_external_id, public.customers.sumit_external_id)
      returning id into customer;
    end if;

    if direction = 'income' or role is distinct from 'project' then
      project := null;
    end if;
    if direction = 'income' then
      role := null;
    end if;

    insert into public.transactions (
      company_id, direction, doc_kind, pnl_role,
      amount_gross, amount_net, vat_amount, vat_status,
      doc_date, cash_date, source, external_id, idempotency_key,
      project_id, customer_id, supplier_id, category_id,
      description, linked_external_id, user_assigned, removed_at
    ) values (
      p_company,
      direction,
      kind,
      role,
      gross,
      net,
      vat,
      (doc->>'vat_status')::public.vat_status,
      (doc->>'doc_date')::date,
      nullif(doc->>'cash_date', '')::date,
      'sumit',
      nullif(doc->>'external_id', ''),
      key,
      project,
      customer,
      supplier,
      case
        when direction = 'income' then income_category
        when direction = 'expense' then remembered
        else null
      end,
      coalesce(doc->>'description', ''),
      nullif(doc->>'linked_external_id', ''),
      false,
      null
    )
    on conflict (company_id, idempotency_key) do update
      set direction = excluded.direction,
          doc_kind = excluded.doc_kind,
          amount_gross = excluded.amount_gross,
          amount_net = excluded.amount_net,
          vat_amount = excluded.vat_amount,
          vat_status = excluded.vat_status,
          doc_date = excluded.doc_date,
          cash_date = excluded.cash_date,
          external_id = excluded.external_id,
          description = excluded.description,
          linked_external_id = excluded.linked_external_id,
          customer_id = excluded.customer_id,
          supplier_id = excluded.supplier_id,
          removed_at = null,
          project_id = case
            when public.transactions.user_assigned or public.transactions.project_assigned then public.transactions.project_id
            else excluded.project_id
          end,
          category_id = case
            when public.transactions.user_assigned or public.transactions.category_assigned then public.transactions.category_id
            else excluded.category_id
          end,
          pnl_role = case
            when public.transactions.user_assigned or public.transactions.project_assigned then public.transactions.pnl_role
            else excluded.pnl_role
          end
    returning id, (user_assigned or project_assigned), project_id, pnl_role, amount_net
    into txn, assigned, project, role, net;

    if assigned then
      update public.allocations
      set amount_net = (net * share_bp) / 10000
      where transaction_id = txn;
      select coalesce(sum(a.amount_net), 0) into allocated
      from public.allocations a
      where a.transaction_id = txn;
      if allocated <> 0 and allocated <> net then
        update public.allocations
        set amount_net = amount_net + (net - allocated)
        where id = (
          select a.id from public.allocations a
          where a.transaction_id = txn
          order by a.project_id
          limit 1
        );
      end if;
    else
      delete from public.allocations where transaction_id = txn;
      delete from public.overhead where transaction_id = txn;
      if direction <> 'income' and role = 'project' and project is not null then
        insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
        values (p_company, txn, project, 10000, net);
      elsif direction <> 'income' and role = 'overhead' then
        insert into public.overhead (company_id, transaction_id)
        values (p_company, txn);
      end if;
    end if;

    written := written + 1;
  end loop;

  select count(*) into existing_count
  from public.transactions t
  where t.company_id = p_company and t.source = 'sumit' and t.removed_at is null;

  select count(*) into remove_count
  from public.transactions t
  where t.company_id = p_company
    and t.source = 'sumit'
    and t.removed_at is null
    and not (t.idempotency_key = any (seen));

  if coalesce(array_length(seen, 1), 0) = 0 then
    update public.sumit_connections
    set last_error = 'sync_sweep_empty'
    where company_id = p_company;
  elsif existing_count > 0 and remove_count * 2 > existing_count then
    update public.sumit_connections
    set last_error = 'sync_sweep_suspicious'
    where company_id = p_company;
  else
    update public.transactions t
    set removed_at = now()
    where t.company_id = p_company
      and t.source = 'sumit'
      and t.removed_at is null
      and not (t.idempotency_key = any (seen));
  end if;

  perform public.sync_review_queue(p_company);
  return written;
end;
$$;

-- Trigger functions run as their owner. Authenticated does not need EXECUTE.

comment on function public.approve_split_review(uuid) is
  'Closes a categorised split review. Shares, amounts, and the supplier rule stay. resolve_review raises on a shared or split expense, so אישור uses this function. Decision 0075.';
