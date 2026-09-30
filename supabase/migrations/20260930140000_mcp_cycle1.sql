-- MCP cycle 1. Credential wrappers, rate limit, and the undo snapshot table.
-- Decision 0080. The wrappers are public because PostgREST does not expose private.
-- EXECUTE is service_role only. The signed-in user calls the function routes, not these.

create table private.mcp_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  token_hash text not null unique,
  scope text[] not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

comment on table private.mcp_credentials is
  'One assistant token per user. The hash is HMAC-SHA256 with the function pepper. Decision 0080.';

create index mcp_credentials_user_open_idx
  on private.mcp_credentials (user_id, created_at desc)
  where revoked_at is null;

alter table private.mcp_credentials enable row level security;
revoke all on table private.mcp_credentials from public, anon, authenticated;

create table private.mcp_rate (
  subject_id uuid not null,
  subject_kind text not null check (subject_kind in ('token', 'user')),
  bucket text not null check (bucket in ('read', 'write')),
  window_start timestamptz not null,
  hits integer not null,
  primary key (subject_id, subject_kind, bucket, window_start)
);

comment on table private.mcp_rate is
  'Per-minute counters. A token allows 60 reads and 20 writes. A user allows 120 reads and 40 writes.';

alter table private.mcp_rate enable row level security;
revoke all on table private.mcp_rate from public, anon, authenticated;

create table private.mcp_auth_failures (
  address text not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key (address, window_start)
);

comment on table private.mcp_auth_failures is
  'Failed MCP secrets, keyed by cf-connecting-ip. There is no unknown bucket. 30 a minute.';

alter table private.mcp_auth_failures enable row level security;
revoke all on table private.mcp_auth_failures from public, anon, authenticated;

-- The undo tool is cycle 3. The table lands now so undone_at is part of the schema (N36).
create table private.mcp_writes (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references private.mcp_credentials (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid,
  review_id uuid,
  kind text not null check (kind in ('review', 'reassign')),
  project_id uuid,
  category_id uuid,
  pnl_role public.pnl_role,
  shares jsonb not null default '[]'::jsonb,
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mcp_writes_target check (
    (kind = 'review' and review_id is not null)
    or (kind = 'reassign' and transaction_id is not null)
  )
);

comment on table private.mcp_writes is
  'Post-write snapshot for undo. undone_at makes the undo single-use. Decision 0080.';

comment on column private.mcp_writes.undone_at is
  'Set when this assistant write is undone. A second undo finds it set and is not_found.';

alter table private.mcp_writes enable row level security;
revoke all on table private.mcp_writes from public, anon, authenticated;

create or replace function private.consume_mcp_undo(p_user uuid, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated integer;
begin
  update private.mcp_writes
  set undone_at = now()
  where id = p_id
    and user_id = p_user
    and undone_at is null;
  get diagnostics updated = row_count;
  return updated = 1;
end;
$$;

revoke all on function private.consume_mcp_undo(uuid, uuid) from public, anon, authenticated;

create or replace function public.store_mcp_credential(
  p_user uuid,
  p_token_hash text,
  p_scope text[],
  p_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  company uuid;
  item text;
  new_id uuid;
begin
  if p_user is null or p_token_hash is null or length(p_token_hash) < 16 or p_expires_at is null then
    raise exception 'validation';
  end if;
  if p_scope is null or cardinality(p_scope) = 0 or cardinality(p_scope) > 2 then
    raise exception 'validation';
  end if;
  if not ('read' = any (p_scope)) then
    raise exception 'validation';
  end if;
  foreach item in array p_scope loop
    if item not in ('read', 'write') then
      raise exception 'validation';
    end if;
  end loop;

  select id into company
  from public.companies
  where owner_id = p_user;
  if company is null then
    raise exception 'no company';
  end if;

  update private.mcp_credentials
  set revoked_at = now()
  where user_id = p_user
    and revoked_at is null;

  insert into private.mcp_credentials (user_id, company_id, token_hash, scope, expires_at)
  values (p_user, company, p_token_hash, p_scope, p_expires_at)
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.revoke_mcp_credential(p_user uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated integer;
begin
  update private.mcp_credentials
  set revoked_at = coalesce(revoked_at, now())
  where id = p_id
    and user_id = p_user;
  get diagnostics updated = row_count;
  if updated = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.mcp_credential_status(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  row private.mcp_credentials%rowtype;
begin
  select * into row
  from private.mcp_credentials
  where user_id = p_user
    and revoked_at is null
  order by created_at desc
  limit 1;
  if not found then
    return jsonb_build_object('state', 'empty');
  end if;
  return jsonb_build_object(
    'state', case when row.expires_at <= now() then 'expired' else 'connected' end,
    'id', row.id,
    'scope', to_jsonb(row.scope),
    'last_used_at', row.last_used_at,
    'expires_at', row.expires_at
  );
end;
$$;

create or replace function public.lookup_mcp_credential(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  row private.mcp_credentials%rowtype;
begin
  select * into row
  from private.mcp_credentials
  where token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'id', row.id,
    'user_id', row.user_id,
    'company_id', row.company_id,
    'scope', to_jsonb(row.scope),
    'expires_at', row.expires_at,
    'revoked_at', row.revoked_at
  );
end;
$$;

create or replace function public.touch_mcp_credential(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.mcp_credentials
  set last_used_at = now()
  where id = p_id
    and revoked_at is null
    and expires_at > now();
end;
$$;

create or replace function public.bump_mcp_rate(p_token uuid, p_user uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lim_token integer;
  lim_user integer;
  token_hits integer;
  user_hits integer;
  minute_start timestamptz := date_trunc('minute', clock_timestamp());
  retry integer;
begin
  if p_kind not in ('read', 'write') or p_token is null or p_user is null then
    raise exception 'validation';
  end if;
  lim_token := case when p_kind = 'read' then 60 else 20 end;
  lim_user := case when p_kind = 'read' then 120 else 40 end;

  insert into private.mcp_rate (subject_id, subject_kind, bucket, window_start, hits)
  values (p_token, 'token', p_kind, minute_start, 1)
  on conflict (subject_id, subject_kind, bucket, window_start)
  do update set hits = private.mcp_rate.hits + 1
  returning hits into token_hits;

  insert into private.mcp_rate (subject_id, subject_kind, bucket, window_start, hits)
  values (p_user, 'user', p_kind, minute_start, 1)
  on conflict (subject_id, subject_kind, bucket, window_start)
  do update set hits = private.mcp_rate.hits + 1
  returning hits into user_hits;

  retry := greatest(
    1,
    ceil(extract(epoch from (minute_start + interval '1 minute' - clock_timestamp())))::integer
  );
  if token_hits > lim_token or user_hits > lim_user then
    return jsonb_build_object('allowed', false, 'retry_after_seconds', retry);
  end if;
  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end;
$$;

create or replace function public.note_auth_failure(p_address text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  minute_start timestamptz := date_trunc('minute', clock_timestamp());
  seen integer;
  retry integer;
begin
  if p_address is null or btrim(p_address) = '' then
    return jsonb_build_object('throttled', false, 'retry_after_seconds', 0);
  end if;

  insert into private.mcp_auth_failures (address, window_start, hits)
  values (btrim(p_address), minute_start, 1)
  on conflict (address, window_start)
  do update set hits = private.mcp_auth_failures.hits + 1
  returning hits into seen;

  retry := greatest(
    1,
    ceil(extract(epoch from (minute_start + interval '1 minute' - clock_timestamp())))::integer
  );
  if seen > 30 then
    return jsonb_build_object('throttled', true, 'retry_after_seconds', retry);
  end if;
  return jsonb_build_object('throttled', false, 'retry_after_seconds', 0);
end;
$$;

revoke all on function public.store_mcp_credential(uuid, text, text[], timestamptz) from public, anon, authenticated;
revoke all on function public.revoke_mcp_credential(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mcp_credential_status(uuid) from public, anon, authenticated;
revoke all on function public.lookup_mcp_credential(text) from public, anon, authenticated;
revoke all on function public.touch_mcp_credential(uuid) from public, anon, authenticated;
revoke all on function public.bump_mcp_rate(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.note_auth_failure(text) from public, anon, authenticated;

grant execute on function public.store_mcp_credential(uuid, text, text[], timestamptz) to service_role;
grant execute on function public.revoke_mcp_credential(uuid, uuid) to service_role;
grant execute on function public.mcp_credential_status(uuid) to service_role;
grant execute on function public.lookup_mcp_credential(text) to service_role;
grant execute on function public.touch_mcp_credential(uuid) to service_role;
grant execute on function public.bump_mcp_rate(uuid, uuid, text) to service_role;
grant execute on function public.note_auth_failure(text) to service_role;
