-- FLOW-604: one company-name rule for the MCP, the RPC and the table (#77 review).
-- The name is trimmed of every whitespace character JavaScript's trim() removes,
-- must be 2 to 100 code points, and holds no control character.
-- A direct table update that changes the name is checked by a trigger, so an
-- existing name that breaks the rule never blocks an update of another column.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- The characters String.prototype.trim() removes: ASCII tab to carriage return,
-- space, no-break space, the other Unicode space separators, the line and
-- paragraph separators, and the byte order mark.
create or replace function private.trim_name(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(
    coalesce(p_name, ''),
    U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  );
$$;

revoke all on function private.trim_name(text) from public, anon, authenticated;

comment on function private.trim_name(text) is
  'Trims the same whitespace as JavaScript trim(), so the MCP and SQL agree on a name.';

-- Null when a trimmed company name is acceptable, else the refusal message.
create or replace function private.company_name_problem(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when char_length(coalesce(p_name, '')) < 2 then 'company name is too short'
    when char_length(p_name) > 100 then 'company name is too long'
    when p_name ~ '[\u0001-\u001F\u007F-\u009F]' then 'company name has a control character'
    else null
  end;
$$;

revoke all on function private.company_name_problem(text) from public, anon, authenticated;

-- Security definer: an owner's direct update runs this as authenticated, which
-- cannot execute the two private helpers.
create or replace function private.companies_name_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  problem text;
begin
  if new.name is distinct from private.trim_name(new.name) then
    raise exception 'company name is not trimmed' using errcode = '23514';
  end if;
  problem := private.company_name_problem(new.name);
  if problem is not null then
    raise exception '%', problem using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.companies_name_check() from public, anon, authenticated;

drop trigger if exists companies_name_check on public.companies;
create trigger companies_name_check
  before update of name on public.companies
  for each row
  when (new.name is distinct from old.name)
  execute function private.companies_name_check();

create or replace function public.rename_company(p_company_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  clean text;
  before text;
  problem text;
begin
  cid := private.current_company_id();
  if auth.uid() is null or cid is null or p_company_id is null or p_company_id is distinct from cid then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  clean := private.trim_name(p_name);
  problem := private.company_name_problem(clean);
  if problem is not null then
    raise exception '%', problem;
  end if;
  select c.name into before
  from public.companies c
  where c.id = cid and c.owner_id = auth.uid()
  for update;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.companies c
  set name = clean
  where c.id = cid;
  return jsonb_build_object('id', cid, 'name', clean, 'prior_name', before);
end;
$$;

revoke all on function public.rename_company(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.rename_company(uuid, text) to authenticated;

create or replace function public.mcp_rename_company(
  p_idempotency_key text,
  p_name text
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
  clean text;
  renamed jsonb;
  response jsonb;
begin
  clean := private.trim_name(p_name);
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or private.company_name_problem(clean) is not null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'company_name|' || md5(clean);
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
    renamed := public.rename_company(cid, clean);
    insert into private.mcp_writes (token_id, user_id, kind, company_id, prior)
    values (
      token,
      auth.uid(),
      'company',
      cid,
      jsonb_build_object('before', renamed->>'prior_name', 'after', renamed->>'name')
    );
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'id', cid,
        'name', renamed->>'name',
        'prior_name', renamed->>'prior_name',
        'undo_kind', 'company'
      )
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

revoke all on function public.mcp_rename_company(text, text) from public, anon, authenticated, service_role;
grant execute on function public.mcp_rename_company(text, text) to authenticated;

commit;
