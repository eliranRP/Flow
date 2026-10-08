-- FLOW-602: rename_company RPC and MCP rename_company. Owner only, idempotent, undo.
-- FLOW-604: one name rule for the MCP, the RPC and the table; audit rows.

begin;

select plan(54);

do $users$
begin
  perform tests.create_supabase_user('rename_owner', 'rename-owner@example.com');
  perform tests.create_supabase_user('rename_other', 'rename-other@example.com');
  perform tests.create_supabase_user('rename_demo_owner', 'rename-demo-owner@example.com');
  perform tests.create_supabase_user('rename_viewer', 'rename-viewer@example.com');
  perform tests.create_supabase_user('rename_nobody', 'rename-nobody@example.com');
  perform tests.create_supabase_user('rename_short', 'rename-short@example.com');
end
$users$;

create temp table rename_ids (label text primary key, id uuid);
grant all on rename_ids to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text, p_user text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid(p_user);
  select id into tid from pg_temp.rename_ids where label = p_label;
  if uid is null or tid is null then
    raise exception 'missing mcp actor %', p_label;
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp(text, text) to authenticated, service_role;

select tests.authenticate_as('rename_owner');
select lives_ok($$select public.create_company('Example Co', true)$$, 'owner creates a company');
reset role;
insert into rename_ids (label, id)
select 'company', c.id from public.companies c where c.owner_id = tests.get_supabase_uid('rename_owner');

select tests.authenticate_as('rename_other');
select lives_ok($$select public.create_company('Other Co', true)$$, 'other owner creates a company');
reset role;
insert into rename_ids (label, id)
select 'other_company', c.id from public.companies c where c.owner_id = tests.get_supabase_uid('rename_other');

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('rename_demo_owner'), 'Demo Co', true);
insert into rename_ids (label, id)
select 'demo', c.id from public.companies c where c.name = 'Demo Co';
insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('rename_viewer'), id from rename_ids where label = 'demo';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('rename_owner'), id, 'hash-rename-owner-write', 'kid', array['write']::text[], '2099-01-01'::timestamptz
from rename_ids where label = 'company';
insert into rename_ids (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-rename-owner-write';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('rename_owner'), id, 'hash-rename-owner-read', 'kid', array['read']::text[], '2099-01-01'::timestamptz
from rename_ids where label = 'company';
insert into rename_ids (label, id) select 'read', id from private.mcp_credentials where token_hash = 'hash-rename-owner-read';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('rename_other'), id, 'hash-rename-other-write', 'kid', array['write']::text[], '2099-01-01'::timestamptz
from rename_ids where label = 'other_company';
insert into rename_ids (label, id) select 'other_write', id from private.mcp_credentials where token_hash = 'hash-rename-other-write';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('rename_viewer'), id, 'hash-rename-viewer-write', 'kid', array['write']::text[], '2099-01-01'::timestamptz
from rename_ids where label = 'demo';
insert into rename_ids (label, id) select 'viewer_write', id from private.mcp_credentials where token_hash = 'hash-rename-viewer-write';

-- RPC: owner, other company, viewer, no company, anon.

select tests.authenticate_as('rename_owner');

select is(
  public.rename_company((select id from rename_ids where label = 'company'), '  Example Holdings  '),
  jsonb_build_object(
    'id', (select id from rename_ids where label = 'company'),
    'name', 'Example Holdings',
    'prior_name', 'Example Co'
  ),
  'owner renames the company; the name is trimmed and the prior name returned'
);

select is(
  (select c.name from public.companies c where c.id = (select id from rename_ids where label = 'company')),
  'Example Holdings',
  'the new name is stored'
);

select throws_ok(
  $$select public.rename_company((select id from rename_ids where label = 'company'), ' A ')$$,
  'company name is too short',
  'a one-letter name is refused'
);

select throws_ok(
  $$select public.rename_company((select id from rename_ids where label = 'company'), repeat('a', 101))$$,
  'company name is too long',
  'a name over 100 characters is refused'
);

select lives_ok(
  $$select public.rename_company((select id from rename_ids where label = 'company'), repeat('a', 100))$$,
  'a 100-character name is accepted'
);

select lives_ok(
  $$select public.rename_company((select id from rename_ids where label = 'company'), repeat(U&'\+01F600', 100))$$,
  'a name is counted in code points: 100 emoji are accepted'
);

select throws_ok(
  $$select public.rename_company((select id from rename_ids where label = 'company'), repeat(U&'\+01F600', 101))$$,
  'company name is too long',
  '101 emoji are refused'
);

select is(
  public.rename_company((select id from rename_ids where label = 'company'), U&'\00A0\0009Example Tabs\2003\FEFF')->>'name',
  'Example Tabs',
  'tabs, no-break and other Unicode spaces are trimmed like JavaScript trim()'
);

select throws_ok(
  $$select public.rename_company((select id from rename_ids where label = 'company'), 'Example' || chr(7) || 'Bell')$$,
  'company name has a control character',
  'a control character is refused'
);

select lives_ok(
  $$select public.rename_company((select id from rename_ids where label = 'company'), 'Example Holdings')$$,
  'positive control: the owner renames their own company back'
);

select throws_ok(
  $$select public.rename_company((select id from rename_ids where label = 'other_company'), 'Taken Over')$$,
  '42501',
  'forbidden',
  'the owner cannot rename another company'
);

select throws_ok(
  $$select public.rename_company(null, 'Example Holdings')$$,
  '42501',
  'forbidden',
  'a missing company id is refused'
);

select tests.authenticate_as('rename_viewer');

select throws_ok(
  $$select public.rename_company((select id from rename_ids where label = 'demo'), 'Viewer Rename')$$,
  '42501',
  'forbidden',
  'a viewer cannot rename the demo company'
);

select tests.authenticate_as('rename_nobody');

select throws_ok(
  $$select public.rename_company((select id from rename_ids where label = 'company'), 'No Company')$$,
  '42501',
  'forbidden',
  'a user with no company is refused'
);

reset role;
set local role anon;

select throws_ok(
  $$select public.rename_company('00000000-0000-4000-8000-000000000001'::uuid, 'Anon')$$,
  '42501',
  null,
  'anon cannot call rename_company'
);

reset role;

select is(
  (select c.name from public.companies c where c.id = (select id from rename_ids where label = 'other_company')),
  'Other Co',
  'the other company keeps its name'
);

select is(
  (select c.name from public.companies c where c.id = (select id from rename_ids where label = 'demo')),
  'Demo Co',
  'the demo company keeps its name'
);

-- MCP: validation and scope.

select pg_temp.as_mcp('write', 'rename_owner');

select is(
  public.mcp_rename_company('rename-short', ' x ')->'error'->>'code',
  'validation',
  'mcp: a one-letter name is validation'
);

select is(
  public.mcp_rename_company('rename-long', repeat('a', 101))->'error'->>'code',
  'validation',
  'mcp: a long name is validation'
);

select is(
  public.mcp_rename_company(repeat('k', 129), 'Example North')->'error'->>'code',
  'validation',
  'mcp: a long idempotency key is validation'
);

select pg_temp.as_mcp('read', 'rename_owner');

select is(
  public.mcp_rename_company('rename-read', 'Example North')->'error'->>'code',
  'forbidden',
  'mcp: a read-only token cannot rename'
);

select pg_temp.as_mcp('viewer_write', 'rename_viewer');

select is(
  public.mcp_rename_company('rename-viewer', 'Viewer Rename')->'error'->>'code',
  'forbidden',
  'mcp: a viewer is refused'
);

-- MCP: write, replay, conflict. Audit rows are counted from here.

reset role;
create temp table audit_mark as
select count(*)::int as n from public.audit_log a
where a.entity = 'companies'
  and a.action = 'update'
  and a.entity_id = (select id from rename_ids where label = 'company')
  and a.actor_id = tests.get_supabase_uid('rename_owner');
grant all on audit_mark to authenticated;

create or replace function pg_temp.audit_since_mark()
returns int
language sql
as $$
  select (count(*)::int - (select n from pg_temp.audit_mark))
  from public.audit_log a
  where a.entity = 'companies'
    and a.action = 'update'
    and a.entity_id = (select id from pg_temp.rename_ids where label = 'company')
    and a.actor_id = tests.get_supabase_uid('rename_owner');
$$;

select pg_temp.as_mcp('write', 'rename_owner');

select is(
  public.mcp_rename_company('rename-control', 'Example' || chr(7) || 'North')->'error'->>'code',
  'validation',
  'mcp: a control character is validation'
);

create temp table rename_first as
select public.mcp_rename_company('rename-1', 'Example North') as response;
grant all on rename_first to authenticated;

select is(
  (select response->'data' from rename_first),
  jsonb_build_object(
    'id', (select id from rename_ids where label = 'company'),
    'name', 'Example North',
    'prior_name', 'Example Holdings',
    'undo_kind', 'company'
  ),
  'mcp: rename returns the id, both names, and the undo kind'
);

select is(
  public.mcp_rename_company('rename-1', 'Example North'),
  (select response from rename_first),
  'mcp: the same key and name replays the first response'
);

select is(
  public.mcp_rename_company('rename-1', 'Example South')->'error'->>'code',
  'conflict',
  'mcp: the same key with another name is a conflict'
);

reset role;

select is(
  (select c.name from public.companies c where c.id = (select id from rename_ids where label = 'company')),
  'Example North',
  'mcp: the name is stored once'
);

select is(
  (select count(*)::int from private.mcp_writes w
   where w.kind = 'company' and w.company_id = (select id from rename_ids where label = 'company')),
  1,
  'mcp: one undo row for the replayed write'
);

select is(
  pg_temp.audit_since_mark(),
  1,
  'audit: the MCP rename writes one row by the owner; the refused, replayed and conflicting calls write none'
);

-- MCP: another owner renames only their own company (positive control).

select pg_temp.as_mcp('other_write', 'rename_other');

select is(
  public.mcp_rename_company('rename-other', 'Other Holdings')->'data'->>'id',
  (select id::text from rename_ids where label = 'other_company'),
  'mcp: another owner renames their own company'
);

select is(
  public.mcp_undo('undo-cross', 'company', (select id from rename_ids where label = 'company'))->'error'->>'code',
  'not_found',
  'mcp: another owner cannot undo this company rename'
);

reset role;

select is(
  (select c.name from public.companies c where c.id = (select id from rename_ids where label = 'company')),
  'Example North',
  'mcp: the first company keeps its name after the other owner writes'
);

select is(
  (select c.name from public.companies c where c.id = (select id from rename_ids where label = 'other_company')),
  'Other Holdings',
  'mcp: the other company has the new name'
);

-- Undo.

select pg_temp.as_mcp('write', 'rename_owner');

select is(
  public.mcp_undo('undo-rename-1', 'company', (select id from rename_ids where label = 'company'))->'data',
  jsonb_build_object('kind', 'company', 'id', (select id from rename_ids where label = 'company')),
  'undo: restores the prior name'
);

reset role;

select is(
  (select c.name from public.companies c where c.id = (select id from rename_ids where label = 'company')),
  'Example Holdings',
  'undo: the prior name is back'
);

select is(pg_temp.audit_since_mark(), 2, 'audit: the undo writes one more row');

select pg_temp.as_mcp('write', 'rename_owner');

select is(
  public.mcp_undo('undo-rename-2', 'company', (select id from rename_ids where label = 'company'))->'error'->>'code',
  'not_found',
  'undo: a second undo finds nothing'
);

-- Undo after a later rename in the app is a conflict and changes nothing.

select is(
  public.mcp_rename_company('rename-2', 'Example East')->'data'->>'name',
  'Example East',
  'mcp: a second rename'
);

reset role;
select tests.authenticate_as('rename_owner');
select lives_ok(
  $$select public.rename_company((select id from rename_ids where label = 'company'), 'Example West')$$,
  'the app renames the company again'
);

select pg_temp.as_mcp('write', 'rename_owner');

select is(
  public.mcp_undo('undo-rename-3', 'company', (select id from rename_ids where label = 'company'))->'error'->>'code',
  'conflict',
  'undo: a later rename is a conflict'
);

reset role;

select is(
  (select c.name from public.companies c where c.id = (select id from rename_ids where label = 'company')),
  'Example West',
  'undo: the conflict leaves the newer name'
);

select is(
  pg_temp.audit_since_mark(),
  4,
  'audit: the second MCP rename and the app rename add a row each; the conflicting undo adds none'
);

-- Table: a direct update of the name is held to the same rule (23514).

select tests.authenticate_as('rename_owner');

select throws_ok(
  $$update public.companies set name = 'A' where id = (select id from rename_ids where label = 'company')$$,
  '23514',
  'company name is too short',
  'table: the owner''s own direct update with a one-letter name is refused'
);

select lives_ok(
  $$update public.companies set name = 'Example Owner' where id = (select id from rename_ids where label = 'company')$$,
  'table: the owner''s own direct update with a valid name is stored'
);

reset role;

select throws_ok(
  $$update public.companies set name = 'A' where id = (select id from rename_ids where label = 'company')$$,
  '23514',
  'company name is too short',
  'table: a one-letter name is refused'
);

select throws_ok(
  $$update public.companies set name = repeat('a', 101) where id = (select id from rename_ids where label = 'company')$$,
  '23514',
  'company name is too long',
  'table: a name over 100 characters is refused'
);

select throws_ok(
  $$update public.companies set name = U&'Example West\00A0' where id = (select id from rename_ids where label = 'company')$$,
  '23514',
  'company name is not trimmed',
  'table: a name with surrounding whitespace is refused'
);

select throws_ok(
  $$update public.companies set name = 'Example' || chr(10) || 'West' where id = (select id from rename_ids where label = 'company')$$,
  '23514',
  'company name has a control character',
  'table: a control character is refused'
);

insert into public.companies (owner_id, name)
values (tests.get_supabase_uid('rename_short'), 'Z');

select lives_ok(
  $$update public.companies set vat_registered = false where owner_id = tests.get_supabase_uid('rename_short')$$,
  'table: an older name that breaks the rule does not block an update of another column'
);

select lives_ok(
  $$update public.companies set name = 'Example Direct' where id = (select id from rename_ids where label = 'company')$$,
  'table: positive control, a valid name is stored'
);

-- Grants.

select ok(
  not has_function_privilege('anon', 'public.mcp_rename_company(text, text)', 'execute'),
  'anon cannot execute mcp_rename_company'
);

select ok(
  has_function_privilege('authenticated', 'public.rename_company(uuid, text)', 'execute'),
  'authenticated can execute rename_company'
);

select * from finish();

rollback;
