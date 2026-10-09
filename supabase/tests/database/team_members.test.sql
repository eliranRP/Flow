-- FLOW-601 (decision 0167). Team members, invites, several companies per user, and which company
-- a request opens. Invented names and @example.com emails only.

begin;

select plan(70);

do $users$
begin
  perform tests.create_supabase_user('tm_owner', 'tm-owner@example.com');
  perform tests.create_supabase_user('tm_editor', 'TM-Editor@example.com');
  perform tests.create_supabase_user('tm_viewer', 'tm-viewer@example.com');
  perform tests.create_supabase_user('tm_other', 'tm-other@example.com');
  perform tests.create_supabase_user('tm_unconfirmed', 'tm-unconfirmed@example.com');
end
$users$;

-- Invitees sign in with Google with the invited address (decision 0167).
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'google', now(), now(), now()
from auth.users u
where u.email in ('TM-Editor@example.com', 'tm-viewer@example.com', 'tm-other@example.com', 'tm-unconfirmed@example.com');

update auth.users set email_confirmed_at = null where email = 'tm-unconfirmed@example.com';
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"full_name": "Dana Example"}'::jsonb
where email = 'tm-owner@example.com';

create temp table tm (label text primary key, id uuid);
grant all on tm to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.tm where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- The invite row, read past RLS (browser roles have no table grants).
create or replace function pg_temp.invite(p_label text)
returns public.company_invites
language sql
security definer
as $$ select i from public.company_invites i where i.id = pg_temp.id(p_label); $$;
grant execute on function pg_temp.invite(text) to authenticated, service_role;

insert into tm (label, id) values
  ('a', tests.fixture_company('tm_owner', 'Example Works')),
  ('other_co', tests.fixture_company('tm_other', 'Example Other Ltd')),
  ('owner', tests.get_supabase_uid('tm_owner')),
  ('editor', tests.get_supabase_uid('tm_editor')),
  ('viewer', tests.get_supabase_uid('tm_viewer')),
  ('other', tests.get_supabase_uid('tm_other'));

-- Several companies per owner.
select tests.authenticate_as('tm_owner');
select is(private.current_company_id(), pg_temp.id('a'), 'an owner with one company opens it');
select throws_ok($$select public.create_company('Example Works', true)$$, 'P0001', 'company already exists',
  'the same name twice is refused');
insert into tm (label, id) values ('b', public.create_company('Example Homes', true));
select isnt(pg_temp.id('b'), null, 'a second company with another name is created');
select is(private.current_company_id(), pg_temp.id('b'), 'and it opens');
select is(jsonb_array_length(public.list_my_companies()->'companies'), 2, 'the switcher lists both');
select is(public.list_my_companies()->>'active_id', pg_temp.id('b')::text, 'with the new one active');
select is(public.switch_company(pg_temp.id('a'))->>'role', 'owner', 'switching back answers the role');
select is(private.current_company_id(), pg_temp.id('a'), 'and the first company opens again');
select throws_ok(format('select public.switch_company(%L)', pg_temp.id('other_co')), '42501', 'forbidden',
  'a company the user does not belong to cannot be opened');

-- The x-flow-company header picks the company for one request.
select set_config('request.headers', json_build_object('x-flow-company', pg_temp.id('b'))::text, true);
select is(private.current_company_id(), pg_temp.id('b'), 'the header opens the other own company');
select is(public.list_my_companies()->>'active_id', pg_temp.id('b')::text, 'and the switcher marks it');
select set_config('request.headers', json_build_object('x-flow-company', pg_temp.id('other_co'))::text, true);
select is(private.current_company_id(), pg_temp.id('a'), 'a header for a stranger''s company is ignored');
select set_config('request.headers', '{"x-flow-company": "not-a-uuid"}', true);
select is(private.current_company_id(), pg_temp.id('a'), 'and so is a header that is not an id');
select set_config('request.headers', '', true);

-- Invites.
select throws_ok($$select public.invite_member('not an email', 'viewer')$$, 'P0001', 'invalid email', 'an email is checked');
select throws_ok($$select public.invite_member('a@example.com', 'owner')$$, 'P0001', 'validation', 'a role is editor or viewer');
select throws_ok($$select public.invite_member(' TM-Owner@example.com ', 'viewer')$$, 'P0001', 'already a member',
  'the owner cannot invite their own email');
insert into tm (label, id) select 'inv_editor', (public.invite_member(' tm-editor@EXAMPLE.com ', 'viewer')->>'id')::uuid;
select is((select i.email || ':' || i.role || ':' || i.status from pg_temp.invite('inv_editor') i),
  'tm-editor@example.com:viewer:pending', 'an invite stores the email in lower case, viewer by default');
select is(public.invite_member('tm-editor@example.com', 'editor')->>'existing', 'true',
  'inviting the same email again answers the pending invite');
select is((pg_temp.invite('inv_editor')).role, 'editor', 'with the new role');
insert into tm (label, id) select 'inv_viewer', (public.invite_member('tm-viewer@example.com')->>'id')::uuid;
insert into tm (label, id) select 'inv_unconfirmed', (public.invite_member('tm-unconfirmed@example.com', 'editor')->>'id')::uuid;
insert into tm (label, id) select 'inv_undo', (public.invite_member('someone@example.com', 'viewer')->>'id')::uuid;
select is(public.cancel_invite(pg_temp.id('inv_undo'))->>'status', 'cancelled', 'the owner can take an invite back');
select throws_ok(format('select public.cancel_invite(%L)', pg_temp.id('inv_undo')), 'P0001', 'invite is not pending',
  'only once');
select is(jsonb_array_length(public.list_team()->'invites'), 3, 'the owner''s team page lists the three pending invites');
select is(public.list_team()->'members'->0->>'name', 'Dana Example', 'the owner''s name comes from the Google profile');
select is(public.list_team()->>'can_manage', 'true', 'and the owner manages the team');

-- An invite for company b, made through the header, for the editor's inbox.
select set_config('request.headers', json_build_object('x-flow-company', pg_temp.id('b'))::text, true);
insert into tm (label, id) select 'inv_b', (public.invite_member('tm-editor@example.com', 'viewer')->>'id')::uuid;
select set_config('request.headers', '', true);
select is((pg_temp.invite('inv_b')).company_id, pg_temp.id('b'),
  'an invite goes to the company the request opens');

-- Someone else cannot see or act on them.
select tests.authenticate_as('tm_other');
select is(public.my_invites(), '[]'::jsonb, 'another user has no invites');
select throws_ok(format('select public.accept_invite(%L)', pg_temp.id('inv_editor')), 'P0001', 'invite not found',
  'and cannot join through someone else''s invite');
select throws_ok(format('select public.cancel_invite(%L)', pg_temp.id('inv_editor')), 'P0001', 'invite not found',
  'or cancel it');
select is(jsonb_array_length(public.list_team()->'members'), 1, 'their own team is only them');

-- An unconfirmed email sees nothing.
select tests.authenticate_as('tm_unconfirmed');
select is(public.my_invites(), '[]'::jsonb, 'an unconfirmed email has no inbox');
select throws_ok(format('select public.accept_invite(%L)', pg_temp.id('inv_unconfirmed')), 'P0001', 'invite not found',
  'and cannot join');

-- The editor: two invites, declines one and takes it back, joins the other.
select tests.authenticate_as('tm_editor');
select is(private.readable_company_id(), null, 'before joining, an invitee has no company');
select is(jsonb_array_length(public.my_invites()), 2, 'the inbox has both invites (matched without case)');
select is(
  (select string_agg(x->>'company_name', ', ' order by x->>'company_name') from jsonb_array_elements(public.my_invites()) x),
  'Example Homes, Example Works', 'each with the company name'
);
select is(public.my_invites()->0->>'invited_by_name', 'Dana Example', 'and who invited');
select is(public.decline_invite(pg_temp.id('inv_b'))->>'status', 'declined', 'decline');
select is(jsonb_array_length(public.my_invites()), 1, 'a declined invite leaves the inbox');
select is(public.reopen_invite(pg_temp.id('inv_b'))->>'status', 'pending', 'the toast''s ביטול brings it back');
select is(public.decline_invite(pg_temp.id('inv_b'))->>'status', 'declined', 'decline for good');
select is(public.accept_invite(pg_temp.id('inv_editor'))->>'role', 'editor', 'join as editor');
select is(private.current_company_id(), pg_temp.id('a'), 'the joined company opens and the editor can write');
select is(
  public.rename_category((select id from public.categories where company_id = pg_temp.id('a') order by name limit 1), 'Example Edited')->>'name',
  'Example Edited', 'an editor renames a category'
);
select is(public.list_my_companies()->>'role', 'editor', 'the switcher says editor');
select is(public.list_team()->>'can_manage', 'false', 'an editor does not manage the team');
select is(public.list_team()->'invites', '[]'::jsonb, 'and sees no pending invites');
select throws_ok($$select public.invite_member('x@example.com', 'viewer')$$, '42501', 'forbidden', 'or invite');
select throws_ok($$select public.set_company_integration(true, 'shadow', 0.9, 'jev')$$, '42501', 'forbidden',
  'Jev settings stay the owner''s');
reset role;
select is(public.owner_company_for(pg_temp.id('editor'), pg_temp.id('a')), null,
  'edge functions find no owned company for an editor');
select is(public.owner_company_for(pg_temp.id('owner'), pg_temp.id('b')), pg_temp.id('b'),
  'and the owner''s company from the app''s header');

-- The viewer reads only.
select tests.authenticate_as('tm_viewer');
select is(public.accept_invite(pg_temp.id('inv_viewer'))->>'role', 'viewer', 'join as viewer');
select is(private.current_company_id(), null, 'a viewer cannot write');
select is(private.readable_company_id(), pg_temp.id('a'), 'and reads the company');
select is(public.get_dashboard(null, null, 'cash')->>'company_id', pg_temp.id('a')::text, 'the dashboard reads it');
select throws_ok(
  format($$select public.rename_category(%L, 'Example Name')$$, (select id from public.categories where company_id = pg_temp.id('a') limit 1)),
  '42501', 'forbidden', 'a write RPC refuses a viewer member as forbidden'
);
select ok(private.is_read_only(), 'a viewer member is read only');

-- The owner changes and removes.
select tests.authenticate_as('tm_owner');
select is(jsonb_array_length(public.list_team()->'members'), 3, 'the team is the owner and two members');
select is(public.set_member_role(pg_temp.id('viewer'), 'editor')->>'prior_role', 'viewer', 'the owner makes the viewer an editor');
select throws_ok(format('select public.set_member_role(%L, %L)', pg_temp.id('other'), 'editor'), 'P0001', 'member not found',
  'a stranger is not a member');
select is(public.remove_member(pg_temp.id('viewer'))->>'prior_role', 'editor', 'the owner removes a member');
reset role;
select throws_ok(
  format($$insert into public.company_members (company_id, user_id, role) values (%L, %L, 'editor')$$, pg_temp.id('a'), pg_temp.id('owner')),
  '42501', 'an owner is not a member', 'the owner is never a member row'
);

select tests.authenticate_as('tm_viewer');
select is(private.readable_company_id(), null, 'a removed member reads nothing');

-- MCP: a token is bound to its credential's company, and the team writes undo.
reset role;
select public.store_mcp_credential(pg_temp.id('owner'), 'hash-tm-write-01', array['read', 'write'],
  now() + interval '90 days', 'pepper-1');
insert into tm (label, id) select 'cred', id from private.mcp_credentials where token_hash = 'hash-tm-write-01';
select is((select company_id from private.mcp_credentials where id = pg_temp.id('cred')), pg_temp.id('a'),
  'the MCP credential is for the owner''s open company');

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
as $$
declare
  uid uuid := pg_temp.id('owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id('cred'))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

select pg_temp.as_mcp();
select set_config('request.headers', json_build_object('x-flow-company', pg_temp.id('b'))::text, true);
select is(private.current_company_id(), pg_temp.id('a'), 'an MCP token ignores the header and keeps its company');
select set_config('request.headers', '', true);
insert into tm (label, id) select 'mcp_inv', (public.mcp_invite_member('tm-k1', 'new-member@example.com', 'editor')->'data'->>'id')::uuid;
select is((pg_temp.invite('mcp_inv')).status, 'pending', 'MCP invite_member invites');
select is(public.mcp_undo('tm-u1', 'invite', pg_temp.id('mcp_inv'))->>'ok', 'true', 'undo cancels it');
select is(public.mcp_set_member_role('tm-k2', pg_temp.id('editor'), 'viewer')->'data'->>'prior_role', 'editor',
  'MCP set_member_role');
select is(public.mcp_undo('tm-u2', 'member_role', pg_temp.id('editor'))->>'ok', 'true', 'undo restores the role');
select is(public.mcp_remove_member('tm-k3', pg_temp.id('editor'))->'data'->>'prior_role', 'editor', 'MCP remove_member');
select is(public.mcp_undo('tm-u3', 'member_remove', pg_temp.id('editor'))->>'ok', 'true', 'undo adds the member back');
select is(public.list_team()->'members'->1->>'role', 'editor', 'MCP list_team shows them as editor again');

select * from finish();
rollback;
