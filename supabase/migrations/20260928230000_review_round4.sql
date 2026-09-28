-- Round 4. Decision 0064.
-- Overhead view is stored. Income stays out of Review. A supplier rule is
-- optional. SUMIT section ids win over names. An empty or suspicious payload
-- does not soft-delete the ledger. The drain is scheduled when pg_net exists.

alter table public.companies
  add column after_overhead boolean not null default false;

comment on column public.companies.after_overhead is
  'Settings default for the after-overhead view. Off until the owner turns it on. Decision 0064.';

alter table public.projects
  add column after_overhead boolean;

comment on column public.projects.after_overhead is
  'Project view. Null inherits the company default. Decision 0064.';

alter table public.review_queue
  add column prior_remembered_category_id uuid,
  add column doc_fingerprint text;

comment on column public.review_queue.prior_remembered_category_id is
  'Supplier remembered category before resolve_review. reopen_review restores it. Decision 0064.';

comment on column public.review_queue.doc_fingerprint is
  'Document identity at resolve time. A skipped row stays closed until this changes.';

alter table public.sumit_connections
  add column envelope_version text;

comment on column public.sumit_connections.envelope_version is
  'AES-GCM envelope format. kek_version is the key-rotation id. Decision 0064.';

comment on column public.sumit_connections.kek_version is
  'KEK rotation id. Envelope format lives in envelope_version. Older rows stored the format here.';

create or replace function private.doc_fingerprint(
  p_direction text,
  p_kind text,
  p_gross bigint,
  p_date date,
  p_description text,
  p_external text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(
    '|',
    coalesce(p_direction, ''),
    coalesce(p_kind, ''),
    coalesce(p_gross::text, ''),
    coalesce(p_date::text, ''),
    coalesce(p_description, ''),
    coalesce(p_external, '')
  )
$$;

revoke all on function private.doc_fingerprint(text, text, bigint, date, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- After-overhead view. No owner weights yet, so the share is 0.
-- ---------------------------------------------------------------------------

create or replace function public.set_after_overhead(p_on boolean, p_project_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_project_id is null then
    update public.companies
    set after_overhead = coalesce(p_on, false)
    where id = cid;
    return;
  end if;
  update public.projects
  set after_overhead = coalesce(p_on, false)
  where id = p_project_id and company_id = cid;
  if not found then
    raise exception 'project not found';
  end if;
end;
$$;

revoke all on function public.set_after_overhead(boolean, uuid) from public, anon;
grant execute on function public.set_after_overhead(boolean, uuid) to authenticated, service_role;

create or replace function public.get_project(p_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  result jsonb;
  profit bigint;
begin
  select c.id into cid
  from public.companies c
  where c.owner_id = (select auth.uid());
  if cid is null then
    return null;
  end if;

  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'status', p.status,
    'state_label', p.state_label,
    'budget_agorot', p.budget_agorot,
    'sumit_budget_section_id', p.sumit_budget_section_id,
    'after_overhead', coalesce(p.after_overhead, (select c.after_overhead from public.companies c where c.id = cid)),
    'income_agorot', coalesce((
      select sum(t.amount_net) from public.transactions t
      where t.project_id = p.id and t.direction = 'income'
        and t.removed_at is null
        and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')
    ), 0),
    'direct_agorot', -coalesce((
      select sum(t.amount_net) from public.transactions t
      where t.project_id = p.id and t.direction = 'expense' and t.pnl_role = 'project'
        and t.removed_at is null
    ), 0),
    'shared_agorot', -coalesce((
      select sum(a.amount_net) from public.allocations a
      join public.transactions t on t.id = a.transaction_id
      where a.project_id = p.id and t.pnl_role = 'shared' and t.removed_at is null
    ), 0),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'amount_agorot', s.amount
      ) order by s.amount desc, c.name)
      from (
        select t.category_id, (-sum(t.amount_net))::bigint as amount
        from public.transactions t
        where t.project_id = p.id and t.direction = 'expense' and t.pnl_role = 'project'
          and t.removed_at is null
        group by t.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'description', t.description,
        'doc_date', t.doc_date,
        'amount_net', t.amount_net,
        'direction', t.direction,
        'source', t.source,
        'doc_kind', t.doc_kind,
        'category', c.name
      ) order by t.doc_date desc, t.created_at desc)
      from (
        select * from public.transactions t
        where t.company_id = cid
          and t.removed_at is null
          and (t.project_id = p.id or exists (
            select 1 from public.allocations a
            where a.transaction_id = t.id and a.project_id = p.id
          ))
        order by t.doc_date desc, t.created_at desc
        limit 40
      ) t
      left join public.categories c on c.id = t.category_id
    ), '[]'::jsonb)
  )
  into result
  from public.projects p
  where p.id = p_id and p.company_id = cid;
  if result is null then
    return null;
  end if;
  profit :=
    (result->>'income_agorot')::bigint
    - (result->>'direct_agorot')::bigint
    - (result->>'shared_agorot')::bigint;
  -- Owner weights are not stored yet. The allocated share is 0 until they are.
  return result || jsonb_build_object(
    'profit_agorot', profit,
    'overhead_share_agorot', 0,
    'overhead_weighted', false,
    'profit_after_overhead_agorot', profit
  );
end;
$$;

create or replace function public.get_dashboard(
  p_from date default null,
  p_to date default null,
  p_basis text default 'cash'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  payload jsonb;
begin
  select c.id into cid
  from public.companies c
  where c.owner_id = (select auth.uid());
  if cid is null then
    return jsonb_build_object(
      'company_id', null,
      'name', null,
      'vat_registered', true,
      'basis', case when p_basis = 'invoiced' then 'invoiced' else 'cash' end,
      'from', p_from,
      'to', p_to,
      'income_agorot', 0,
      'direct_agorot', 0,
      'shared_agorot', 0,
      'overhead_agorot', 0,
      'expense_agorot', 0,
      'net_profit_agorot', 0,
      'prev_income_agorot', null,
      'prev_expense_agorot', null,
      'prev_net_agorot', null,
      'active_projects', 0,
      'review_count', 0,
      'after_overhead', false,
      'projects', '[]'::jsonb
    );
  end if;
  payload := public.company_pnl(cid, p_from, p_to, p_basis);
  return payload || jsonb_build_object(
    'after_overhead', coalesce((select c.after_overhead from public.companies c where c.id = cid), false)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Review: income is not a project cost. Remember is explicit. Undo restores it.
-- ---------------------------------------------------------------------------

drop function if exists public.resolve_review(uuid, text, uuid, uuid);

create function public.resolve_review(
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
  prior_shares jsonb;
  prior_remembered uuid;
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

  select t.project_id, t.category_id, t.pnl_role, t.user_assigned, t.supplier_id, t.amount_net,
         t.direction, t.doc_kind, t.amount_gross, t.doc_date, t.description, t.external_id
  into prior_project, prior_category, prior_role, prior_assigned, supplier, net,
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
      prior_allocations = prior_shares,
      prior_remembered_category_id = prior_remembered,
      doc_fingerprint = private.doc_fingerprint(direction::text, kind::text, gross, doc_date, description, external_id)
  where id = p_id and company_id = cid;
end;
$$;

revoke all on function public.resolve_review(uuid, text, uuid, uuid, boolean) from public, anon;
grant execute on function public.resolve_review(uuid, text, uuid, uuid, boolean) to authenticated, service_role;

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
  prior_shares jsonb;
  prior_remembered uuid;
  supplier uuid;
  item jsonb;
  updated int;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select q.transaction_id, q.prior_project_id, q.prior_category_id, q.prior_pnl_role,
         q.prior_user_assigned, q.prior_allocations, q.prior_remembered_category_id
  into txn, prior_project, prior_category, prior_role, prior_assigned, prior_shares, prior_remembered
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
      user_assigned = coalesce(prior_assigned, false)
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

  if supplier is not null then
    update public.suppliers
    set remembered_category_id = prior_remembered
    where id = supplier and company_id = cid;
  end if;

  update public.review_queue
  set status = 'open',
      resolved_at = null
  where id = p_id and company_id = cid;
end;
$$;

create or replace function public.sync_review_queue(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
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
      when t.category_id is null then 'missing_category'
      when t.pnl_role = 'shared' then 'unallocated_shared'
      else 'missing_project'
    end
  from public.transactions t
  where t.company_id = p_company_id
    and t.source = 'sumit'
    and t.removed_at is null
    and t.direction = 'expense'
    and (
      t.category_id is null
      or (
        t.pnl_role = 'shared'
        and not exists (
          select 1 from public.allocations a where a.transaction_id = t.id
        )
      )
      or (
        coalesce(t.pnl_role, 'project') = 'project'
        and t.project_id is null
      )
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
  return inserted;
end;
$$;

create or replace function public.save_split(p_transaction_id uuid, p_shares jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  txn_net bigint;
  total_share integer;
  item jsonb;
  share integer;
  project uuid;
  assigned bigint := 0;
  part bigint;
  first_project uuid;
  count_shares integer := 0;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_shares jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select t.amount_net, t.project_id, t.category_id, t.pnl_role, t.user_assigned
  into txn_net, prior_project, prior_category, prior_role, prior_assigned
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
  for update;
  if txn_net is null then
    raise exception 'transaction not found';
  end if;
  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'at least one share is required';
  end if;
  select coalesce(sum((value->>'share_bp')::integer), 0)
  into total_share
  from jsonb_array_elements(p_shares);
  if total_share <> 10000 then
    raise exception 'allocation shares must sum to 10000';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  )), '[]'::jsonb)
  into prior_shares
  from public.allocations a
  where a.transaction_id = p_transaction_id;

  delete from public.allocations
  where transaction_id = p_transaction_id and company_id = cid;
  delete from public.overhead
  where transaction_id = p_transaction_id and company_id = cid;

  for item in select value from jsonb_array_elements(p_shares)
  loop
    share := (item->>'share_bp')::integer;
    project := (item->>'project_id')::uuid;
    if share is null or share < 1 or share > 10000 then
      raise exception 'share is out of range';
    end if;
    if not exists (
      select 1 from public.projects p where p.id = project and p.company_id = cid
    ) then
      raise exception 'project not found';
    end if;
    part := (txn_net * share) / 10000;
    assigned := assigned + part;
    count_shares := count_shares + 1;
    if first_project is null then
      first_project := project;
    end if;
    insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
    values (cid, p_transaction_id, project, share, part);
  end loop;

  if assigned <> txn_net and first_project is not null then
    update public.allocations
    set amount_net = amount_net + (txn_net - assigned)
    where transaction_id = p_transaction_id and project_id = first_project;
  end if;

  update public.transactions
  set pnl_role = case when count_shares > 1 then 'shared'::public.pnl_role else 'project'::public.pnl_role end,
      project_id = case when count_shares = 1 then first_project else null end,
      user_assigned = true
  where id = p_transaction_id and company_id = cid;

  update public.review_queue
  set status = 'changed',
      resolved_at = now(),
      prior_project_id = prior_project,
      prior_category_id = prior_category,
      prior_pnl_role = prior_role,
      prior_user_assigned = prior_assigned,
      prior_allocations = prior_shares
  where company_id = cid
    and transaction_id = p_transaction_id
    and status = 'open'
    and reason = 'unallocated_shared';
end;
$$;

create or replace function public.map_budget_section(
  p_section_id bigint,
  p_project_id uuid default null,
  p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  rid uuid;
  clean text;
  pattern text;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  clean := nullif(btrim(coalesce(p_name, '')), '');
  pattern := null;
  if clean is not null then
    pattern := replace(replace(replace(clean, '\', '\\'), '%', '\%'), '_', '\_');
  end if;
  if p_project_id is not null then
    update public.projects
    set sumit_budget_section_id = case
          when sumit_budget_section_id is null then p_section_id
          else sumit_budget_section_id
        end,
        name = coalesce(clean, name)
    where id = p_project_id and company_id = cid
    returning id into rid;
    if rid is null then
      raise exception 'project not found';
    end if;
  else
    if clean is null then
      raise exception 'project name is too short';
    end if;
    select p.id into rid
    from public.projects p
    where p.company_id = cid and p.sumit_budget_section_id = p_section_id;
    if rid is null then
      insert into public.projects (company_id, name, sumit_budget_section_id)
      values (cid, clean, p_section_id)
      on conflict (company_id, name) do update
        set sumit_budget_section_id = coalesce(public.projects.sumit_budget_section_id, excluded.sumit_budget_section_id)
      returning id into rid;
      if (select sumit_budget_section_id from public.projects where id = rid) is distinct from p_section_id then
        raise exception 'project name is already mapped';
      end if;
    end if;
  end if;
  update public.transactions t
  set project_id = rid,
      pnl_role = coalesce(t.pnl_role, 'project'::public.pnl_role),
      user_assigned = true
  where t.company_id = cid
    and t.removed_at is null
    and t.user_assigned = false
    and t.direction = 'expense'
    and t.pnl_role = 'project'
    and t.project_id is null
    and pattern is not null
    and t.description like '%' || pattern || '%' escape '\';
  return rid;
end;
$$;

-- One transaction for a full SUMIT page set. Service role only.
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
            when public.transactions.user_assigned then public.transactions.project_id
            else excluded.project_id
          end,
          category_id = case
            when public.transactions.user_assigned then public.transactions.category_id
            else excluded.category_id
          end,
          pnl_role = case
            when public.transactions.user_assigned then public.transactions.pnl_role
            else excluded.pnl_role
          end
    returning id, user_assigned, project_id, pnl_role, amount_net
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
revoke all on function private.check_allocation_shares() from public, anon, authenticated;
grant execute on function private.check_allocation_shares() to service_role;

-- Drain unclaimed refresh markers when pg_net is installed. Decision 0064.
-- The URL and secret come from Vault when the hosted project has stored them.
-- Local Postgres reaches the function through Kong.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      perform cron.unschedule('flow-sumit-drain');
    exception
      when others then
        null;
    end;
    perform cron.schedule(
      'flow-sumit-drain',
      '*/5 * * * *',
      $cron$
        select net.http_post(
          url := coalesce(
            (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'flow_sync_url'
              limit 1
            ),
            'http://kong:8000/functions/v1/sumit-sync'
          ),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-flow-cron', coalesce(
              (
                select decrypted_secret
                from vault.decrypted_secrets
                where name = 'cron_secret'
                limit 1
              ),
              ''
            )
          ),
          body := '{}'::jsonb
        )
        where exists (
          select 1 from public.sumit_refresh_requests where claimed_at is null
        );
      $cron$
    );
  end if;
exception
  when undefined_table then
    null;
end;
$$;
