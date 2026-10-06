-- MCP cycle 4. create_project, create_category, sync_bank, and extended undo.
-- Decision 0090 amends outbound HTTP for sync_bank only. Decision 0080.

begin;

alter table private.mcp_writes drop constraint mcp_writes_kind_check;

alter table private.mcp_writes
  add constraint mcp_writes_kind_check check (
    kind in ('review', 'reassign', 'project', 'category', 'category_hidden')
  );

alter table private.mcp_writes
  add column prior_hidden boolean;

alter table private.mcp_writes drop constraint mcp_writes_target;

alter table private.mcp_writes add constraint mcp_writes_target check (
  (kind = 'review' and review_id is not null)
  or (kind = 'reassign' and transaction_id is not null and reassign_id is not null)
  or (kind = 'project' and project_id is not null)
  or (kind in ('category', 'category_hidden') and category_id is not null)
);

create unique index mcp_writes_project_open_idx
  on private.mcp_writes (user_id, project_id)
  where kind = 'project' and undone_at is null;

-- One open create and one open hide per category. A shared index would refuse
-- hiding a category this user just created.
create unique index mcp_writes_category_open_idx
  on private.mcp_writes (user_id, category_id)
  where kind = 'category' and undone_at is null;

create unique index mcp_writes_category_hidden_open_idx
  on private.mcp_writes (user_id, category_id)
  where kind = 'category_hidden' and undone_at is null;

create or replace function private.mcp_refused(p_message text)
returns jsonb
language sql
immutable
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
        'category not found',
        'project name is too short',
        'project already exists',
        'category name is too short',
        'category already exists',
        'unknown category kind',
        'in use'
      ) then p_message
      else 'The write was refused.'
    end
  );
$$;

revoke all on function private.mcp_refused(text) from public, anon, authenticated;

create or replace function public.mcp_create_project(
  p_idempotency_key text,
  p_name text,
  p_status text default null
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
  rid uuid;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_name is null
    or p_status is not null and p_status not in ('active', 'finished')
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'project|' || btrim(p_name) || '|' || coalesce(p_status, 'active');
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
      from public.projects p
      where p.company_id = cid
        and p.name = btrim(p_name)
    ) then
      response := private.mcp_refused('project already exists');
    else
      rid := public.upsert_project(null, p_name, null, p_status);
      insert into private.mcp_writes (token_id, user_id, kind, project_id)
      values (token, auth.uid(), 'project', rid);
      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object('id', rid, 'undo_kind', 'project')
      );
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

revoke all on function public.mcp_create_project(text, text, text) from public, anon, authenticated, service_role;

grant execute on function public.mcp_create_project(text, text, text) to authenticated;

create or replace function public.mcp_create_category(
  p_idempotency_key text,
  p_name text,
  p_kind text
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
  rid uuid;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_name is null
    or p_kind is null
    or p_kind not in ('expense', 'income')
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'category_new|' || p_kind || '|' || btrim(p_name);
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  response := private.mcp_error('refused', 'The write was refused.');
  begin
    rid := public.create_category(p_name, p_kind);
    insert into private.mcp_writes (token_id, user_id, kind, category_id)
    values (token, auth.uid(), 'category', rid);
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object('id', rid, 'undo_kind', 'category')
    );
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

revoke all on function public.mcp_create_category(text, text, text) from public, anon, authenticated, service_role;

grant execute on function public.mcp_create_category(text, text, text) to authenticated;

create or replace function public.mcp_hide_category(
  p_idempotency_key text,
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
  was_hidden boolean;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_category_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'category_hide|' || p_category_id::text;
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
    select c.hidden into was_hidden
    from public.categories c
    where c.id = p_category_id
      and c.company_id = cid
    for update;

    if not found then
      response := private.mcp_refused('category not found');
    else
      perform public.set_category_hidden(p_category_id, true);
      insert into private.mcp_writes (token_id, user_id, kind, category_id, prior_hidden)
      values (token, auth.uid(), 'category_hidden', p_category_id, was_hidden);
      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object('id', p_category_id, 'undo_kind', 'category_hidden')
      );
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

revoke all on function public.mcp_hide_category(text, uuid) from public, anon, authenticated, service_role;

grant execute on function public.mcp_hide_category(text, uuid) to authenticated;

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
  cur_hidden boolean;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_id is null
    or p_kind is null
    or p_kind not in ('review', 'reassign', 'project', 'category', 'category_hidden')
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
        or (p_kind = 'project' and w.kind = 'project' and w.project_id = p_id)
        or (p_kind in ('category', 'category_hidden') and w.kind = p_kind and w.category_id = p_id)
      )
    for update;

    if not found then
      response := private.mcp_error('not_found', 'not found');
    elsif p_kind = 'project' then
      -- Lock the project first. FK checks on writers that point at it take
      -- FOR KEY SHARE, so they wait for this lock or make it wait; the checks
      -- below then see every committed reference before the delete.
      perform 1 from public.projects p
      where p.id = p_id and p.company_id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif exists (
        select 1 from public.transactions t
        where t.company_id = cid and t.project_id = p_id and t.removed_at is null
      ) or exists (
        select 1 from public.allocations a
        where a.company_id = cid and a.project_id = p_id
      ) or exists (
        select 1 from public.split_rule_targets s
        where s.company_id = cid and s.project_id = p_id
      ) or exists (
        select 1 from public.suppliers sup
        where sup.company_id = cid and sup.remembered_project_id = p_id
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.projects
        where id = p_id and company_id = cid;
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
    elsif p_kind = 'category' then
      perform 1 from public.categories c
      where c.id = p_id and c.company_id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif exists (
        select 1 from public.transactions t
        where t.company_id = cid and t.category_id = p_id and t.removed_at is null
      ) or exists (
        select 1 from public.suppliers sup
        where sup.company_id = cid and sup.remembered_category_id = p_id
      ) or exists (
        select 1 from public.loan_splits ls
        where ls.company_id = cid and ls.category_id = p_id
      ) or exists (
        select 1 from public.review_queue q
        where q.company_id = cid
          and (q.prior_remembered_category_id = p_id or q.written_remembered_category_id = p_id)
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.categories
        where id = p_id and company_id = cid;
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
    elsif p_kind = 'category_hidden' then
      select c.hidden into cur_hidden
      from public.categories c
      where c.id = p_id and c.company_id = cid
      for update;
      if not found or cur_hidden is distinct from true then
        response := private.mcp_error('conflict', 'conflict');
      else
        perform public.set_category_hidden(p_id, rec.prior_hidden);
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
    when deadlock_detected or serialization_failure then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_undo(text, text, uuid) from public, anon, authenticated, service_role;

grant execute on function public.mcp_undo(text, text, uuid) to authenticated;

create or replace function public.mcp_sync_bank_begin(p_idempotency_key text)
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
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'sync_bank';
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  if not exists (
    select 1
    from public.connector_connections cc
    where cc.company_id = cid
      and cc.provider = 'mercury'
  ) then
    return private.mcp_error('not_found', 'bank is not connected');
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('state', 'proceed'));
end;
$$;

revoke all on function public.mcp_sync_bank_begin(text) from public, anon, authenticated, service_role;

grant execute on function public.mcp_sync_bank_begin(text) to authenticated;

create or replace function public.mcp_sync_bank_finish(
  p_idempotency_key text,
  p_response jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_response is null
  then
    return;
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return;
  end if;
  token := (gate->>'token_id')::uuid;

  insert into private.mcp_idempotency (token_id, idempotency_key, request_hash, response)
  values (token, p_idempotency_key, 'sync_bank', p_response)
  on conflict do nothing;
end;
$$;

revoke all on function public.mcp_sync_bank_finish(text, jsonb) from public, anon, authenticated, service_role;

grant execute on function public.mcp_sync_bank_finish(text, jsonb) to authenticated;

commit;
