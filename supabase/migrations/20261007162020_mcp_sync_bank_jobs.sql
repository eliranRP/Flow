-- FLOW-202. sync_bank starts a job and returns its id; get_sync_status reads it.
-- Decision 0101. Amends the begin/finish pair from 0090.

begin;

create table private.mcp_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references private.mcp_credentials (id) on delete cascade,
  user_id uuid not null,
  company_id uuid not null,
  state text not null default 'running' check (state in ('running', 'done', 'failed')),
  result jsonb,
  error jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint mcp_sync_jobs_finished check (
    (state = 'running' and finished_at is null and result is null and error is null)
    or (state = 'done' and finished_at is not null and result is not null and error is null)
    or (state = 'failed' and finished_at is not null and result is null and error is not null)
  )
);

comment on table private.mcp_sync_jobs is
  'One row per sync_bank pull started through flow-mcp. Written by the definer, not PostgREST. Decision 0101.';

alter table private.mcp_sync_jobs enable row level security;

revoke all on table private.mcp_sync_jobs from public, anon, authenticated;

create index mcp_sync_jobs_user_idx on private.mcp_sync_jobs (user_id, started_at desc);

-- A running job older than this is reported as failed with retry. The edge
-- worker that ran it is gone (wall-clock limit or a crash).
create or replace function private.mcp_sync_job_view(p_job private.mcp_sync_jobs)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when p_job.state = 'running' and p_job.started_at < now() - interval '5 minutes' then
      jsonb_build_object(
        'job_id', p_job.id,
        'state', 'failed',
        'started_at', p_job.started_at,
        'finished_at', null,
        'error', jsonb_build_object('code', 'unavailable', 'message', 'retry')
      )
    when p_job.state = 'done' then
      jsonb_build_object(
        'job_id', p_job.id,
        'state', 'done',
        'started_at', p_job.started_at,
        'finished_at', p_job.finished_at
      ) || p_job.result
    when p_job.state = 'failed' then
      jsonb_build_object(
        'job_id', p_job.id,
        'state', 'failed',
        'started_at', p_job.started_at,
        'finished_at', p_job.finished_at,
        'error', p_job.error
      )
    else
      jsonb_build_object(
        'job_id', p_job.id,
        'state', 'running',
        'started_at', p_job.started_at,
        'finished_at', null
      )
  end;
$$;

revoke all on function private.mcp_sync_job_view(private.mcp_sync_jobs) from public, anon, authenticated;

drop function public.mcp_sync_bank_finish(text, jsonb);

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

revoke all on function public.mcp_sync_bank_begin(text) from public, anon, authenticated, service_role;

grant execute on function public.mcp_sync_bank_begin(text) to authenticated;

-- The finish step checks the shape before it stores anything. A done result
-- is exactly added, duplicates, removed (whole numbers, not negative) and
-- newest_date (YYYY-MM-DD or null). A failure is a known tool code and a short
-- message. Anything else is stored as the generic sync failure.
create or replace function private.mcp_sync_result_valid(p_data jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_data is not null
    and jsonb_typeof(p_data) = 'object'
    and (select count(*) from jsonb_object_keys(p_data)) = 4
    and p_data ?& array['added', 'duplicates', 'removed', 'newest_date']
    and jsonb_typeof(p_data->'added') = 'number'
    and jsonb_typeof(p_data->'duplicates') = 'number'
    and jsonb_typeof(p_data->'removed') = 'number'
    and (p_data->>'added') ~ '^[0-9]{1,9}$'
    and (p_data->>'duplicates') ~ '^[0-9]{1,9}$'
    and (p_data->>'removed') ~ '^[0-9]{1,9}$'
    and (
      jsonb_typeof(p_data->'newest_date') = 'null'
      or (
        jsonb_typeof(p_data->'newest_date') = 'string'
        and (p_data->>'newest_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and pg_input_is_valid(p_data->>'newest_date', 'date')
      )
    );
$$;

revoke all on function private.mcp_sync_result_valid(jsonb) from public, anon, authenticated;

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
    and p_response->'error'->>'code' in (
      'validation', 'not_found', 'conflict', 'refused', 'unavailable'
    )
    and jsonb_typeof(p_response->'error'->'message') = 'string'
    and char_length(p_response->'error'->>'message') between 1 and 200
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

revoke all on function public.mcp_sync_bank_finish(uuid, jsonb) from public, anon, authenticated, service_role;

grant execute on function public.mcp_sync_bank_finish(uuid, jsonb) to authenticated;

-- Read by the user who started the job, in the same company. Any MCP token of
-- that user can read it, so a write-only token can poll its own sync.
create or replace function public.mcp_sync_status(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  job private.mcp_sync_jobs%rowtype;
begin
  if p_job_id is null then
    return private.mcp_error('validation', 'validation');
  end if;
  if auth.uid() is null or private.current_company_id() is null then
    return private.mcp_error('forbidden', 'The read was refused.');
  end if;

  select * into job
  from private.mcp_sync_jobs j
  where j.id = p_job_id
    and j.user_id = auth.uid()
    and j.company_id = private.current_company_id();

  if job.id is null then
    return private.mcp_error('not_found', 'not found');
  end if;
  return jsonb_build_object('ok', true, 'data', private.mcp_sync_job_view(job));
end;
$$;

revoke all on function public.mcp_sync_status(uuid) from public, anon, authenticated, service_role;

grant execute on function public.mcp_sync_status(uuid) to authenticated;

commit;
