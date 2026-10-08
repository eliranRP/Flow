-- FLOW-312 (FLOW-311 follow-ups), item 5. An assign_expenses row may carry parts[] instead of
-- project_id / category_id / shares[]: it runs split_line on that line (same parts, same
-- rules, parts [] clears the split), with undo kind line_split, so undo_batch undoes it like
-- any other row. A parts row takes no other field but transaction_id. mcp_assign_expenses is
-- otherwise as in 20261008050000_mcp_lock_retry.sql. Grants are kept by create or replace.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function public.mcp_assign_expenses(p_idempotency_key text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  batch_id uuid := gen_random_uuid();
  item jsonb;
  ord int := 0;
  row_key text;
  txn uuid;
  project_id uuid;
  category_id uuid;
  remember boolean;
  row_result jsonb;
  results jsonb := '[]'::jsonb;
  row_writes jsonb := '[]'::jsonb;
  ok_count int := 0;
  error_count int := 0;
  response jsonb;
begin
  -- Row keys are key:ordinal, and every per-row wrapper caps keys at 128.
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 124
    or p_items is null
    or jsonb_typeof(p_items) <> 'array'
  then
    return private.mcp_error('validation', 'validation');
  end if;

  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 200 then
    return private.mcp_error('validation', 'validation');
  end if;

  if exists (
    select 1
    from (
      select elem->>'transaction_id' as tid
      from jsonb_array_elements(p_items) elem
      where elem->>'transaction_id' is not null
    ) listed
    group by tid
    having count(*) > 1
  ) then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  -- A split row's shares are hashed in project order, as assign_expense_split does (FLOW-208),
  -- so a retry with the shares in another order replays. Other rows hash as sent.
  hash := 'batch|' || md5((
    select jsonb_agg(
      case
        when jsonb_typeof(elem) = 'object' and jsonb_typeof(elem->'shares') = 'array' then
          jsonb_set(elem, '{shares}', coalesce((
            select jsonb_agg(share order by share->>'project_id', share::text)
            from jsonb_array_elements(elem->'shares') share
          ), '[]'::jsonb))
        else elem
      end
      order by pos
    )
    from jsonb_array_elements(p_items) with ordinality x(elem, pos)
  )::text);
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'conflict' then
    -- A batch stored before FLOW-208 was hashed as sent; its identical retry still replays.
    prior := private.mcp_idempotency_lookup(token, p_idempotency_key, 'batch|' || md5(p_items::text));
  end if;
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    ord := ord + 1;
    row_key := p_idempotency_key || ':' || ord::text;
    row_result := null;

    if jsonb_typeof(item) <> 'object' then
      row_result := private.mcp_error('validation', 'validation');
    elsif item->>'transaction_id' is null
      or (item->>'transaction_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      row_result := private.mcp_error('validation', 'validation');
    elsif item ? 'parts' and (
      jsonb_typeof(item->'parts') <> 'array'
      or item ? 'shares'
      or item ? 'project_id'
      or item ? 'category_id'
      or item ? 'remember'
    ) then
      -- A split_line row names its categories and projects in parts[] (FLOW-312).
      row_result := private.mcp_error('validation', 'validation');
    elsif item ? 'shares' and (
      jsonb_typeof(item->'shares') <> 'array'
      or item ? 'project_id'
      or item ? 'remember'
    ) then
      -- A split row names its projects in shares[]; remember applies to one project only.
      row_result := private.mcp_error('validation', 'validation');
    elsif not item ? 'shares' and not item ? 'parts'
      and (item->>'project_id') is null and (item->>'category_id') is null
    then
      row_result := private.mcp_error('validation', 'validation');
    elsif (item->>'project_id') is not null
      and (item->>'project_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      row_result := private.mcp_error('validation', 'validation');
    elsif (item->>'category_id') is not null
      and (item->>'category_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      row_result := private.mcp_error('validation', 'validation');
    elsif (item->>'project_id') is not null and (item->>'category_id') is null then
      row_result := private.mcp_error('validation', 'validation');
    elsif item ? 'remember' and jsonb_typeof(item->'remember') <> 'boolean' then
      row_result := private.mcp_error('validation', 'validation');
    else
      txn := (item->>'transaction_id')::uuid;
      project_id := nullif(item->>'project_id', '')::uuid;
      category_id := nullif(item->>'category_id', '')::uuid;
      remember := coalesce((item->>'remember')::boolean, false);
      begin
        if item ? 'parts' then
          row_result := public.mcp_split_line(
            row_key,
            txn,
            item->'parts'
          );
        elsif item ? 'shares' then
          row_result := public.mcp_assign_expense_split(
            row_key,
            txn,
            item->'shares',
            category_id
          );
        elsif project_id is not null then
          row_result := public.mcp_assign_expense(
            row_key,
            txn,
            project_id,
            category_id,
            remember
          );
        else
          row_result := public.mcp_set_expense_category(
            row_key,
            txn,
            category_id
          );
        end if;
      exception
        when deadlock_detected or serialization_failure or lock_not_available then
          row_result := private.mcp_error('unavailable', 'retry');
        when others then
          row_result := private.mcp_refused(sqlerrm);
      end;
    end if;

    if row_result->>'ok' = 'true' then
      ok_count := ok_count + 1;
      results := results || jsonb_build_array(jsonb_build_object(
        'transaction_id', item->>'transaction_id',
        'ok', true,
        'undo_kind', row_result->'data'->>'undo_kind'
      ) || case
        when item ? 'shares' then jsonb_build_object(
          'closed_review', coalesce((row_result->'data'->>'closed_review')::boolean, false)
        )
        else '{}'::jsonb
      end);
      row_writes := row_writes || jsonb_build_array(jsonb_build_object(
        'ordinal', ord,
        'transaction_id', item->>'transaction_id',
        'undo_kind', row_result->'data'->>'undo_kind',
        'undo_id', row_result->'data'->>'id'
      ));
    else
      error_count := error_count + 1;
      results := results || jsonb_build_array(jsonb_build_object(
        'transaction_id', coalesce(item->>'transaction_id', '00000000-0000-4000-8000-000000000000'),
        'ok', false,
        'code', coalesce(row_result->'error'->>'code', 'refused')
      ));
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
  values (batch_id, token, auth.uid(), private.current_company_id(), p_idempotency_key, row_writes);

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$function$;

commit;
