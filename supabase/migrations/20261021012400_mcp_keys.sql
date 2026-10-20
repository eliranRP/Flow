-- FLOW-939 (decision 0202): several AI (MCP) keys per owner and company, one per assistant and device.
-- 1. private.mcp_credentials gets a name (what the owner calls the key, at most 60 characters) and
--    the assistant it was made for (claude-code, claude-ai, chatgpt, other). Both are null on keys
--    made before this migration; the app shows a fallback name and no assistant row for them.
--    Nothing about an existing key changes: its hash, scope, expiry and company stay, so every
--    connected MCP client keeps working.
-- 2. store_mcp_credential no longer revokes the user's other keys. It takes p_name and p_client
--    (both optional, so the flow-mcp still deployed while this migration runs keeps minting), and
--    refuses a 21st active key for the company ('too many keys').
-- 3. mcp_credential_status(p_user, p_hint) lists the user's open keys for the company the app shows
--    (the same company a new key is made for): name, assistant, scope, made, last used, expiry.
--    'state' is connected when any key is active, expired when only expired keys are left. The
--    newest active key's id, scope, last use and expiry stay at the top level for an app version
--    that is still open during the rollout.
-- 4. restore_mcp_credential(p_user, p_id) is the revoke toast's undo: it reopens the user's own key
--    within 10 minutes of its revoke, when it has not expired and the company has room.
-- All four wrappers stay service_role only, security definer with an empty search_path.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

alter table private.mcp_credentials
  add column name text,
  add column client text;

alter table private.mcp_credentials
  add constraint mcp_credentials_name_check
    check (name is null or (char_length(name) between 1 and 60 and name = btrim(name))),
  add constraint mcp_credentials_client_check
    check (client is null or client in ('claude-code', 'claude-ai', 'chatgpt', 'other'));

comment on table private.mcp_credentials is
  'Assistant keys: several per user and company, one per assistant and device (FLOW-939). The hash is HMAC-SHA256 with the pepper named by pepper_kid. Decision 0080, 0202.';

comment on column private.mcp_credentials.name is
  'What the owner calls the key. Null on keys made before FLOW-939.';

comment on column private.mcp_credentials.client is
  'The assistant the key was made for. Null on keys made before FLOW-939.';

drop function public.store_mcp_credential(uuid, text, text[], timestamptz, text, uuid);

create function public.store_mcp_credential(
  p_user uuid,
  p_token_hash text,
  p_scope text[],
  p_expires_at timestamptz,
  p_pepper_kid text,
  p_hint uuid default null,
  p_name text default null,
  p_client text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  company uuid;
  item text;
  clean_name text := nullif(btrim(coalesce(p_name, '')), '');
  active integer;
  new_id uuid;
begin
  if p_user is null or p_token_hash is null or length(p_token_hash) < 16 or p_expires_at is null then
    raise exception 'validation';
  end if;
  if p_pepper_kid is null or btrim(p_pepper_kid) = '' or length(p_pepper_kid) > 64 then
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
  if clean_name is not null and char_length(clean_name) > 60 then
    raise exception 'validation';
  end if;
  if p_client is not null and p_client not in ('claude-code', 'claude-ai', 'chatgpt', 'other') then
    raise exception 'validation';
  end if;

  select id into company
  from public.companies
  where id = public.owner_company_for(p_user, p_hint);
  if company is null then
    raise exception 'no company';
  end if;

  -- One key per assistant and device: a new key leaves the others working. Two mints at once
  -- for the same company take turns, so the cap holds.
  perform pg_advisory_xact_lock(hashtextextended('mcp_credentials:' || company::text, 0));
  select count(*) into active
  from private.mcp_credentials
  where user_id = p_user
    and company_id = company
    and revoked_at is null
    and expires_at > now();
  if active >= 20 then
    raise exception 'too many keys';
  end if;

  insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at, name, client)
  values (p_user, company, p_token_hash, btrim(p_pepper_kid), p_scope, p_expires_at, clean_name, p_client)
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.store_mcp_credential(uuid, text, text[], timestamptz, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.store_mcp_credential(uuid, text, text[], timestamptz, text, uuid, text, text)
  to service_role;

drop function public.mcp_credential_status(uuid);

create function public.mcp_credential_status(p_user uuid, p_hint uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  company uuid;
  keys jsonb;
  newest private.mcp_credentials%rowtype;
  any_open boolean;
begin
  company := public.owner_company_for(p_user, p_hint);
  if company is null then
    return jsonb_build_object('state', 'empty', 'keys', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', k.id,
      'name', k.name,
      'client', k.client,
      'scope', to_jsonb(k.scope),
      'created_at', k.created_at,
      'last_used_at', k.last_used_at,
      'expires_at', k.expires_at,
      'expired', k.expires_at <= now()
    ) order by k.expires_at <= now(), k.created_at, k.id), '[]'::jsonb),
    count(*) > 0
  into keys, any_open
  from (
    select c.*
    from private.mcp_credentials c
    where c.user_id = p_user
      and c.company_id = company
      and c.revoked_at is null
    order by c.created_at desc
    limit 50
  ) k;

  select * into newest
  from private.mcp_credentials c
  where c.user_id = p_user
    and c.company_id = company
    and c.revoked_at is null
    and c.expires_at > now()
  order by c.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'state', 'connected',
      'keys', keys,
      'id', newest.id,
      'scope', to_jsonb(newest.scope),
      'last_used_at', newest.last_used_at,
      'expires_at', newest.expires_at
    );
  end if;
  return jsonb_build_object('state', case when any_open then 'expired' else 'empty' end, 'keys', keys);
end;
$$;

revoke all on function public.mcp_credential_status(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mcp_credential_status(uuid, uuid) to service_role;

create function public.restore_mcp_credential(p_user uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row private.mcp_credentials%rowtype;
  active integer;
begin
  select * into row
  from private.mcp_credentials
  where id = p_id
    and user_id = p_user
  for update;
  if not found
    or row.revoked_at is null
    or row.revoked_at < now() - interval '10 minutes'
    or row.expires_at <= now()
  then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mcp_credentials:' || row.company_id::text, 0));
  select count(*) into active
  from private.mcp_credentials
  where user_id = p_user
    and company_id = row.company_id
    and revoked_at is null
    and expires_at > now();
  if active >= 20 then
    return jsonb_build_object('ok', false, 'error', 'too_many');
  end if;

  update private.mcp_credentials
  set revoked_at = null
  where id = row.id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.restore_mcp_credential(uuid, uuid) from public, anon, authenticated;
grant execute on function public.restore_mcp_credential(uuid, uuid) to service_role;

commit;
