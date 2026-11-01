begin;

-- Decision 0241. A flow-mcp key cannot invite people or change a member's role: the owner does both in
-- the app. Same claims accessor as delete_company (decision 0194). remove_member stays.

-- invite_member as in 20261019151437_invite_caps_redundant_indexes.sql, plus the guard.
create or replace function public.invite_member(p_email text, p_role text default 'viewer')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  clean text := lower(btrim(coalesce(p_email, '')));
  found_invite public.company_invites%rowtype;
  claims jsonb;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception
    when others then
      claims := null;
  end;
  if nullif(claims->>'mcp_tid', '') is not null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  cid := private.team_owner_company();
  if coalesce(p_role, '') not in ('editor', 'viewer') then
    raise exception 'validation';
  end if;
  if char_length(clean) not between 3 and 254
    or clean !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  then
    raise exception 'invalid email';
  end if;
  -- One invite write at a time per user, then per company (always in this order), so both
  -- daily counts below are exact.
  perform pg_advisory_xact_lock(hashtextextended('invite_user:' || uid::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('company_invites:' || cid::text, 0));
  if exists (
    select 1 from auth.users u
    join public.companies c on c.owner_id = u.id
    where c.id = cid and lower(u.email) = clean
  ) or exists (
    select 1 from auth.users u
    join public.company_members m on m.user_id = u.id
    where m.company_id = cid and lower(u.email) = clean
  ) then
    raise exception 'already a member';
  end if;
  select * into found_invite
  from public.company_invites i
  where i.company_id = cid and i.email = clean and i.status = 'pending'
  for update;
  if found then
    if found_invite.role is distinct from p_role then
      update public.company_invites i set role = p_role where i.id = found_invite.id;
    end if;
    return jsonb_build_object(
      'id', found_invite.id, 'email', clean, 'role', p_role, 'status', 'pending', 'existing', true
    );
  end if;
  if (select count(*) from public.company_invites i where i.company_id = cid and i.status = 'pending') >= 50 then
    raise exception 'too many invites';
  end if;
  -- Decision 0195: 10 new invites per company and 20 per inviting user in any 24 hours, exact
  -- under the two locks above. The user count reads the ledger, which a company delete keeps.
  delete from private.invite_sends s
  where s.user_id = uid and s.created_at < now() - interval '2 days';
  if (
    select count(*) from public.company_invites i
    where i.company_id = cid and i.created_at > now() - interval '24 hours'
  ) >= 10 or (
    select count(*) from private.invite_sends s
    where s.user_id = uid and s.created_at > now() - interval '24 hours'
  ) >= 20 then
    raise exception 'invite_limit' using errcode = '23514';
  end if;
  insert into public.company_invites (company_id, email, role, invited_by)
  values (cid, clean, p_role, uid)
  returning * into found_invite;
  insert into private.invite_sends (user_id) values (uid);
  return jsonb_build_object(
    'id', found_invite.id, 'email', clean, 'role', p_role, 'status', 'pending', 'existing', false
  );
end;
$$;

revoke all on function public.invite_member(text, text) from public, anon, authenticated;
grant execute on function public.invite_member(text, text) to authenticated, service_role;

-- set_member_role as in 20261013175142_team_members.sql, plus the guard.
create or replace function public.set_member_role(p_user_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  prior text;
  claims jsonb;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception
    when others then
      claims := null;
  end;
  if nullif(claims->>'mcp_tid', '') is not null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  cid := private.team_owner_company();
  if coalesce(p_role, '') not in ('editor', 'viewer') then
    raise exception 'validation';
  end if;
  select m.role into prior
  from public.company_members m
  where m.company_id = cid and m.user_id = p_user_id
  for update;
  if not found then
    raise exception 'member not found';
  end if;
  if prior is distinct from p_role then
    update public.company_members m set role = p_role
    where m.company_id = cid and m.user_id = p_user_id;
  end if;
  return jsonb_build_object('company_id', cid, 'user_id', p_user_id, 'role', p_role, 'prior_role', prior);
end;
$$;

revoke all on function public.set_member_role(uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, text) to authenticated, service_role;

-- The two MCP wrappers have no caller now: the tools are removed. The invite and member_role undo
-- kinds stay in mcp_undo.
drop function public.mcp_invite_member(text, text, text);
drop function public.mcp_set_member_role(text, uuid, text);

commit;
