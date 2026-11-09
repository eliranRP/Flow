-- FLOW-1122 fix: MCP refresh_treasury_yields answers a lock timeout, deadlock or serialization
-- failure as unavailable / retry and does not store it under the idempotency key, as every MCP write
-- does (FLOW-130; supabase/tests/database/mcp_lock_retry.test.sql). The function is otherwise unchanged.

begin;

create or replace function public.mcp_refresh_treasury_yields(p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  prior jsonb;
  response jsonb;
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
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, 'treasury_refresh');
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;
  begin
    response := jsonb_build_object('ok', true, 'data', public.refresh_treasury_yields());
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;
  perform private.mcp_idempotency_store(token, p_idempotency_key, 'treasury_refresh', response);
  return response;
end;
$$;

commit;
