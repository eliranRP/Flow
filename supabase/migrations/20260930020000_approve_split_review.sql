-- Decision 0075, amended. Append-only.
-- אישור on a categorised split closes the review and leaves the shares,
-- the amounts, the role, and the supplier rule untouched. resolve_review
-- still collapses a split onto one project, so this is a separate function.

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
  where q.id = p_id and q.company_id = cid and q.status = 'open';
  if txn is null then
    raise exception 'review item not found';
  end if;

  select t.direction, t.doc_kind, t.pnl_role, t.category_id, t.project_id, t.user_assigned,
         t.category_suggested, t.supplier_id, t.amount_net, t.amount_gross, t.doc_date,
         t.description, t.external_id
  into direction, kind, role, category, project, assigned, suggested, supplier, net, gross,
       doc_date, description, external_id
  from public.transactions t
  where t.id = txn and t.company_id = cid
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

  update public.review_queue
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
  where id = p_id and company_id = cid;
end;
$$;

revoke all on function public.approve_split_review(uuid) from public, anon;
grant execute on function public.approve_split_review(uuid) to authenticated, service_role;

comment on function public.approve_split_review(uuid) is
  'Closes a categorised split review. Shares, amounts, and the supplier rule stay. Decision 0075.';
