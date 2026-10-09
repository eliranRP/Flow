-- FLOW-601 (option A, the owner's pick 2026-10-09): team members, invites, and several companies
-- per user. Decision 0167.
-- 1. companies.owner_id is no longer unique: a user can own several companies.
-- 2. company_members: an editor or a viewer of a company. The owner stays companies.owner_id and
--    is never a member row.
-- 3. company_invites: an email and a role. The invitee sees it after signing in with that email
--    (confirmed), and joins, declines, or leaves it for later.
-- 4. active_companies: the company each user last opened. A request picks its company in this
--    order: a flow-mcp token's credential company (that company or none); the x-flow-company request
--    header, when the user belongs to it; the saved active company; the oldest owned company; the
--    oldest membership.
-- 5. private.current_company_id() (writes) is that company when the user is its owner or an
--    editor. private.readable_company_id() (reads) is that company for any role, then the legacy
--    demo viewer. private.owner_company_id() is that company only for its owner: team, the
--    company's name and currency (already owner-checked), connectors, Jev settings and the MCP
--    credential stay the owner's.
-- 6. The "a viewer gets forbidden" checks now cover a viewer member too.
-- 7. RPCs: list_my_companies, switch_company, list_team, invite_member, cancel_invite,
--    set_member_role, remove_member, my_invites, accept_invite, decline_invite, reopen_invite,
--    owner_company_for (edge functions), and MCP writes with undo.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- 1. Several companies per owner.
alter table public.companies drop constraint companies_owner_id_key;
create index companies_owner_id_idx on public.companies (owner_id);

-- 2. Members.
create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('editor', 'viewer')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_members_one unique (company_id, user_id)
);

create index company_members_user_idx on public.company_members (user_id);
create index company_members_invited_by_fk_idx on public.company_members (invited_by);

comment on table public.company_members is
  'FLOW-601: an editor or a viewer of a company. The owner is companies.owner_id, never a row here. Written through the team RPCs only.';

create or replace function private.company_members_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.companies c
    where c.id = new.company_id and c.owner_id = new.user_id
  ) then
    raise exception 'an owner is not a member' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.company_members_guard() from public, anon, authenticated;

create trigger company_members_guard
  before insert or update on public.company_members
  for each row execute function private.company_members_guard();

create trigger company_members_audit
  after insert or update or delete on public.company_members
  for each row execute function private.audit_row();

alter table public.company_members enable row level security;
revoke all on public.company_members from public, anon, authenticated;
grant all on public.company_members to service_role;

-- 3. Invites.
create table public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null,
  role text not null check (role in ('editor', 'viewer')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  invited_by uuid references auth.users (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint company_invites_email check (
    email = lower(email)
    and char_length(email) between 3 and 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
);

create unique index company_invites_pending_idx on public.company_invites (company_id, email)
  where status = 'pending';
create index company_invites_email_pending_idx on public.company_invites (email)
  where status = 'pending';
create index company_invites_invited_by_fk_idx on public.company_invites (invited_by);
create index company_invites_decided_by_fk_idx on public.company_invites (decided_by);

comment on table public.company_invites is
  'FLOW-601: an invite to a company by email. pending until the invitee joins or declines, or the owner cancels it. No email is sent; the invitee sees it after signing in with that email.';

create trigger company_invites_audit
  after insert or update or delete on public.company_invites
  for each row execute function private.audit_row();

alter table public.company_invites enable row level security;
revoke all on public.company_invites from public, anon, authenticated;
grant all on public.company_invites to service_role;

-- 4. The company each user last opened.
create table public.active_companies (
  user_id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  updated_at timestamptz not null default now()
);

create index active_companies_company_id_fk_idx on public.active_companies (company_id);

comment on table public.active_companies is
  'FLOW-601: the company a user last switched to. A request without a usable x-flow-company header opens this one.';

alter table public.active_companies enable row level security;
revoke all on public.active_companies from public, anon, authenticated;
grant all on public.active_companies to service_role;

-- 5. Company resolution.
-- 'owner', 'editor', 'viewer', or null. The legacy demo viewer (company_viewers) is not a role here.
create or replace function private.company_role(p_company uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_company is null or p_user is null then null
    when exists (
      select 1 from public.companies c where c.id = p_company and c.owner_id = p_user
    ) then 'owner'
    else (
      select m.role from public.company_members m
      where m.company_id = p_company and m.user_id = p_user
    )
  end;
$$;

revoke all on function private.company_role(uuid, uuid) from public, anon, authenticated;
grant execute on function private.company_role(uuid, uuid) to service_role;

-- The hint wins when the user belongs to it; then the saved company; then the oldest owned
-- company; then the oldest membership.
create or replace function private.active_company_for(p_user uuid, p_hint uuid default null)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p_hint where private.company_role(p_hint, p_user) is not null),
    (
      select a.company_id from public.active_companies a
      where a.user_id = p_user and private.company_role(a.company_id, p_user) is not null
    ),
    (
      select c.id from public.companies c
      where c.owner_id = p_user
      order by c.created_at, c.id
      limit 1
    ),
    (
      select m.company_id from public.company_members m
      where m.user_id = p_user
      order by m.created_at, m.company_id
      limit 1
    )
  );
$$;

revoke all on function private.active_company_for(uuid, uuid) from public, anon, authenticated;
grant execute on function private.active_company_for(uuid, uuid) to service_role;

-- The signed-in user's company for this request. A flow-mcp token (mcp_tid) is bound to its
-- credential's company: that company while the user belongs to it, else none.
create or replace function private.active_company()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  claims jsonb;
  headers jsonb;
  hint text;
  hint_id uuid;
begin
  if uid is null then
    return null;
  end if;
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception
    when others then
      claims := null;
  end;
  if nullif(claims->>'mcp_tid', '') is not null then
    begin
      select cred.company_id into hint_id
      from private.mcp_credentials cred
      where cred.id = (claims->>'mcp_tid')::uuid and cred.user_id = uid;
    exception
      when invalid_text_representation then
        return null;
    end;
    if private.company_role(hint_id, uid) is null then
      return null;
    end if;
    return hint_id;
  end if;
  begin
    headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception
    when others then
      headers := null;
  end;
  hint := headers->>'x-flow-company';
  if hint ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    hint_id := hint::uuid;
  end if;
  return private.active_company_for(uid, hint_id);
end;
$$;

revoke all on function private.active_company() from public, anon;
grant execute on function private.active_company() to authenticated, service_role;

-- Writes: the owner or an editor of the request's company.
create or replace function private.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from (select private.active_company() as id) a
  where private.company_role(a.id, (select auth.uid())) in ('owner', 'editor');
$$;

-- Reads: any role, then the legacy demo viewer.
create or replace function private.readable_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.active_company(),
    (
      select v.company_id
      from public.company_viewers v
      join public.companies c on c.id = v.company_id
      where v.user_id = (select auth.uid())
        and c.is_demo
    )
  );
$$;

-- Owner-only settings: the request's company when the user owns it.
create or replace function private.owner_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from (select private.active_company() as id) a
  where private.company_role(a.id, (select auth.uid())) = 'owner';
$$;

revoke all on function private.owner_company_id() from public, anon;
grant execute on function private.owner_company_id() to authenticated, service_role;

-- Reads a company and may not write it: a viewer member or the legacy demo viewer.
create or replace function private.is_read_only()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_company_id() is null and private.readable_company_id() is not null;
$$;

revoke all on function private.is_read_only() from public, anon;
grant execute on function private.is_read_only() to authenticated, service_role;

-- For edge functions (service role): the user's company when they own it. The hint is the
-- app's x-flow-company header.
create or replace function public.owner_company_for(p_user uuid, p_hint uuid default null)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.companies c
  where c.id = private.active_company_for(p_user, p_hint)
    and c.owner_id = p_user;
$$;

revoke all on function public.owner_company_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.owner_company_for(uuid, uuid) to service_role;

-- 6. Every "a viewer gets forbidden" check covers a viewer member too.
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $viewers$
declare
  fn regprocedure;
  def text;
  patched text;
  pattern text := 'select 1 from public\.company_viewers (\w+) where \1\.user_id = \(select auth\.uid\(\)\)';
  n integer := 0;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname in ('public', 'private')
      and p.prokind = 'f'
      and p.proname not in ('readable_company_id', 'company_viewers_guard', 'create_company')
      and pg_get_functiondef(p.oid) ~ 'public\.company_viewers'
  loop
    def := pg_get_functiondef(fn);
    patched := regexp_replace(def, pattern, 'select 1 where private.is_read_only()', 'g');
    if patched = def or patched ~ 'public\.company_viewers' then
      raise exception '% has a company_viewers check that is not the expected shape', fn;
    end if;
    execute patched;
    n := n + 1;
  end loop;
  if n < 10 then
    raise exception 'expected the viewer checks, found %', n;
  end if;
end
$viewers$;

-- Owner-only settings read the owner's company.
do $owner_only$
declare
  fn text;
  def text;
begin
  foreach fn in array array[
    'public.disconnect_connector(public.connector_provider)',
    'public.set_import_from(public.connector_provider,date)',
    'public.set_company_integration(boolean,text,numeric,text)'
  ]
  loop
    def := pg_get_functiondef(fn::regprocedure);
    if pg_temp.anchor_count(def, 'private.current_company_id()') <> 1 then
      raise exception '% is not the expected definition', fn;
    end if;
    execute replace(def, 'private.current_company_id()', 'private.owner_company_id()');
  end loop;

  def := pg_get_functiondef('public.disconnect_sumit()'::regprocedure);
  if pg_temp.anchor_count(def, 'where c.owner_id = (select auth.uid())') <> 1 then
    raise exception 'disconnect_sumit is not the expected definition';
  end if;
  execute replace(def, 'where c.owner_id = (select auth.uid())', 'where c.id = private.owner_company_id()');

  -- The MCP credential is for the company the app shows when the key is made (its x-flow-company
  -- header, passed by flow-mcp's mint as p_hint), else the one the owner last switched to; never
  -- a company they only edit or view.
  def := pg_get_functiondef('public.store_mcp_credential(uuid,text,text[],timestamp with time zone,text)'::regprocedure);
  if pg_temp.anchor_count(def, 'where owner_id = p_user;') <> 1
    or pg_temp.anchor_count(def, 'p_pepper_kid text)') <> 1
  then
    raise exception 'store_mcp_credential is not the expected definition';
  end if;
  def := replace(def, 'where owner_id = p_user;', 'where id = public.owner_company_for(p_user, p_hint);');
  def := replace(def, 'p_pepper_kid text)', 'p_pepper_kid text, p_hint uuid DEFAULT NULL::uuid)');
  drop function public.store_mcp_credential(uuid, text, text[], timestamptz, text);
  execute def;
  revoke all on function public.store_mcp_credential(uuid, text, text[], timestamptz, text, uuid) from public, anon, authenticated;
  grant execute on function public.store_mcp_credential(uuid, text, text[], timestamptz, text, uuid) to service_role;
end
$owner_only$;

-- A user may own several companies. The same name twice is refused (a double tap on create),
-- and the new company opens.
create or replace function public.create_company(p_name text, p_vat_registered boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  clean text;
  problem text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if exists (
    select 1 from public.company_viewers v
    where v.user_id = uid
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  clean := private.trim_name(p_name);
  problem := private.company_name_problem(clean);
  if problem is not null then
    raise exception '%', problem;
  end if;
  -- One create at a time per user, so two taps cannot both pass the name check.
  perform pg_advisory_xact_lock(hashtextextended('create_company:' || uid::text, 0));
  if exists (select 1 from public.companies where owner_id = uid and name = clean) then
    raise exception 'company already exists';
  end if;
  insert into public.companies (owner_id, name, vat_registered, vat_rate_bp)
  values (
    uid,
    clean,
    coalesce(p_vat_registered, true),
    case when coalesce(p_vat_registered, true) then 1800 else 0 end
  )
  returning id into cid;
  insert into public.active_companies (user_id, company_id)
  values (uid, cid)
  on conflict (user_id) do update set company_id = excluded.company_id, updated_at = now();
  return cid;
end;
$$;

-- 7. RPCs.

-- A display name from the Google profile, else the email.
create or replace function private.user_display_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data->>'name'), ''),
    u.email
  )
  from auth.users u
  where u.id = p_user;
$$;

revoke all on function private.user_display_name(uuid) from public, anon, authenticated;

-- The signed-in user's confirmed email, lower case, when their Google sign-in has that same
-- verified address. auth.users.email alone is not proof: a user can change it (updateUser), and
-- whether that waits for the new address to confirm is a project setting this repo does not pin.
create or replace function private.my_confirmed_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email)
  from auth.users u
  where u.id = (select auth.uid())
    and u.email_confirmed_at is not null
    and u.email is not null
    and exists (
      select 1 from auth.identities i
      where i.user_id = u.id
        and i.provider = 'google'
        and i.email = lower(u.email)
        and i.identity_data->>'email_verified' = 'true'
    );
$$;

revoke all on function private.my_confirmed_email() from public, anon, authenticated;

-- The switcher: every company the user belongs to and the one this request opens.
create or replace function public.list_my_companies()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid, private.readable_company_id() as active
  ),
  mine as (
    select c.id, c.name, 'owner'::text as role, 0 as rank, c.created_at as since, c.is_demo
    from public.companies c, me
    where c.owner_id = me.uid
    union all
    select c.id, c.name, m.role, 1, m.created_at, c.is_demo
    from public.company_members m
    join public.companies c on c.id = m.company_id, me
    where m.user_id = me.uid
    union all
    select c.id, c.name, 'viewer', 2, v.created_at, c.is_demo
    from public.company_viewers v
    join public.companies c on c.id = v.company_id and c.is_demo, me
    where v.user_id = me.uid
      and not exists (select 1 from public.company_members m where m.company_id = c.id and m.user_id = me.uid)
  )
  select jsonb_build_object(
    'active_id', (select active from me),
    'role', (
      select x.role from mine x, me where x.id = me.active order by x.rank limit 1
    ),
    'companies', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', x.id,
          'name', x.name,
          'role', x.role,
          'is_demo', x.is_demo,
          'active', x.id = me.active
        )
        order by x.rank, x.since, x.id
      )
      from mine x, me
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.list_my_companies() from public, anon;
grant execute on function public.list_my_companies() to authenticated, service_role;

create or replace function public.switch_company(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  my_role text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  my_role := private.company_role(p_company_id, uid);
  if my_role is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.active_companies (user_id, company_id)
  values (uid, p_company_id)
  on conflict (user_id) do update set company_id = excluded.company_id, updated_at = now();
  return jsonb_build_object(
    'id', p_company_id,
    'name', (select c.name from public.companies c where c.id = p_company_id),
    'role', my_role
  );
end;
$$;

revoke all on function public.switch_company(uuid) from public, anon;
grant execute on function public.switch_company(uuid) to authenticated, service_role;

-- The team page: the owner, the members, and (for the owner) the pending invites.
create or replace function public.list_team()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  my_role text;
  owner uuid;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  my_role := coalesce(private.company_role(cid, uid), 'viewer');
  select c.owner_id into owner from public.companies c where c.id = cid;
  return jsonb_build_object(
    'company_id', cid,
    'role', my_role,
    'can_manage', my_role = 'owner',
    'members', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'user_id', x.user_id,
          'name', private.user_display_name(x.user_id),
          'email', (select u.email from auth.users u where u.id = x.user_id),
          'role', x.role,
          'you', x.user_id = uid
        )
        order by x.rank, x.since, x.user_id
      ), '[]'::jsonb)
      from (
        select owner as user_id, 'owner'::text as role, 0 as rank,
          (select c.created_at from public.companies c where c.id = cid) as since
        union all
        select m.user_id, m.role, 1, m.created_at
        from public.company_members m
        where m.company_id = cid
      ) x
    ),
    'invites', case when my_role = 'owner' then (
      select coalesce(jsonb_agg(
        jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role, 'created_at', i.created_at)
        order by i.created_at, i.id
      ), '[]'::jsonb)
      from public.company_invites i
      where i.company_id = cid and i.status = 'pending'
    ) else '[]'::jsonb end
  );
end;
$$;

revoke all on function public.list_team() from public, anon;
grant execute on function public.list_team() to authenticated, service_role;

-- The owner's company, or forbidden for anyone who can only read or edit it.
create or replace function private.team_owner_company()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  cid := private.owner_company_id();
  if cid is null then
    if private.readable_company_id() is not null then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  return cid;
end;
$$;

revoke all on function private.team_owner_company() from public, anon, authenticated;

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
begin
  cid := private.team_owner_company();
  if coalesce(p_role, '') not in ('editor', 'viewer') then
    raise exception 'validation';
  end if;
  if char_length(clean) not between 3 and 254
    or clean !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  then
    raise exception 'invalid email';
  end if;
  -- One invite write at a time per company.
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
  insert into public.company_invites (company_id, email, role, invited_by)
  values (cid, clean, p_role, uid)
  returning * into found_invite;
  return jsonb_build_object(
    'id', found_invite.id, 'email', clean, 'role', p_role, 'status', 'pending', 'existing', false
  );
end;
$$;

revoke all on function public.invite_member(text, text) from public, anon;
grant execute on function public.invite_member(text, text) to authenticated, service_role;

-- The owner takes back a pending invite (the toast's ביטול). Any company the caller owns.
create or replace function public.cancel_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inv public.company_invites%rowtype;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select * into inv from public.company_invites i where i.id = p_invite_id for update;
  if not found or private.company_role(inv.company_id, uid) is distinct from 'owner' then
    raise exception 'invite not found';
  end if;
  if inv.status <> 'pending' then
    raise exception 'invite is not pending';
  end if;
  update public.company_invites i
  set status = 'cancelled', decided_by = uid, decided_at = now()
  where i.id = inv.id;
  return jsonb_build_object('id', inv.id, 'status', 'cancelled');
end;
$$;

revoke all on function public.cancel_invite(uuid) from public, anon;
grant execute on function public.cancel_invite(uuid) to authenticated, service_role;

create or replace function public.set_member_role(p_user_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  prior text;
begin
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

create or replace function public.remove_member(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  prior public.company_members%rowtype;
begin
  cid := private.team_owner_company();
  delete from public.company_members m
  where m.company_id = cid and m.user_id = p_user_id
  returning * into prior;
  if not found then
    raise exception 'member not found';
  end if;
  delete from public.active_companies a where a.user_id = p_user_id and a.company_id = cid;
  return jsonb_build_object(
    'company_id', cid,
    'user_id', p_user_id,
    'prior_role', prior.role,
    'invited_by', prior.invited_by,
    'since', prior.created_at
  );
end;
$$;

revoke all on function public.remove_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated, service_role;

-- The invitee's inbox: pending invites to the signed-in user's confirmed email, newest first.
create or replace function public.my_invites()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', i.id,
      'company_id', i.company_id,
      'company_name', c.name,
      'role', i.role,
      'invited_by_name', private.user_display_name(i.invited_by),
      'created_at', i.created_at
    )
    order by i.created_at desc, i.id
  ), '[]'::jsonb)
  from public.company_invites i
  join public.companies c on c.id = i.company_id
  where i.status = 'pending'
    and i.email = private.my_confirmed_email()
    and private.company_role(i.company_id, (select auth.uid())) is null;
$$;

revoke all on function public.my_invites() from public, anon;
grant execute on function public.my_invites() to authenticated, service_role;

-- The invite, locked, when it is addressed to the signed-in user's confirmed email.
create or replace function private.my_invite_for_update(p_invite_id uuid)
returns public.company_invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.company_invites%rowtype;
  mine text := private.my_confirmed_email();
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select * into inv from public.company_invites i where i.id = p_invite_id for update;
  if not found or mine is null or inv.email <> mine then
    raise exception 'invite not found';
  end if;
  return inv;
end;
$$;

revoke all on function private.my_invite_for_update(uuid) from public, anon, authenticated;

-- Join: the member row with the invite's role, and the company opens.
create or replace function public.accept_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inv public.company_invites%rowtype;
  my_role text;
begin
  inv := private.my_invite_for_update(p_invite_id);
  if inv.status <> 'pending' then
    raise exception 'invite is not pending';
  end if;
  my_role := private.company_role(inv.company_id, uid);
  if my_role is null then
    insert into public.company_members (company_id, user_id, role, invited_by)
    values (inv.company_id, uid, inv.role, inv.invited_by);
    my_role := inv.role;
  end if;
  update public.company_invites i
  set status = 'accepted', decided_by = uid, decided_at = now()
  where i.id = inv.id;
  insert into public.active_companies (user_id, company_id)
  values (uid, inv.company_id)
  on conflict (user_id) do update set company_id = excluded.company_id, updated_at = now();
  return jsonb_build_object(
    'id', inv.id,
    'company_id', inv.company_id,
    'name', (select c.name from public.companies c where c.id = inv.company_id),
    'role', my_role
  );
end;
$$;

revoke all on function public.accept_invite(uuid) from public, anon;
grant execute on function public.accept_invite(uuid) to authenticated, service_role;

-- Decline for good. The toast's ביטול is reopen_invite.
create or replace function public.decline_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.company_invites%rowtype;
begin
  inv := private.my_invite_for_update(p_invite_id);
  if inv.status <> 'pending' then
    raise exception 'invite is not pending';
  end if;
  update public.company_invites i
  set status = 'declined', decided_by = auth.uid(), decided_at = now()
  where i.id = inv.id;
  return jsonb_build_object('id', inv.id, 'status', 'declined');
end;
$$;

revoke all on function public.decline_invite(uuid) from public, anon;
grant execute on function public.decline_invite(uuid) to authenticated, service_role;

-- The toast's ביטול after a decline, within 10 minutes of it.
create or replace function public.reopen_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.company_invites%rowtype;
begin
  inv := private.my_invite_for_update(p_invite_id);
  -- Only as the toast's undo: the owner neither sees nor can cancel a declined invite, so a decline
  -- taken back later would let the invitee join long after the owner saw it declined.
  if inv.status <> 'declined' or inv.decided_by is distinct from auth.uid()
    or inv.decided_at < now() - interval '10 minutes'
  then
    raise exception 'invite is not declined';
  end if;
  if exists (
    select 1 from public.company_invites i
    where i.company_id = inv.company_id and i.email = inv.email and i.status = 'pending'
  ) then
    raise exception 'invite is not declined';
  end if;
  update public.company_invites i
  set status = 'pending', decided_by = null, decided_at = null
  where i.id = inv.id;
  return jsonb_build_object('id', inv.id, 'status', 'pending');
end;
$$;

revoke all on function public.reopen_invite(uuid) from public, anon;
grant execute on function public.reopen_invite(uuid) to authenticated, service_role;

-- 8. MCP writes with undo: invite, change role, remove. MCP list_team reads public.list_team.
create or replace function public.mcp_invite_member(p_idempotency_key text, p_email text, p_role text)
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
  invited jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_email is null
    or coalesce(p_role, '') not in ('editor', 'viewer')
  then
    return private.mcp_error('validation', 'validation');
  end if;
  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'invite|' || md5(lower(btrim(p_email)) || '|' || p_role);
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;
  begin
    invited := public.invite_member(p_email, p_role);
    -- Undo cancels an invite this call made; re-sending a pending one is not undone.
    if (invited->>'existing')::boolean is false then
      insert into private.mcp_writes (token_id, user_id, kind, company_id, prior)
      values (
        token, auth.uid(), 'invite', private.current_company_id(),
        jsonb_build_object('invite_id', invited->>'id')
      );
    end if;
    response := jsonb_build_object(
      'ok', true,
      'data', invited || jsonb_build_object(
        'undo_kind', case when (invited->>'existing')::boolean then null else 'invite' end
      )
    );
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;
  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_invite_member(text, text, text) from public, anon;
grant execute on function public.mcp_invite_member(text, text, text) to authenticated, service_role;

create or replace function public.mcp_set_member_role(p_idempotency_key text, p_user_id uuid, p_role text)
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
  changed jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_user_id is null
    or coalesce(p_role, '') not in ('editor', 'viewer')
  then
    return private.mcp_error('validation', 'validation');
  end if;
  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'member_role|' || p_user_id::text || '|' || p_role;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;
  begin
    changed := public.set_member_role(p_user_id, p_role);
    insert into private.mcp_writes (token_id, user_id, kind, company_id, prior)
    values (
      token, auth.uid(), 'member_role', (changed->>'company_id')::uuid,
      jsonb_build_object('user_id', p_user_id, 'before', changed->>'prior_role', 'after', p_role)
    );
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'user_id', p_user_id, 'role', p_role, 'prior_role', changed->>'prior_role', 'undo_kind', 'member_role'
      )
    );
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;
  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_set_member_role(text, uuid, text) from public, anon;
grant execute on function public.mcp_set_member_role(text, uuid, text) to authenticated, service_role;

create or replace function public.mcp_remove_member(p_idempotency_key text, p_user_id uuid)
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
  removed jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_user_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;
  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'member_remove|' || p_user_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;
  begin
    removed := public.remove_member(p_user_id);
    insert into private.mcp_writes (token_id, user_id, kind, company_id, prior)
    values (
      token, auth.uid(), 'member_remove', (removed->>'company_id')::uuid,
      jsonb_build_object(
        'user_id', p_user_id, 'before', removed->>'prior_role',
        'invited_by', removed->'invited_by', 'since', removed->'since'
      )
    );
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object('user_id', p_user_id, 'prior_role', removed->>'prior_role', 'undo_kind', 'member_remove')
    );
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;
  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_remove_member(text, uuid) from public, anon;
grant execute on function public.mcp_remove_member(text, uuid) to authenticated, service_role;

-- The team refusals MCP names (docs/mcp/TOOLS.md). Anything else stays "The write was refused.".
do $refused$
declare
  def text;
  anchor text := $a$'no linked loan is open on this date'$a$;
begin
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$,
        -- FLOW-601 (decision 0167).
        'already a member',
        'invalid email',
        'too many invites',
        'member not found'$n$);
end
$refused$;

-- The three undo kinds on mcp_writes and mcp_undo. p_id is the invite id, or the member's user id.
do $undo$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'jev_mode'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'invite'::text, 'member_role'::text, 'member_remove'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if pg_temp.anchor_count(def, $a$kind = 'jev_mode'::text$a$) <> 1 or right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'invite'::text) AND (company_id IS NOT NULL) AND (prior ? 'invite_id'::text))$n$
    || $n$ OR ((kind = 'member_role'::text) AND (company_id IS NOT NULL) AND (prior ? 'user_id'::text) AND (prior ? 'before'::text) AND (prior ? 'after'::text))$n$
    || $n$ OR ((kind = 'member_remove'::text) AND (company_id IS NOT NULL) AND (prior ? 'user_id'::text) AND (prior ? 'before'::text))))$n$;

  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := 'p_kind not in (';
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, $n$p_kind not in ('invite', 'member_role', 'member_remove', $n$);

  anchor := $a$(p_kind = 'review' and w.kind = 'review' and w.review_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo match is not the expected definition';
  end if;
  def := replace(def, anchor, $n$(p_kind = 'invite' and w.kind = 'invite' and w.prior->>'invite_id' = p_id::text and w.company_id = cid)
        or (p_kind = 'member_role' and w.kind = 'member_role' and w.prior->>'user_id' = p_id::text and w.company_id = cid)
        or (p_kind = 'member_remove' and w.kind = 'member_remove' and w.prior->>'user_id' = p_id::text and w.company_id = cid)
        or $n$ || anchor);

  anchor := $a$    elsif p_kind = 'company' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo branches are not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind in ('invite', 'member_role', 'member_remove') then
      -- FLOW-601. Each undo goes through the owner's own RPC, so the owner check stays there.
      response := null;
      begin
        if p_kind = 'invite' then
          if not exists (
            select 1 from public.company_invites i
            where i.id = p_id and i.company_id = cid and i.status = 'pending'
          ) then
            response := private.mcp_error('conflict', 'conflict');
          else
            perform public.cancel_invite(p_id);
          end if;
        elsif p_kind = 'member_role' then
          if (
            select m.role from public.company_members m
            where m.company_id = cid and m.user_id = p_id
          ) is distinct from rec.prior->>'after' then
            response := private.mcp_error('conflict', 'conflict');
          else
            perform public.set_member_role(p_id, rec.prior->>'before');
          end if;
        else
          if private.company_role(cid, p_id) is not null then
            response := private.mcp_error('conflict', 'conflict');
          else
            perform private.team_owner_company();
            insert into public.company_members (company_id, user_id, role, invited_by, created_at)
            values (
              cid, p_id, rec.prior->>'before',
              nullif(rec.prior->>'invited_by', '')::uuid,
              coalesce((rec.prior->>'since')::timestamptz, now())
            );
          end if;
        end if;
        if response is null then
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        end if;
      end;
$n$ || anchor);
  execute def;
end
$undo$;

commit;
