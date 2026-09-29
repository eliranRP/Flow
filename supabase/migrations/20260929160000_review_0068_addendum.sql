-- Decision 0068 addendum. Append-only. Do not edit 20260929150000 or anything older.
-- Disconnect remembers the last SUMIT company id. Connect compares against it.
-- A failed validation raises before any ledger write.

alter table public.companies
  add column last_sumit_company_id bigint;

comment on column public.companies.last_sumit_company_id is
  'Last SUMIT company id. Disconnect keeps it so the next connect can retire a different ledger. Decision 0068 addendum.';

update public.companies c
set last_sumit_company_id = s.sumit_company_id
from public.sumit_connections s
where s.company_id = c.id
  and c.last_sumit_company_id is null;

create or replace function public.disconnect_sumit()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select c.id into cid from public.companies c where c.owner_id = (select auth.uid());
  if cid is null then
    raise exception 'no company';
  end if;
  update public.companies c
  set last_sumit_company_id = s.sumit_company_id
  from public.sumit_connections s
  where c.id = cid and s.company_id = cid;
  delete from public.sumit_connections where company_id = cid;
end;
$$;

revoke all on function public.disconnect_sumit() from public, anon;
grant execute on function public.disconnect_sumit() to authenticated, service_role;

-- Closing a missing category on an unsplit shared cost opens the split item in the same call.
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
  prior_shares jsonb;
  cat_kind text;
  prior_review uuid;
  undo_id uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select t.direction, t.project_id, t.category_id, t.pnl_role, t.user_assigned
  into direction, prior_project, prior_category, prior_role, prior_assigned
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
    prior_user_assigned, prior_allocations, prior_review_id
  ) values (
    cid, p_id, prior_project, prior_category, prior_role,
    coalesce(prior_assigned, false), prior_shares, prior_review
  )
  returning id into undo_id;
  return undo_id;
end;
$$;

revoke all on function public.set_transaction_category(uuid, uuid) from public, anon;
grant execute on function public.set_transaction_category(uuid, uuid) to authenticated, service_role;

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

revoke all on function public.undo_reassign(uuid) from public, anon;
grant execute on function public.undo_reassign(uuid) to authenticated, service_role;

drop function public.replace_sumit_connection(uuid, bigint, text, text, text, text, text, text);

-- p_validated must be true. The connect function sets it only after one listfolders read succeeds.
create function public.replace_sumit_connection(
  p_company uuid,
  p_sumit_company_id bigint,
  p_key_ciphertext text,
  p_key_nonce text,
  p_dek_ciphertext text,
  p_dek_nonce text,
  p_kek_version text,
  p_envelope_version text,
  p_validated boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous bigint;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_company is null or p_sumit_company_id is null or p_sumit_company_id <= 0 then
    raise exception 'company id is required';
  end if;
  if p_validated is not true then
    raise exception 'validation failed';
  end if;

  select s.sumit_company_id into previous
  from public.sumit_connections s
  where s.company_id = p_company
  for update;

  if previous is null then
    select c.last_sumit_company_id into previous
    from public.companies c
    where c.id = p_company
    for update;
  end if;

  if previous is not null and previous is distinct from p_sumit_company_id then
    update public.review_queue q
    set status = 'skipped',
        resolved_at = pg_catalog.now()
    where q.company_id = p_company
      and q.status = 'open'
      and q.transaction_id in (
        select t.id
        from public.transactions t
        where t.company_id = p_company
          and t.source = 'sumit'
          and t.removed_at is null
      );

    update public.transactions t
    set removed_at = pg_catalog.now()
    where t.company_id = p_company
      and t.source = 'sumit'
      and t.removed_at is null;
  end if;

  insert into public.sumit_connections (
    company_id, sumit_company_id,
    key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
    kek_version, envelope_version,
    last_error, reject_attempts, next_attempt_at, last_sync_at
  ) values (
    p_company,
    p_sumit_company_id,
    private.bytea_from_hex(p_key_ciphertext),
    private.bytea_from_hex(p_key_nonce),
    private.bytea_from_hex(p_dek_ciphertext),
    private.bytea_from_hex(p_dek_nonce),
    p_kek_version,
    p_envelope_version,
    null,
    0,
    null,
    null
  )
  on conflict (company_id) do update
  set sumit_company_id = excluded.sumit_company_id,
      key_ciphertext = excluded.key_ciphertext,
      key_nonce = excluded.key_nonce,
      dek_ciphertext = excluded.dek_ciphertext,
      dek_nonce = excluded.dek_nonce,
      kek_version = excluded.kek_version,
      envelope_version = excluded.envelope_version,
      last_error = null,
      reject_attempts = 0,
      next_attempt_at = null,
      last_sync_at = null;

  update public.companies
  set last_sumit_company_id = p_sumit_company_id
  where id = p_company;
end;
$$;

revoke all on function public.replace_sumit_connection(uuid, bigint, text, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.replace_sumit_connection(uuid, bigint, text, text, text, text, text, text, boolean) to service_role;
