-- FLOW-601 (decision 0167). The MCP team writes refuse with the reasons docs/mcp/TOOLS.md names,
-- not the generic "The write was refused.". Invented names and @example.com emails only.

begin;

select plan(6);

do $users$
begin
  perform tests.create_supabase_user('tr_owner', 'tr-owner@example.com');
  perform tests.create_supabase_user('tr_stranger', 'tr-stranger@example.com');
end
$users$;

create temp table tr (label text primary key, id uuid);
grant all on tr to authenticated, service_role;
insert into tr (label, id) values
  ('a', tests.fixture_company('tr_owner', 'Example Refusals')),
  ('owner', tests.get_supabase_uid('tr_owner')),
  ('stranger', tests.get_supabase_uid('tr_stranger'));

select public.store_mcp_credential((select id from tr where label = 'owner'), 'hash-tr-write-0001',
  array['read', 'write'], now() + interval '90 days', 'pepper-1');
insert into tr (label, id) select 'cred', id from private.mcp_credentials where token_hash = 'hash-tr-write-0001';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
as $$
declare
  uid uuid := (select id from pg_temp.tr where label = 'owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'mcp_tid', (select id from pg_temp.tr where label = 'cred'))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

select pg_temp.as_mcp();
select is(public.mcp_invite_member('tr-1', ' TR-Owner@example.com ', 'viewer')->'error',
  '{"code": "refused", "message": "already a member"}'::jsonb, 'the owner''s own email is already a member');
select is(public.mcp_invite_member('tr-2', 'not an email', 'viewer')->'error',
  '{"code": "refused", "message": "invalid email"}'::jsonb, 'a malformed email is invalid email');
select is(public.mcp_set_member_role('tr-3', (select id from tr where label = 'stranger'), 'editor')->'error',
  '{"code": "refused", "message": "member not found"}'::jsonb, 'set_member_role on a non-member is member not found');
select is(public.mcp_remove_member('tr-4', (select id from tr where label = 'stranger'))->'error',
  '{"code": "refused", "message": "member not found"}'::jsonb, 'remove_member on a non-member is member not found');

reset role;
insert into public.company_invites (company_id, email, role, invited_by)
select (select id from tr where label = 'a'), 'tr-fill-' || n || '@example.com', 'viewer', (select id from tr where label = 'owner')
from generate_series(1, 50) n;
select pg_temp.as_mcp();
select is(public.mcp_invite_member('tr-5', 'tr-one-more@example.com', 'viewer')->'error',
  '{"code": "refused", "message": "too many invites"}'::jsonb, 'the 51st pending invite is too many invites');
select is(public.mcp_invite_member('tr-6', 'tr-fill-1@example.com', 'editor')->'data'->>'existing', 'true',
  'and a pending email still answers its invite (positive control)');

select * from finish();
rollback;
