-- FLOW-207 (#75 review follow-ups).
-- 1. mcp_sync_bank_finish stored any 1-200 character failure message for a known code. It now
--    takes only the fixed (code, message) pairs flow-mcp sends (pullBank in tools.ts); anything
--    else is stored as the generic sync failure, as a bad shape already was.
-- 2. private.mcp_sync_jobs had no retention. mcp_sync_bank_begin drops the user's jobs that
--    finished more than 7 days ago, or are still marked running after a day.
-- Functions are otherwise as in 20261007162020_mcp_sync_bank_jobs.sql. Grants are kept by
-- create or replace.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function public.mcp_sync_bank_begin(p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  prior jsonb;
  cid uuid;
  job uuid;
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
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, 'sync_bank');
  if prior->>'state' = 'replay' then
    -- The same key is the same job. A response stored before jobs existed
    -- has no job_id and is returned as it was.
    if prior->'response'->'data' ? 'job_id' then
      return jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object('state', 'replay', 'job_id', prior->'response'->'data'->>'job_id')
      );
    end if;
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

  -- Retention (FLOW-207): a user's jobs that finished more than 7 days ago, or never
  -- finished and started more than a day ago, are no longer read; drop them as a new one
  -- starts. mcp_sync_jobs_user_idx covers the lookup.
  delete from private.mcp_sync_jobs j
  where j.user_id = auth.uid()
    and (
      (j.finished_at is not null and j.finished_at < now() - interval '7 days')
      or (j.state = 'running' and j.started_at < now() - interval '1 day')
    );

  insert into private.mcp_sync_jobs (token_id, user_id, company_id)
  values (token, auth.uid(), cid)
  returning id into job;

  perform private.mcp_idempotency_store(
    token,
    p_idempotency_key,
    'sync_bank',
    jsonb_build_object('ok', true, 'data', jsonb_build_object('job_id', job))
  );

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('state', 'proceed', 'job_id', job));
end;
$$;

create or replace function public.mcp_sync_bank_finish(
  p_job_id uuid,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  next_state text;
  next_result jsonb;
  next_error jsonb;
  updated uuid;
begin
  if p_job_id is null then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;

  if p_response is not null
    and jsonb_typeof(p_response) = 'object'
    and p_response->'ok' = 'true'::jsonb
    and private.mcp_sync_result_valid(p_response->'data')
  then
    next_state := 'done';
    next_result := p_response->'data';
  elsif p_response is not null
    and jsonb_typeof(p_response) = 'object'
    and p_response->'ok' = 'false'::jsonb
    and jsonb_typeof(p_response->'error') = 'object'
    and jsonb_typeof(p_response->'error'->'message') = 'string'
    -- Only the fixed failures flow-mcp's pullBank sends (FLOW-207), so a caller cannot
    -- store its own text for get_sync_status to show.
    and (p_response->'error'->>'code', p_response->'error'->>'message') in (
      ('unavailable', 'retry'),
      ('unavailable', 'unavailable'),
      ('not_found', 'bank is not connected'),
      ('refused', 'bank key was rejected; reconnect in Settings'),
      ('refused', 'The bank sync failed.')
    )
  then
    next_state := 'failed';
    next_error := jsonb_build_object(
      'code', p_response->'error'->>'code',
      'message', p_response->'error'->>'message'
    );
  else
    next_state := 'failed';
    next_error := jsonb_build_object('code', 'refused', 'message', 'The bank sync failed.');
  end if;

  update private.mcp_sync_jobs j
  set state = next_state,
      result = next_result,
      error = next_error,
      finished_at = now()
  where j.id = p_job_id
    and j.token_id = token
    and j.state = 'running'
    -- Past the stale window the job already reads as retry; it stays that way.
    and j.started_at >= now() - interval '5 minutes'
  returning j.id into updated;

  if updated is null then
    return private.mcp_error('not_found', 'not found');
  end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('job_id', updated, 'state', next_state));
end;
$$;

commit;
