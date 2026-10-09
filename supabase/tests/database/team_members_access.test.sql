-- FLOW-601 (decision 0167). Restricted roles probed against every team and owner-only path, and the
-- company binding (the x-flow-company header, the MCP credential) never reaches another company.
-- Each refusal has a positive control. Invented names and @example.com emails only.

begin;

select plan(46);

do $users$
begin
  perform tests.create_supabase_user('ta_owner', 'ta-owner@example.com');
  perform tests.create_supabase_user('ta_editor', 'ta-editor@example.com');
  perform tests.create_supabase_user('ta_viewer', 'ta-viewer@example.com');
  perform tests.create_supabase_user('ta_spare', 'ta-spare@example.com');
end
$users$;

create temp table ta (label text primary key, id uuid);
grant all on ta to authenticated, service_role;

create or replace function pg_temp.ta_id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.ta where label = p_label; $$;
grant execute on function pg_temp.ta_id(text) to authenticated, service_role;

insert into ta (label, id) values
  ('a', tests.fixture_company('ta_owner', 'Example Access')),
  ('viewer_own', tests.fixture_company('ta_viewer', 'Example Viewer Own')),
  ('owner', tests.get_supabase_uid('ta_owner')),
  ('editor', tests.get_supabase_uid('ta_editor')),
  ('viewer', tests.get_supabase_uid('ta_viewer')),
  ('spare', tests.get_supabase_uid('ta_spare'));

select tests.authenticate_as('ta_owner');
insert into ta (label, id) select 'b', public.create_company('Example Access Two', true);
select public.switch_company(pg_temp.ta_id('a'));

-- Members as accept_invite writes them: editor and viewer of a; spare is an editor of b only.
reset role;
insert into public.company_members (company_id, user_id, role) values
  (pg_temp.ta_id('a'), pg_temp.ta_id('editor'), 'editor'),
  (pg_temp.ta_id('a'), pg_temp.ta_id('viewer'), 'viewer'),
  (pg_temp.ta_id('b'), pg_temp.ta_id('spare'), 'editor');
insert into public.active_companies (user_id, company_id) values (pg_temp.ta_id('viewer'), pg_temp.ta_id('a'));

select tests.authenticate_as('ta_owner');
insert into ta (label, id) select 'inv', (public.invite_member('ta-new@example.com', 'viewer')->>'id')::uuid;

-- A viewer member: every team write is refused.
select tests.authenticate_as('ta_viewer');
select throws_ok($$select public.invite_member('ta-x@example.com', 'viewer')$$, '42501', 'forbidden', 'a viewer cannot invite');
select throws_ok(format('select public.set_member_role(%L, %L)', pg_temp.ta_id('editor'), 'viewer'), '42501', 'forbidden',
  'or change a role');
select throws_ok(format('select public.remove_member(%L)', pg_temp.ta_id('editor')), '42501', 'forbidden', 'or remove a member');
select throws_ok(format('select public.cancel_invite(%L)', pg_temp.ta_id('inv')), 'P0001', 'invite not found', 'or cancel an invite');
select is(public.list_team()->'invites', '[]'::jsonb, 'and sees no pending invites');

-- The header opens the viewer's own company (positive control), and a header for the company they
-- only view never lends them their own company's write rights.
select set_config('request.headers', json_build_object('x-flow-company', pg_temp.ta_id('viewer_own'))::text, true);
select is(private.current_company_id(), pg_temp.ta_id('viewer_own'), 'the header opens the viewer''s own company for writes');
select set_config('request.headers', json_build_object('x-flow-company', pg_temp.ta_id('a'))::text, true);
select is(private.current_company_id(), null, 'a header for the company they view writes nowhere');
select is(private.readable_company_id(), pg_temp.ta_id('a'), 'and reads that company');
select set_config('request.headers', '', true);

-- An editor: the team and the owner's settings are refused.
select tests.authenticate_as('ta_editor');
select throws_ok(format('select public.set_member_role(%L, %L)', pg_temp.ta_id('viewer'), 'editor'), '42501', 'forbidden',
  'an editor cannot change a role');
select throws_ok(format('select public.remove_member(%L)', pg_temp.ta_id('viewer')), '42501', 'forbidden',
  'or remove a member');
select throws_ok(format('select public.cancel_invite(%L)', pg_temp.ta_id('inv')), 'P0001', 'invite not found', 'or cancel an invite');
select throws_ok($$select public.disconnect_connector('mercury')$$, 'P0001', 'no company', 'or disconnect a connector');
select throws_ok($$select public.disconnect_sumit()$$, 'P0001', 'no company', 'or SUMIT');
select throws_ok($$select public.set_import_from('mercury', date '2026-01-01')$$, 'P0001', 'no company', 'or the import date');
reset role;
select is(public.owner_company_for(pg_temp.ta_id('editor'), pg_temp.ta_id('a')), null, 'and edge functions find no company of theirs');

-- Positive controls: the owner does each of these.
select tests.authenticate_as('ta_owner');
select lives_ok($$select public.disconnect_connector('mercury')$$, 'the owner disconnects a connector');
select lives_ok($$select public.disconnect_sumit()$$, 'and SUMIT');
select is(public.set_member_role(pg_temp.ta_id('viewer'), 'viewer')->>'prior_role', 'viewer', 'and changes a role in a');

-- The owner's own write in a does not reach b's member, and the header for b does.
select throws_ok(format('select public.remove_member(%L)', pg_temp.ta_id('spare')), 'P0001', 'member not found',
  'company a''s team does not reach company b''s member');
select throws_ok(format('select public.set_member_role(%L, %L)', pg_temp.ta_id('spare'), 'viewer'), 'P0001', 'member not found',
  'nor changes their role');
select throws_ok($$select public.invite_member(' TA-Editor@example.com ', 'viewer')$$, 'P0001', 'already a member',
  'a member''s email is already a member');
select set_config('request.headers', json_build_object('x-flow-company', pg_temp.ta_id('b'))::text, true);
select is(public.set_member_role(pg_temp.ta_id('spare'), 'viewer')->>'prior_role', 'editor', 'with b open, b''s member is reached');
select set_config('request.headers', '', true);

-- MCP: a token bound to a never reaches b, even with the header for b.
reset role;
select public.store_mcp_credential(pg_temp.ta_id('owner'), 'hash-ta-write-0001', array['read', 'write'],
  now() + interval '90 days', 'pepper-1');
insert into ta (label, id) select 'cred', id from private.mcp_credentials where token_hash = 'hash-ta-write-0001';

create or replace function pg_temp.ta_mcp()
returns void
language plpgsql
as $$
declare
  uid uuid := pg_temp.ta_id('owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'mcp_tid', pg_temp.ta_id('cred'))::text, true);
end;
$$;
grant execute on function pg_temp.ta_mcp() to authenticated, service_role;

select pg_temp.ta_mcp();
select set_config('request.headers', json_build_object('x-flow-company', pg_temp.ta_id('b'))::text, true);
select is(public.mcp_remove_member('ta-1', pg_temp.ta_id('spare'))->>'ok', 'false', 'a token for a cannot remove b''s member');
select is(public.mcp_set_member_role('ta-2', pg_temp.ta_id('editor'), 'viewer')->'data'->>'prior_role', 'editor',
  'while it changes a''s member (positive control)');
select set_config('request.headers', '', true);
reset role;
select is((select m.role from public.company_members m where m.company_id = pg_temp.ta_id('b') and m.user_id = pg_temp.ta_id('spare')),
  'viewer', 'b''s member is untouched');

-- A credential whose user no longer belongs to its company opens nothing.
update private.mcp_credentials set company_id = pg_temp.ta_id('viewer_own') where id = pg_temp.ta_id('cred');
select pg_temp.ta_mcp();
select is(private.readable_company_id(), null, 'a token for a company its user does not belong to reads nothing');
reset role;
update private.mcp_credentials set company_id = pg_temp.ta_id('a') where id = pg_temp.ta_id('cred');

-- A credential of another user is not this user's.
update private.mcp_credentials set user_id = pg_temp.ta_id('editor') where id = pg_temp.ta_id('cred');
select pg_temp.ta_mcp();
select is(private.readable_company_id(), null, 'another user''s credential opens nothing');
reset role;
update private.mcp_credentials set user_id = pg_temp.ta_id('owner') where id = pg_temp.ta_id('cred');
select pg_temp.ta_mcp();
select is(private.readable_company_id(), pg_temp.ta_id('a'), 'the owner''s own credential opens a (positive control)');

-- MCP undo: only this company's own write, only while it still stands.
select pg_temp.ta_mcp();
insert into ta (label, id) select 'mcp_inv', (public.mcp_invite_member('ta-3', 'ta-undo@example.com', 'viewer')->'data'->>'id')::uuid;
select is(public.mcp_invite_member('ta-4', 'ta-undo@example.com', 'editor')->'data'->>'undo_kind', null,
  'inviting a pending email again has no undo');
select is(public.mcp_invite_member('ta-4b', 'ta-new@example.com', 'editor')->'data'->>'existing', 'true',
  'the agent re-sends an invite the owner made in the app');
select is(public.mcp_undo('ta-4c', 'invite', pg_temp.ta_id('inv'))->'error'->>'code', 'not_found',
  'and cannot undo (cancel) the owner''s own invite');
reset role;
update public.company_invites set status = 'cancelled' where id = pg_temp.ta_id('mcp_inv');
select pg_temp.ta_mcp();
select is(public.mcp_undo('ta-5', 'invite', pg_temp.ta_id('mcp_inv'))->'error'->>'code', 'conflict',
  'undo of an invite that is no longer pending is a conflict');
select is(public.mcp_set_member_role('ta-6', pg_temp.ta_id('viewer'), 'editor')->'data'->>'prior_role', 'viewer', 'a role change');
reset role;
update public.company_members set role = 'viewer' where company_id = pg_temp.ta_id('a') and user_id = pg_temp.ta_id('viewer');
select pg_temp.ta_mcp();
select is(public.mcp_undo('ta-7', 'member_role', pg_temp.ta_id('viewer'))->'error'->>'code', 'conflict',
  'undo of a role changed again since is a conflict');
select is(public.mcp_remove_member('ta-8', pg_temp.ta_id('viewer'))->'data'->>'prior_role', 'viewer', 'a removal');
reset role;
select is((select count(*)::integer from public.active_companies where user_id = pg_temp.ta_id('viewer')), 0,
  'the removed member''s saved company goes with them');
insert into public.company_members (company_id, user_id, role) values (pg_temp.ta_id('a'), pg_temp.ta_id('viewer'), 'editor');
select pg_temp.ta_mcp();
select is(public.mcp_undo('ta-9', 'member_remove', pg_temp.ta_id('viewer'))->'error'->>'code', 'conflict',
  'undo of a removal once they are back is a conflict');

-- A token for b does not undo a's writes.
reset role;
update public.active_companies set company_id = pg_temp.ta_id('b') where user_id = pg_temp.ta_id('owner');
select public.store_mcp_credential(pg_temp.ta_id('owner'), 'hash-ta-write-0002', array['read', 'write'],
  now() + interval '90 days', 'pepper-1');
update pg_temp.ta set id = (select id from private.mcp_credentials where token_hash = 'hash-ta-write-0002') where label = 'cred';
select pg_temp.ta_mcp();
select is(public.mcp_undo('ta-10', 'member_role', pg_temp.ta_id('editor'))->'error'->>'code', 'not_found',
  'a token for b does not undo a''s role change');
reset role;
update public.company_invites set status = 'pending' where id = pg_temp.ta_id('mcp_inv');
update public.company_invites set status = 'cancelled' where company_id = pg_temp.ta_id('a') and email = 'ta-undo@example.com' and id <> pg_temp.ta_id('mcp_inv');
select pg_temp.ta_mcp();
select is(public.mcp_undo('ta-11', 'invite', pg_temp.ta_id('mcp_inv'))->'error'->>'code', 'not_found',
  'nor a''s invite');
reset role;
select is((select status from public.company_invites where id = pg_temp.ta_id('mcp_inv')), 'pending', 'which stays pending');

-- A saved company the user no longer belongs to is not opened.
insert into public.active_companies (user_id, company_id) values (pg_temp.ta_id('spare'), pg_temp.ta_id('a'))
on conflict (user_id) do update set company_id = excluded.company_id;
select tests.authenticate_as('ta_spare');
select is(private.readable_company_id(), pg_temp.ta_id('b'), 'a stale saved company falls back to their own membership');

-- Invites: the inbox and the invite's state.
reset role;
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'google', now(), now(), now()
from auth.users u
where u.email = 'ta-spare@example.com';
select tests.authenticate_as('ta_owner');
select public.switch_company(pg_temp.ta_id('a'));
insert into ta (label, id) select 'inv_spare', (public.invite_member('ta-spare@example.com', 'viewer')->>'id')::uuid;
select tests.authenticate_as('ta_spare');
select is(jsonb_array_length(public.my_invites()), 1, 'the invitee sees the invite (positive control)');
select is(public.decline_invite(pg_temp.ta_id('inv_spare'))->>'status', 'declined', 'and declines it');
select throws_ok(format('select public.decline_invite(%L)', pg_temp.ta_id('inv_spare')), 'P0001', 'invite is not pending',
  'a declined invite cannot be declined again');
select tests.authenticate_as('ta_owner');
insert into ta (label, id) select 'inv_spare2', (public.invite_member('ta-spare@example.com', 'editor')->>'id')::uuid;
select tests.authenticate_as('ta_spare');
select throws_ok(format('select public.reopen_invite(%L)', pg_temp.ta_id('inv_spare')), 'P0001', 'invite is not declined',
  'a decline is not taken back while a newer invite is pending');
reset role;
insert into public.company_members (company_id, user_id, role) values (pg_temp.ta_id('a'), pg_temp.ta_id('spare'), 'viewer');
select tests.authenticate_as('ta_spare');
select is(public.my_invites(), '[]'::jsonb, 'an invite to a company they already belong to leaves the inbox');

select * from finish();
rollback;
