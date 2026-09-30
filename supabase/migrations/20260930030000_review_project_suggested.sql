-- Decision 0075, amended by the r33 review.
-- list_review reports project_suggested, so a project the owner picked, or one
-- the supplier rule remembers, is not labelled a suggestion. approve_split_review
-- locks the review row and refuses a review that is no longer open.

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

  select q.transaction_id, q.reason
  into txn, reason
  from public.review_queue q
  where q.id = p_id and q.company_id = cid and q.status = 'open'
  for update;
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

revoke all on function public.approve_split_review(uuid) from public, anon;
grant execute on function public.approve_split_review(uuid) to authenticated, service_role;
