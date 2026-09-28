-- Round 5. Reassignment and categories really save. Overhead is an income share.
-- The drain is scheduled only when the extensions and a cron secret exist.
-- Decision 0065.

alter table public.review_queue
  add column written_remembered_category_id uuid;

comment on column public.review_queue.written_remembered_category_id is
  'The supplier category this approval wrote. Undo restores the prior value only while the supplier still has this one. Decision 0065.';

create table public.reassign_undo (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  transaction_id uuid not null,
  prior_project_id uuid,
  prior_category_id uuid,
  prior_pnl_role public.pnl_role,
  prior_user_assigned boolean not null,
  prior_allocations jsonb not null,
  prior_review_id uuid,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  foreign key (company_id, transaction_id)
    references public.transactions (company_id, id)
    on delete cascade
);

comment on table public.reassign_undo is
  'Prior assignment for one reassign_transaction call. undo_reassign restores it once. Decision 0065.';

revoke all on public.reassign_undo from public, anon, authenticated;
grant all on public.reassign_undo to service_role;

-- Nearest ₪100 (10,000 agorot), half away from zero. Decision 0021.
create function private.round_agorot_shekel_hundreds(p_exact numeric)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select (sign(p_exact) * round(abs(p_exact) / 10000) * 10000)::bigint;
$$;

revoke all on function private.round_agorot_shekel_hundreds(numeric) from public, anon;
grant execute on function private.round_agorot_shekel_hundreds(numeric) to authenticated, service_role;

-- Project-to-date income share of company overhead. Zero company income means unavailable.
create function private.overhead_share(p_project uuid)
returns table (available boolean, share_agorot bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with cid as (
    select private.current_company_id() as id
  ),
  totals as (
    select
      coalesce((
        select sum(t.amount_net)::bigint
        from public.transactions t
        where t.company_id = (select id from cid)
          and t.removed_at is null
          and t.direction = 'income'
          and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')
          and t.project_id is not null
      ), 0) as total_income,
      coalesce((
        select -sum(t.amount_net)::bigint
        from public.transactions t
        where t.company_id = (select id from cid)
          and t.removed_at is null
          and t.pnl_role = 'overhead'
      ), 0) as overhead_cost
  ),
  rounded as (
    select
      p.id as project_id,
      p.name as project_name,
      s.income,
      (select overhead_cost from totals)::numeric * s.income / (select total_income from totals) as exact,
      private.round_agorot_shekel_hundreds(
        (select overhead_cost from totals)::numeric * s.income / (select total_income from totals)
      ) as rounded
    from public.projects p
    join (
      select t.project_id, sum(t.amount_net)::bigint as income
      from public.transactions t
      where t.company_id = (select id from cid)
        and t.removed_at is null
        and t.direction = 'income'
        and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')
        and t.project_id is not null
      group by t.project_id
      having sum(t.amount_net) > 0
    ) s on s.project_id = p.id
    where p.company_id = (select id from cid)
      and (select id from cid) is not null
      and (select total_income from totals) <> 0
  ),
  chosen as (
    select r.project_id
    from rounded r
    order by
      case when (select max(x.exact - x.rounded) from rounded x) > 0 then (r.exact - r.rounded) end desc nulls last,
      case when (select max(x.exact - x.rounded) from rounded x) <= 0 then r.income end desc nulls last,
      r.project_name asc
    limit 1
  ),
  adjusted as (
    select
      r.project_id,
      r.rounded + case
        when r.project_id = (select c.project_id from chosen c)
          then (select overhead_cost from totals) - (select coalesce(sum(x.rounded), 0) from rounded x)
        else 0
      end as share
    from rounded r
  )
  select
    (select id from cid) is not null and (select total_income from totals) <> 0,
    case
      when (select id from cid) is null or (select total_income from totals) = 0 then null::bigint
      else coalesce((select a.share from adjusted a where a.project_id = p_project), 0)
    end;
$$;

revoke all on function private.overhead_share(uuid) from public, anon;
grant execute on function private.overhead_share(uuid) to authenticated, service_role;

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
  available boolean;
  share bigint;
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
  select s.available, s.share_agorot into available, share
  from private.overhead_share(p_id) s;
  return result || jsonb_build_object(
    'profit_agorot', profit,
    'overhead_share_agorot', case when coalesce(available, false) then coalesce(share, 0) else null end,
    'overhead_weighted', coalesce(available, false),
    'profit_after_overhead_agorot', profit - case when coalesce(available, false) then coalesce(share, 0) else 0 end
  );
end;
$$;

create or replace function public.get_transaction(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'description', t.description,
    'direction', t.direction,
    'doc_kind', t.doc_kind,
    'doc_date', t.doc_date,
    'amount_gross', t.amount_gross,
    'amount_net', t.amount_net,
    'vat_amount', t.vat_amount,
    'vat_status', t.vat_status,
    'source', t.source,
    'project_id', t.project_id,
    'project_name', p.name,
    'category_id', t.category_id,
    'category_name', c.name,
    'supplier_name', s.name,
    'customer_name', cu.name,
    'review_status', (
      select q.status
      from public.review_queue q
      where q.transaction_id = t.id and q.company_id = t.company_id
      order by case when q.status = 'open' then 0 else 1 end, q.created_at desc
      limit 1
    ),
    'paid', t.cash_date is not null,
    'open_gross_agorot', case
      when t.doc_kind = 'invoice' and t.external_id is not null then
        t.amount_gross
        + coalesce((
          select sum(cred.amount_gross)::bigint
          from public.transactions cred
          where cred.company_id = t.company_id
            and cred.removed_at is null
            and cred.doc_kind = 'credit'
            and cred.linked_external_id = t.external_id
        ), 0)
        - coalesce((
          select sum(rec.amount_gross)::bigint
          from public.transactions rec
          where rec.company_id = t.company_id
            and rec.removed_at is null
            and rec.doc_kind = 'receipt'
            and rec.linked_external_id = t.external_id
        ), 0)
      else null
    end,
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', a.project_id,
        'project_name', ap.name,
        'share_bp', a.share_bp,
        'amount_net', a.amount_net
      ) order by ap.name)
      from public.allocations a
      join public.projects ap on ap.id = a.project_id
      where a.transaction_id = t.id
    ), '[]'::jsonb)
  )
  from public.transactions t
  left join public.projects p on p.id = t.project_id
  left join public.categories c on c.id = t.category_id
  left join public.suppliers s on s.id = t.supplier_id
  left join public.customers cu on cu.id = t.customer_id
  where t.id = p_id
    and t.removed_at is null
    and t.company_id = (select private.current_company_id());
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
         q.prior_user_assigned, q.prior_allocations, q.prior_remembered_category_id,
         q.written_remembered_category_id
  into txn, prior_project, prior_category, prior_role, prior_assigned, prior_shares,
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

create function public.reassign_transaction(
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
  prior_shares jsonb;
  cat_kind text;
  review_id uuid;
  undo_id uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select t.direction, t.amount_net, t.project_id, t.category_id, t.pnl_role, t.user_assigned
  into direction, net, prior_project, prior_category, prior_role, prior_assigned
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
        prior_allocations = prior_shares
    where id = review_id and company_id = cid;
  end if;

  insert into public.reassign_undo (
    company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
    prior_user_assigned, prior_allocations, prior_review_id
  ) values (
    cid, p_id, prior_project, prior_category, prior_role,
    coalesce(prior_assigned, false), prior_shares, review_id
  )
  returning id into undo_id;
  return undo_id;
end;
$$;

revoke all on function public.reassign_transaction(uuid, uuid, uuid) from public, anon;
grant execute on function public.reassign_transaction(uuid, uuid, uuid) to authenticated, service_role;

create function public.undo_reassign(p_id uuid)
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
  review_id uuid;
  item jsonb;
  updated int;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select u.transaction_id, u.prior_project_id, u.prior_category_id, u.prior_pnl_role,
         u.prior_user_assigned, u.prior_allocations, u.prior_review_id
  into txn, prior_project, prior_category, prior_role, prior_assigned, prior_shares, review_id
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
      user_assigned = prior_assigned
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
  end if;

  update public.reassign_undo
  set undone_at = now()
  where id = p_id and company_id = cid;
end;
$$;

revoke all on function public.undo_reassign(uuid) from public, anon;
grant execute on function public.undo_reassign(uuid) to authenticated, service_role;

create function public.create_category(p_name text, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  clean text;
  next_sort integer;
  rid uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  clean := btrim(coalesce(p_name, ''));
  if char_length(clean) < 2 then
    raise exception 'category name is too short';
  end if;
  if p_kind not in ('expense', 'income') then
    raise exception 'unknown category kind';
  end if;
  if exists (
    select 1 from public.categories c
    where c.company_id = cid and c.kind = p_kind::public.category_kind and c.name = clean
  ) then
    raise exception 'category already exists';
  end if;
  select coalesce(max(c.sort_order), 0) + 1 into next_sort
  from public.categories c
  where c.company_id = cid and c.kind = p_kind::public.category_kind;
  insert into public.categories (company_id, name, kind, sort_order, is_default)
  values (cid, clean, p_kind::public.category_kind, next_sort, false)
  returning id into rid;
  return rid;
end;
$$;

revoke all on function public.create_category(text, text) from public, anon;
grant execute on function public.create_category(text, text) to authenticated, service_role;

-- One update, so a sweep error cannot be cleared by a stamp that raced the read.
create function public.stamp_sumit_sync(p_company uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated int;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  update public.sumit_connections
  set last_sync_at = now(),
      last_error = case when last_error like 'sync_sweep%' then last_error else null end
  where company_id = p_company;
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'could not stamp the sync';
  end if;
end;
$$;

revoke all on function public.stamp_sumit_sync(uuid) from public, anon, authenticated;
grant execute on function public.stamp_sumit_sync(uuid) to service_role;

-- Extensions where the image allows them. A missing preload does not fail the migration.
do $$
begin
  begin
    create extension if not exists pg_net with schema extensions;
  exception
    when others then
      raise notice 'pg_net was not created: %', sqlerrm;
  end;
  begin
    create extension if not exists pg_cron;
  exception
    when others then
      raise notice 'pg_cron was not created: %', sqlerrm;
  end;
end;
$$;

-- Schedule the drain only when both extensions exist and Vault holds a secret.
-- The job reads the secret when it runs. An empty header is not a fallback.
do $$
declare
  secret text;
begin
  if to_regclass('cron.job') is not null then
    begin
      perform cron.unschedule('flow-sumit-drain');
    exception
      when others then
        null;
    end;
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'flow-sumit-drain skipped: pg_cron or pg_net is missing';
    return;
  end if;

  begin
    execute $sql$
      select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1
    $sql$ into secret;
  exception
    when undefined_table or invalid_schema_name then
      secret := null;
  end;

  if secret is null or btrim(secret) = '' then
    raise notice 'flow-sumit-drain skipped: cron_secret is missing';
    return;
  end if;

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
          'x-flow-cron', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'cron_secret'
            limit 1
          )
        ),
        body := '{}'::jsonb
      )
      where exists (
        select 1 from public.sumit_refresh_requests where claimed_at is null
      );
    $cron$
  );
exception
  when undefined_table or undefined_function then
    raise notice 'flow-sumit-drain skipped: %', sqlerrm;
end;
$$;
