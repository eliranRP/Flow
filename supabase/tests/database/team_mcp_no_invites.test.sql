-- Decision 0241. A flow-mcp token cannot invite people or change a member's role: invite_member and
-- set_member_role refuse a request that carries mcp_tid (forbidden, 42501), before anything else.
-- The owner without a token still does both (positive controls). Invented names and @example.com
-- emails only.

begin;

select plan(7);

do $users$
begin
  perform tests.create_supabase_user('ni_owner', 'ni-owner@example.com');
  perform tests.create_supabase_user('ni_member', 'ni-member@example.com');
end
$users$;

create temp table ni (label text primary key, id uuid);
grant all on ni to authenticated, service_role;
insert into ni (label, id) values
  ('a', tests.fixture_company('ni_owner', 'Example No Invites')),
  ('owner', tests.get_supabase_uid('ni_owner')),
  ('member', tests.get_supabase_uid('ni_member'));

reset role;
insert into public.company_members (company_id, user_id, role)
values ((select id from ni where label = 'a'), (select id from ni where label = 'member'), 'viewer');

select public.store_mcp_credential((select id from ni where label = 'owner'), 'hash-ni-write-0001',
  array['read', 'write'], now() + interval '90 days', 'pepper-1');
insert into ni (label, id) select 'cred', id from private.mcp_credentials where token_hash = 'hash-ni-write-0001';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
as $$
declare
  uid uuid := (select id from pg_temp.ni where label = 'owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'mcp_tid', (select id from pg_temp.ni where label = 'cred'))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

-- The owner's token: both refused.
select pg_temp.as_mcp();
select throws_ok($$select public.invite_member('ni-new@example.com', 'viewer')$$, '42501', 'forbidden',
  'a token cannot invite');
select throws_ok(format('select public.set_member_role(%L, %L)', (select id from ni where label = 'member'), 'editor'),
  '42501', 'forbidden', 'or change a role');
reset role;
select is((select count(*)::integer from public.company_invites where email = 'ni-new@example.com'), 0, 'and no invite was written');
select is((select role from public.company_members where user_id = (select id from ni where label = 'member')), 'viewer',
  'and the role did not change');

-- The same owner without a token (positive controls).
select tests.authenticate_as('ni_owner');
select public.switch_company((select id from ni where label = 'a'));
select is(public.invite_member('ni-new@example.com', 'viewer')->>'status', 'pending', 'the owner without a token invites');
select is(public.set_member_role((select id from ni where label = 'member'), 'editor')->>'prior_role', 'viewer',
  'and changes a role');
select throws_ok($$select public.invite_member('ni-bad', 'viewer')$$, 'P0001', 'invalid email',
  'and the owner''s own checks still apply');

select * from finish();
rollback;
