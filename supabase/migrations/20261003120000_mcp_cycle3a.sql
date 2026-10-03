-- MCP cycle 3a. Single-expense writes, typed undo, and idempotency.
-- Decision 0080. private.mcp_writes already exists (cycle 1). This file does not
-- recreate it. reassign_id is the reassign_undo id the undo tool accepts.
-- The idempotency hash is the canonical argument text. This project does not
-- enable pgcrypto.
-- approve_review_item takes p_check_shown (default false). SQL cannot tell an
-- omitted uuid from null, so the assistant leaves the flag false and the app
-- path (cycle 3b) passes true. remember is applied only when a review is closed
-- here. reassign_transaction has no remember argument.
-- A revoked or expired credential is forbidden. The edge function still returns
-- HTTP 401 before it calls these wrappers.

alter table private.mcp_writes
  add column reassign_id uuid;

comment on column private.mcp_writes.reassign_id is
  'reassign_undo id when kind is reassign. Undo looks this id up for this user. Decision 0080.';

alter table private.mcp_writes drop constraint mcp_writes_target;

alter table private.mcp_writes add constraint mcp_writes_target check (
  (kind = 'review' and review_id is not null)
  or (kind = 'reassign' and transaction_id is not null and reassign_id is not null)
);

create unique index mcp_writes_review_open_idx
  on private.mcp_writes (user_id, review_id)
  where kind = 'review' and undone_at is null;

create unique index mcp_writes_reassign_open_idx
  on private.mcp_writes (user_id, reassign_id)
  where kind = 'reassign' and undone_at is null;

create table private.mcp_idempotency (
  token_id uuid not null references private.mcp_credentials (id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (token_id, idempotency_key)
);

comment on table private.mcp_idempotency is
  'One stored response per token and key. A different request hash is conflict. Written by the definer, not PostgREST. Decision 0080.';

alter table private.mcp_idempotency enable row level security;

revoke all on table private.mcp_idempotency from public, anon, authenticated;

create or replace function private.mcp_error(p_code text, p_message text)
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', false,
    'error', jsonb_build_object('code', p_code, 'message', p_message)
  );
$$;

revoke all on function private.mcp_error(text, text) from public, anon, authenticated;

create or replace function private.mcp_refused(p_message text)
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  select private.mcp_error(
    'refused',
    case
      when p_message in (
        'no company',
        'unknown review action',
        'review item not found',
        'shared costs are split, not assigned to one project',
        'category is required',
        'project or category not found',
        'category kind must match the direction',
        'project and category are required',
        'transaction not found',
        'category not found'
      ) then p_message
      else 'The write was refused.'
    end
  );
$$;

revoke all on function private.mcp_refused(text) from public, anon, authenticated;

-- Post-write shares the undo comparison uses. amount_net is not part of the snapshot.
create or replace function private.mcp_shares(p_txn uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('project_id', a.project_id, 'share_bp', a.share_bp)
    order by a.project_id
  ), '[]'::jsonb)
  from public.allocations a
  where a.transaction_id = p_txn
    and a.company_id = private.current_company_id();
$$;

revoke all on function private.mcp_shares(uuid) from public, anon, authenticated;

-- Fail closed unless the JWT claim mcp_tid is a live write credential for auth.uid().
create or replace function private.mcp_require_writer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims jsonb;
  tid uuid;
  cred private.mcp_credentials%rowtype;
begin
  if auth.uid() is null or private.current_company_id() is null then
    return private.mcp_error('forbidden', 'The write was refused.');
  end if;
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception
    when others then
      claims := null;
  end;
  if claims is null or nullif(claims->>'mcp_tid', '') is null then
    return private.mcp_error('forbidden', 'The write was refused.');
  end if;
  begin
    tid := (claims->>'mcp_tid')::uuid;
  exception
    when invalid_text_representation then
      return private.mcp_error('forbidden', 'The write was refused.');
  end;

  select * into cred
  from private.mcp_credentials
  where id = tid;

  if cred.id is null
    or cred.user_id is distinct from auth.uid()
    or cred.company_id is distinct from private.current_company_id()
  then
    return private.mcp_error('forbidden', 'The write was refused.');
  end if;
  if cred.revoked_at is not null then
    return private.mcp_error('forbidden', 'revoked');
  end if;
  if cred.expires_at <= clock_timestamp() then
    return private.mcp_error('forbidden', 'expired');
  end if;
  if not ('write' = any (coalesce(cred.scope, array[]::text[]))) then
    return private.mcp_error('forbidden', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'token_id', cred.id);
end;
$$;

revoke all on function private.mcp_require_writer() from public, anon, authenticated;

create or replace function private.mcp_idempotency_lookup(
  p_token uuid,
  p_key text,
  p_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_hash text;
  stored jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_token::text || ':' || p_key, 0));
  select request_hash, response
  into stored_hash, stored
  from private.mcp_idempotency
  where token_id = p_token
    and idempotency_key = p_key;
  if stored_hash is null then
    return jsonb_build_object('state', 'proceed');
  end if;
  if stored_hash = p_hash then
    return jsonb_build_object('state', 'replay', 'response', stored);
  end if;
  return jsonb_build_object('state', 'conflict');
end;
$$;

revoke all on function private.mcp_idempotency_lookup(uuid, text, text) from public, anon, authenticated;

create or replace function private.mcp_idempotency_store(
  p_token uuid,
  p_key text,
  p_hash text,
  p_response jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.mcp_idempotency (token_id, idempotency_key, request_hash, response)
  values (p_token, p_key, p_hash, p_response);
end;
$$;

revoke all on function private.mcp_idempotency_store(uuid, text, text, jsonb) from public, anon, authenticated;

-- Shared close. The assistant omits the shown check. The app passes p_check_shown.
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

  select q.company_id, q.status, q.transaction_id
  into item_company, item_status, txn
  from public.review_queue q
  where q.id = p_id
  for update;

  if item_company is null or item_company is distinct from cid then
    return private.mcp_error('not_found', 'not found');
  end if;
  if item_status is distinct from 'open' then
    return private.mcp_error('already_closed', 'already closed');
  end if;

  select t.project_id, t.category_id
  into cur_project, cur_category
  from public.transactions t
  where t.id = txn
    and t.company_id = cid
  for update;

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
      return private.mcp_refused(sqlerrm);
  end;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.approve_review_item(uuid, uuid, uuid, boolean, uuid, uuid, boolean) from public, anon, authenticated, service_role;

grant execute on function public.approve_review_item(uuid, uuid, uuid, boolean, uuid, uuid, boolean) to authenticated;

create or replace function private.mcp_record_write(
  p_token uuid,
  p_txn uuid,
  p_review uuid,
  p_reassign uuid,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  snap_project uuid;
  snap_category uuid;
  snap_role public.pnl_role;
  snap_shares jsonb;
begin
  cid := private.current_company_id();
  select t.project_id, t.category_id, t.pnl_role
  into snap_project, snap_category, snap_role
  from public.transactions t
  where t.id = p_txn
    and t.company_id = cid;
  snap_shares := private.mcp_shares(p_txn);

  if p_kind = 'review' then
    insert into private.mcp_writes (
      token_id, user_id, transaction_id, review_id, kind,
      project_id, category_id, pnl_role, shares
    ) values (
      p_token, auth.uid(), p_txn, p_review, 'review',
      snap_project, snap_category, snap_role, snap_shares
    );
    return jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'undo_kind', 'review',
        'id', p_review,
        'closed_review', true
      )
    );
  end if;

  insert into private.mcp_writes (
    token_id, user_id, transaction_id, reassign_id, kind,
    project_id, category_id, pnl_role, shares
  ) values (
    p_token, auth.uid(), p_txn, p_reassign, 'reassign',
    snap_project, snap_category, snap_role, snap_shares
  );
  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'undo_kind', 'reassign',
      'id', p_reassign,
      'closed_review', false
    )
  );
end;
$$;

revoke all on function private.mcp_record_write(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;

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
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or p_project_id is null
    or p_category_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'assign|' || p_transaction_id::text || '|' || p_project_id::text || '|'
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
    if exists (
      select 1
      from public.review_queue q
      where q.id = p_transaction_id
        and q.company_id = cid
    ) and not exists (
      select 1
      from public.transactions t
      where t.id = p_transaction_id
        and t.company_id = cid
        and t.removed_at is null
    ) then
      response := private.mcp_error(
        'validation',
        'id is not a transaction; list_review.id is the review id'
      );
    elsif not exists (
      select 1
      from public.transactions t
      where t.id = p_transaction_id
        and t.company_id = cid
        and t.removed_at is null
    ) then
      response := private.mcp_refused('transaction not found');
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
  exception
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_assign_expense(text, uuid, uuid, uuid, boolean) from public, anon, authenticated, service_role;

grant execute on function public.mcp_assign_expense(text, uuid, uuid, uuid, boolean) to authenticated;

create or replace function public.mcp_set_expense_category(
  p_idempotency_key text,
  p_transaction_id uuid,
  p_category_id uuid
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
  current_project uuid;
  outcome jsonb;
  undo_id uuid;
  response jsonb;
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
  hash := 'category|' || p_transaction_id::text || '|' || p_category_id::text;
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
    if exists (
      select 1
      from public.review_queue q
      where q.id = p_transaction_id
        and q.company_id = cid
    ) and not exists (
      select 1
      from public.transactions t
      where t.id = p_transaction_id
        and t.company_id = cid
        and t.removed_at is null
    ) then
      response := private.mcp_error(
        'validation',
        'id is not a transaction; list_review.id is the review id'
      );
    else
      select t.project_id into current_project
      from public.transactions t
      where t.id = p_transaction_id
        and t.company_id = cid
        and t.removed_at is null
      for update;
      if not found then
        response := private.mcp_refused('transaction not found');
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
            current_project,
            p_category_id,
            false,
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
          undo_id := public.set_transaction_category(p_transaction_id, p_category_id, true);
          response := private.mcp_record_write(token, p_transaction_id, null, undo_id, 'reassign');
        end if;
      end if;
    end if;
  exception
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_set_expense_category(text, uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function public.mcp_set_expense_category(text, uuid, uuid) to authenticated;

create or replace function public.mcp_undo(
  p_idempotency_key text,
  p_kind text,
  p_id uuid
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
  rec private.mcp_writes%rowtype;
  txn uuid;
  cur_project uuid;
  cur_category uuid;
  cur_role public.pnl_role;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_id is null
    or p_kind is null
    or p_kind not in ('review', 'reassign')
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'undo|' || p_kind || '|' || p_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('not_found', 'not found');
  begin
    select * into rec
    from private.mcp_writes w
    where w.user_id = auth.uid()
      and w.undone_at is null
      and (
        (p_kind = 'review' and w.kind = 'review' and w.review_id = p_id)
        or (p_kind = 'reassign' and w.kind = 'reassign' and w.reassign_id = p_id)
      )
    for update;

    if not found then
      response := private.mcp_error('not_found', 'not found');
    else
      txn := rec.transaction_id;
      select t.project_id, t.category_id, t.pnl_role
      into cur_project, cur_category, cur_role
      from public.transactions t
      where t.id = txn
        and t.company_id = cid
        and t.removed_at is null
      for update;

      if not found
        or cur_project is distinct from rec.project_id
        or cur_category is distinct from rec.category_id
        or cur_role is distinct from rec.pnl_role
        or private.mcp_shares(txn) is distinct from rec.shares
      then
        response := private.mcp_error('conflict', 'conflict');
      else
        if p_kind = 'review' then
          perform public.reopen_review(p_id);
        else
          perform public.undo_reassign(p_id);
        end if;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    end if;
  exception
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_undo(text, text, uuid) from public, anon, authenticated, service_role;

grant execute on function public.mcp_undo(text, text, uuid) to authenticated;
