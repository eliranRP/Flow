-- MCP cycle 3b. Decision 0080.
-- approve_review_item, approve_split_review, and reopen_review read the review
-- without a lock, lock the transaction, then lock the review and re-check its
-- status. A deadlock or serialization failure inside resolve_review is
-- re-raised so the caller can retry instead of storing a refused result.
-- שויכו היום is today's SUMIT filings plus this user's assistant approvals
-- that are still approved.

-- One row per transaction on שויכו היום. assistant is true when this user's
-- assistant approved it today and the approval is not undone.
create or replace function private.filed_today_rows()
returns table (id uuid, assistant boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select (date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem') as start_at
  ),
  assistant_rows as (
    select distinct w.transaction_id as id
    from private.mcp_writes w
    join public.transactions t on t.id = w.transaction_id
    cross join bounds
    where w.user_id = auth.uid()
      and w.kind = 'review'
      and w.undone_at is null
      and w.transaction_id is not null
      and w.created_at >= bounds.start_at
      and t.company_id = private.current_company_id()
      and t.removed_at is null
      and not exists (
        select 1
        from public.review_queue open_row
        where open_row.transaction_id = t.id
          and open_row.status = 'open'
      )
  ),
  sumit_rows as (
    select filed.id
    from public.transactions filed
    cross join bounds
    where filed.company_id = private.current_company_id()
      and filed.source = 'sumit'
      and filed.removed_at is null
      and filed.created_at >= bounds.start_at
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
  select ids.id, (assistant_rows.id is not null) as assistant
  from (
    select sumit_rows.id from sumit_rows
    union
    select assistant_rows.id from assistant_rows
  ) ids
  left join assistant_rows on assistant_rows.id = ids.id;
$$;

revoke all on function private.filed_today_rows() from public, anon;
grant execute on function private.filed_today_rows() to authenticated, service_role;

create or replace function public.approve_review_item(
  p_id uuid,
  p_project_id uuid,
  p_category_id uuid,
  p_remember boolean default false,
  p_shown_project_id uuid default null,
  p_shown_category_id uuid default null,
  p_check_shown boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  txn uuid;
  item_company uuid;
  item_status public.review_status;
  cur_project uuid;
  cur_category uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    return private.mcp_refused('no company');
  end if;
  if p_id is null then
    return private.mcp_error('not_found', 'not found');
  end if;

  select q.company_id, q.transaction_id
  into item_company, txn
  from public.review_queue q
  where q.id = p_id;

  if item_company is null or item_company is distinct from cid then
    return private.mcp_error('not_found', 'not found');
  end if;

  -- The expense, then the review. The MCP wrappers and the sync use this order.
  select t.project_id, t.category_id
  into cur_project, cur_category
  from public.transactions t
  where t.id = txn
    and t.company_id = cid
  for update;

  select q.company_id, q.status
  into item_company, item_status
  from public.review_queue q
  where q.id = p_id
  for update;

  if item_company is null or item_company is distinct from cid then
    return private.mcp_error('not_found', 'not found');
  end if;
  if item_status is distinct from 'open' then
    return private.mcp_error('already_closed', 'already closed');
  end if;

  if coalesce(p_check_shown, false)
    and (
      cur_project is distinct from p_shown_project_id
      or cur_category is distinct from p_shown_category_id
    )
  then
    return private.mcp_error('stale', 'stale');
  end if;

  begin
    perform public.resolve_review(
      p_id,
      'approved',
      p_project_id,
      p_category_id,
      coalesce(p_remember, false),
      true
    );
  exception
    when others then
      if sqlstate in ('40P01', '40001') then
        raise;
      end if;
      return private.mcp_refused(sqlerrm);
  end;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.approve_review_item(uuid, uuid, uuid, boolean, uuid, uuid, boolean) from public, anon, authenticated, service_role;

grant execute on function public.approve_review_item(uuid, uuid, uuid, boolean, uuid, uuid, boolean) to authenticated;

create or replace function public.list_auto_assigned_today()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', filed.id,
    'description', filed.description,
    'doc_date', filed.doc_date,
    'amount_net', filed.amount_net,
    'direction', filed.direction,
    'supplier_name', s.name,
    'project_name', p.name,
    'category_name', c.name
  ) order by filed.created_at desc, filed.id), '[]'::jsonb)
  from public.transactions filed
  join private.filed_today_rows() ids on ids.id = filed.id
  left join public.suppliers s on s.id = filed.supplier_id
  left join public.projects p on p.id = filed.project_id
  left join public.categories c on c.id = filed.category_id;
$$;

revoke all on function public.list_auto_assigned_today() from public, anon;
grant execute on function public.list_auto_assigned_today() to authenticated, service_role;

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
    'auto_approved_today', (select count(*)::int from private.filed_today_rows()),
    'assistant_filed_today', coalesce((select bool_or(filed.assistant) from private.filed_today_rows() filed), false)
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

-- Read the review, lock the expense, then lock the review again and re-check it.
create or replace function public.approve_split_review(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  txn uuid;
  reason text;
  item_status public.review_status;
  direction public.txn_direction;
  kind public.doc_kind;
  role public.pnl_role;
  category uuid;
  project uuid;
  assigned boolean;
  suggested boolean;
  supplier uuid;
  net bigint;
  gross bigint;
  doc_date date;
  description text;
  external_id text;
  shares jsonb;
  share_count integer;
  prior_remembered uuid;
  cat_kind text;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;

  select q.transaction_id
  into txn
  from public.review_queue q
  where q.id = p_id and q.company_id = cid;
  if txn is null then
    raise exception 'review item not found';
  end if;

  select t.direction, t.doc_kind, t.pnl_role, t.category_id, t.project_id, t.user_assigned,
         t.category_suggested, t.supplier_id, t.amount_net, t.amount_gross, t.doc_date,
         t.description, t.external_id
  into direction, kind, role, category, project, assigned, suggested, supplier, net, gross,
       doc_date, description, external_id
  from public.transactions t
  where t.id = txn and t.company_id = cid and t.removed_at is null
  for update;
  if direction is null then
    raise exception 'review item not found';
  end if;

  select q.reason, q.status
  into reason, item_status
  from public.review_queue q
  where q.id = p_id and q.company_id = cid
  for update;
  if item_status is distinct from 'open' then
    raise exception 'review item not found';
  end if;
  if direction = 'income' then
    raise exception 'income is not split';
  end if;
  if reason = 'unallocated_shared' then
    raise exception 'shared costs are split, not assigned to one project';
  end if;

  select count(*)::integer into share_count
  from public.allocations a
  where a.transaction_id = txn;
  if role is distinct from 'shared' and share_count <= 1 then
    raise exception 'transaction is not split';
  end if;
  if category is null then
    raise exception 'category is required';
  end if;
  select c.kind::text into cat_kind
  from public.categories c
  where c.id = category and c.company_id = cid;
  if cat_kind is null or cat_kind is distinct from direction::text then
    raise exception 'category kind must match the direction';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  ) order by a.project_id), '[]'::jsonb)
  into shares
  from public.allocations a
  where a.transaction_id = txn;

  prior_remembered := null;
  if supplier is not null then
    select s.remembered_category_id into prior_remembered
    from public.suppliers s
    where s.id = supplier and s.company_id = cid;
  end if;

  update public.review_queue q
  set status = 'approved',
      resolved_at = now(),
      prior_project_id = project,
      prior_category_id = category,
      prior_pnl_role = role,
      prior_user_assigned = assigned,
      prior_category_suggested = suggested,
      prior_allocations = shares,
      prior_remembered_category_id = prior_remembered,
      written_remembered_category_id = null,
      doc_fingerprint = private.doc_fingerprint(direction::text, kind::text, gross, doc_date, description, external_id)
  where q.id = p_id
    and q.company_id = cid
    and q.status = 'open'
    and exists (
      select 1
      from public.transactions t
      where t.id = q.transaction_id
        and t.company_id = q.company_id
        and t.removed_at is null
    );
  if not found then
    raise exception 'review item not found';
  end if;
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
  item_status public.review_status;
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
         q.prior_remembered_category_id, q.written_remembered_category_id, q.status
  into prior_project, prior_category, prior_role, prior_assigned, prior_suggested, prior_shares,
       prior_remembered, written, item_status
  from public.review_queue q
  where q.id = p_id
    and q.company_id = cid
  for update;
  if item_status is null or item_status not in ('approved', 'skipped', 'changed') then
    raise exception 'review item not found';
  end if;

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
