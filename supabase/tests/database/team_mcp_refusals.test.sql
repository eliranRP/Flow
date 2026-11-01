-- FLOW-601 (decision 0167). remove_member refuses with the reason docs/mcp/TOOLS.md names, not the generic
-- "The write was refused.". Inviting and role changes are not MCP writes (decision 0241); see
-- team_mcp_no_invites.test.sql. Invented names and @example.com emails only.

begin;

select plan(1);

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
select is(public.mcp_remove_member('tr-4', (select id from tr where label = 'stranger'))->'error',
  '{"code": "refused", "message": "member not found"}'::jsonb, 'remove_member on a non-member is member not found');


select * from finish();
rollback;
