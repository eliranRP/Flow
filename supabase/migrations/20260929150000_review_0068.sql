-- Round 9 (decision 0068). Migrations are append-only from this file on.
-- Hosted Supabase had only Phase 0 when 20260929120000 was edited in place. That edit stays.
-- Do not edit a migration after it has been applied. Add a new file instead.
-- A category save closes only an open missing_category item. Connecting a different SUMIT company retires that company's ledger first.

create or replace function private.bytea_from_hex(p_hex text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.decode(replace(p_hex, '\x', ''), 'hex');
$$;

revoke all on function private.bytea_from_hex(text) from public, anon, authenticated;

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

-- One transaction: reset the backoff, and retire the previous SUMIT ledger when the company id changes.
create or replace function public.replace_sumit_connection(
  p_company uuid,
  p_sumit_company_id bigint,
  p_key_ciphertext text,
  p_key_nonce text,
  p_dek_ciphertext text,
  p_dek_nonce text,
  p_kek_version text,
  p_envelope_version text
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

  select s.sumit_company_id into previous
  from public.sumit_connections s
  where s.company_id = p_company
  for update;

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
end;
$$;

revoke all on function public.replace_sumit_connection(uuid, bigint, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.replace_sumit_connection(uuid, bigint, text, text, text, text, text, text) to service_role;
