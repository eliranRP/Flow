-- FLOW-206. Bulk setup without rate-limit stalls (decision 0119).
-- create_projects and create_categories create up to 100 rows in one MCP write, so a company
-- setup is one or two calls instead of one per row and stays inside the write rate limit.
-- Each row runs through mcp_create_project / mcp_create_category with the row key
-- key:ordinal, as assign_expenses does, and the batch is recorded in private.mcp_batches so
-- undo_batch removes every row it created. A taken name is refused and returns existing_id.
-- mcp_undo_batch is as in 20261006220000_mcp_batch.sql, except that a row with no
-- transaction (a created project or category) is reported by its id and name.

begin;

-- How undo_batch names a row: by its transaction, or by the id and name it created.
create or replace function private.mcp_batch_row_ref(p_row jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_row ? 'transaction_id' then jsonb_build_object('transaction_id', p_row->>'transaction_id')
    else jsonb_strip_nulls(jsonb_build_object(
      'id', p_row->>'undo_id', 'name', coalesce(p_row->>'name', ''), 'kind', p_row->>'kind'
    ))
  end;
$$;

revoke all on function private.mcp_batch_row_ref(jsonb) from public, anon, authenticated, service_role;

create or replace function public.mcp_create_projects(
  p_idempotency_key text,
  p_items jsonb
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
  batch_id uuid := gen_random_uuid();
  item jsonb;
  ord int := 0;
  row_key text;
  row_result jsonb;
  found_id uuid;
  results jsonb := '[]'::jsonb;
  row_writes jsonb := '[]'::jsonb;
  ok_count int := 0;
  error_count int := 0;
  response jsonb;
begin
  -- Row keys are key:ordinal, and mcp_create_project caps keys at 128.
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 124
    or p_items is null
    or jsonb_typeof(p_items) <> 'array'
  then
    return private.mcp_error('validation', 'validation');
  end if;

  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    return private.mcp_error('validation', 'validation');
  end if;

  -- The same name twice in one batch is a client mistake, not a row to refuse.
  if exists (
    select 1
    from jsonb_array_elements(p_items) elem
    where jsonb_typeof(elem) = 'object' and jsonb_typeof(elem->'name') = 'string'
    group by btrim(elem->>'name')
    having count(*) > 1
  ) then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'projects_batch|' || md5(p_items::text);
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  for item in select value from jsonb_array_elements(p_items)
  loop
    ord := ord + 1;
    row_key := p_idempotency_key || ':' || ord::text;
    row_result := null;
    found_id := null;

    if jsonb_typeof(item) <> 'object' then
      row_result := private.mcp_error('validation', 'validation');
    elsif jsonb_typeof(item->'name') is distinct from 'string'
      or item ? 'status' and (
        jsonb_typeof(item->'status') <> 'string' or item->>'status' not in ('active', 'finished')
      )
      or exists (select 1 from jsonb_object_keys(item) k where k not in ('name', 'status'))
    then
      row_result := private.mcp_error('validation', 'validation');
    else
      begin
        row_result := public.mcp_create_project(row_key, item->>'name', item->>'status');
      exception
        when deadlock_detected or serialization_failure then
          row_result := private.mcp_error('unavailable', 'retry');
        when others then
          row_result := private.mcp_refused(sqlerrm);
      end;
    end if;

    if row_result->>'ok' = 'true' then
      ok_count := ok_count + 1;
      results := results || jsonb_build_array(jsonb_build_object(
        'name', btrim(item->>'name'),
        'ok', true,
        'id', row_result->'data'->>'id',
        'undo_kind', 'project'
      ));
      row_writes := row_writes || jsonb_build_array(jsonb_build_object(
        'ordinal', ord,
        'name', btrim(item->>'name'),
        'undo_kind', 'project',
        'undo_id', row_result->'data'->>'id'
      ));
    else
      error_count := error_count + 1;
      -- A name that is already taken returns that row's id, so a rerun of a setup can go on.
      if jsonb_typeof(item) = 'object' and jsonb_typeof(item->'name') = 'string' then
        select p.id into found_id
        from public.projects p
        where p.company_id = cid
          and p.name = btrim(item->>'name')
        limit 1;
      end if;
      results := results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'name', case when jsonb_typeof(item) = 'object' and jsonb_typeof(item->'name') = 'string'
          then btrim(item->>'name') else '' end,
        'ok', false,
        'code', coalesce(row_result->'error'->>'code', 'refused'),
        'existing_id', found_id
      )));
    end if;
  end loop;

  response := jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'batch_key', batch_id,
      'ok_count', ok_count,
      'error_count', error_count,
      'results', results
    )
  );

  insert into private.mcp_batches (id, token_id, user_id, company_id, idempotency_key, row_writes)
  values (batch_id, token, auth.uid(), cid, p_idempotency_key, row_writes);

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_create_projects(text, jsonb) from public, anon, authenticated, service_role;

grant execute on function public.mcp_create_projects(text, jsonb) to authenticated;

create or replace function public.mcp_create_categories(
  p_idempotency_key text,
  p_items jsonb
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
  batch_id uuid := gen_random_uuid();
  item jsonb;
  ord int := 0;
  row_key text;
  row_result jsonb;
  found_id uuid;
  results jsonb := '[]'::jsonb;
  row_writes jsonb := '[]'::jsonb;
  ok_count int := 0;
  error_count int := 0;
  response jsonb;
begin
  -- Row keys are key:ordinal, and mcp_create_category caps keys at 128.
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 124
    or p_items is null
    or jsonb_typeof(p_items) <> 'array'
  then
    return private.mcp_error('validation', 'validation');
  end if;

  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    return private.mcp_error('validation', 'validation');
  end if;

  -- The same name twice in one batch is a client mistake, not a row to refuse.
  if exists (
    select 1
    from jsonb_array_elements(p_items) elem
    where jsonb_typeof(elem) = 'object' and jsonb_typeof(elem->'name') = 'string'
    group by coalesce(elem->>'kind', '') || '|' || btrim(elem->>'name')
    having count(*) > 1
  ) then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'categories_batch|' || md5(p_items::text);
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  for item in select value from jsonb_array_elements(p_items)
  loop
    ord := ord + 1;
    row_key := p_idempotency_key || ':' || ord::text;
    row_result := null;
    found_id := null;

    if jsonb_typeof(item) <> 'object' then
      row_result := private.mcp_error('validation', 'validation');
    elsif jsonb_typeof(item->'name') is distinct from 'string'
      or jsonb_typeof(item->'kind') is distinct from 'string'
      or item->>'kind' not in ('expense', 'income')
      or exists (select 1 from jsonb_object_keys(item) k where k not in ('name', 'kind'))
    then
      row_result := private.mcp_error('validation', 'validation');
    else
      begin
        row_result := public.mcp_create_category(row_key, item->>'name', item->>'kind');
      exception
        when deadlock_detected or serialization_failure then
          row_result := private.mcp_error('unavailable', 'retry');
        when others then
          row_result := private.mcp_refused(sqlerrm);
      end;
    end if;

    if row_result->>'ok' = 'true' then
      ok_count := ok_count + 1;
      results := results || jsonb_build_array(jsonb_build_object(
        'name', btrim(item->>'name'),
        'kind', item->>'kind',
        'ok', true,
        'id', row_result->'data'->>'id',
        'undo_kind', 'category'
      ));
      row_writes := row_writes || jsonb_build_array(jsonb_build_object(
        'ordinal', ord,
        'name', btrim(item->>'name'),
        'kind', item->>'kind',
        'undo_kind', 'category',
        'undo_id', row_result->'data'->>'id'
      ));
    else
      error_count := error_count + 1;
      -- A name that is already taken returns that row's id, so a rerun of a setup can go on.
      if jsonb_typeof(item) = 'object' and jsonb_typeof(item->'name') = 'string' then
        select c.id into found_id
        from public.categories c
        where c.company_id = cid
          and c.kind::text = item->>'kind'
          and c.name = btrim(item->>'name')
        limit 1;
      end if;
      results := results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'name', case when jsonb_typeof(item) = 'object' and jsonb_typeof(item->'name') = 'string'
          then btrim(item->>'name') else '' end,
        'kind', case when jsonb_typeof(item) = 'object' then item->>'kind' end,
        'ok', false,
        'code', coalesce(row_result->'error'->>'code', 'refused'),
        'existing_id', found_id
      )));
    end if;
  end loop;

  response := jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'batch_key', batch_id,
      'ok_count', ok_count,
      'error_count', error_count,
      'results', results
    )
  );

  insert into private.mcp_batches (id, token_id, user_id, company_id, idempotency_key, row_writes)
  values (batch_id, token, auth.uid(), cid, p_idempotency_key, row_writes);

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_create_categories(text, jsonb) from public, anon, authenticated, service_role;

grant execute on function public.mcp_create_categories(text, jsonb) to authenticated;

create or replace function public.mcp_undo_batch(
  p_idempotency_key text,
  p_batch_key text
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
  batch_rec private.mcp_batches%rowtype;
  row jsonb;
  row_result jsonb;
  results jsonb := '[]'::jsonb;
  ok_count int := 0;
  error_count int := 0;
  response jsonb;
  undo_kind text;
  undo_id uuid;
  row_key text;
begin
  -- Row keys are key:ordinal, and mcp_undo caps keys at 128.
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 124
    or p_batch_key is null
    or p_batch_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'batch_undo|' || p_batch_key;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  select * into batch_rec
  from private.mcp_batches b
  where b.id = p_batch_key::uuid
    and b.user_id = auth.uid()
    and b.company_id = private.current_company_id();

  if not found then
    return private.mcp_error('not_found', 'not found');
  end if;

  for row in
    select value
    from jsonb_array_elements(batch_rec.row_writes)
    order by (value->>'ordinal')::int desc
  loop
    undo_kind := row->>'undo_kind';
    undo_id := (row->>'undo_id')::uuid;
    row_key := p_idempotency_key || ':' || (row->>'ordinal');
    begin
      row_result := public.mcp_undo(row_key, undo_kind, undo_id);
    exception
      when deadlock_detected or serialization_failure then
        row_result := private.mcp_error('unavailable', 'retry');
      when others then
        row_result := private.mcp_refused(sqlerrm);
    end;

    if row_result->>'ok' = 'true' then
      ok_count := ok_count + 1;
      results := results || jsonb_build_array(private.mcp_batch_row_ref(row) || jsonb_build_object('ok', true));
    else
      error_count := error_count + 1;
      results := results || jsonb_build_array(private.mcp_batch_row_ref(row) || jsonb_build_object(
        'ok', false,
        'code', coalesce(row_result->'error'->>'code', 'refused')
      ));
    end if;
  end loop;

  response := jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'batch_key', p_batch_key,
      'ok_count', ok_count,
      'error_count', error_count,
      'results', results
    )
  );

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_undo_batch(text, text) from public, anon, authenticated, service_role;

grant execute on function public.mcp_undo_batch(text, text) to authenticated;

commit;
