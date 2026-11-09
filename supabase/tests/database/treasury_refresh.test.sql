-- FLOW-1122: refresh_treasury_yields (owner or editor, once every five minutes for everyone), MCP
-- refresh_treasury_yields, and get_member_report's treasury_fetched_at and treasury_requested_at.
-- Invented names only. The local database has no vault secrets, so a request answers unavailable.

begin;

select plan(10);

do $users$
begin
  perform tests.create_supabase_user('trf_owner', 'trf-owner@example.com');
  perform tests.create_supabase_user('trf_editor', 'trf-editor@example.com');
  perform tests.create_supabase_user('trf_viewer', 'trf-viewer@example.com');
end
$users$;

create temp table trf (label text primary key, id uuid);
grant all on trf to authenticated, service_role;
insert into trf (label, id) values ('co', tests.fixture_company('trf_owner', 'Example Refresh LLC', true));
insert into public.company_members (company_id, user_id, role)
values ((select id from trf where label = 'co'), tests.get_supabase_uid('trf_editor'), 'editor');
insert into public.company_viewers (user_id, company_id)
values (tests.get_supabase_uid('trf_viewer'), (select id from trf where label = 'co'));

select public.store_mcp_credential(tests.get_supabase_uid('trf_owner'), 'hash-trf-write01', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into trf (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-trf-write01';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('trf_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', (select id from pg_temp.trf where label = 'write'))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

select tests.authenticate_as('trf_owner');
select is(public.refresh_treasury_yields()->>'reason', 'unavailable', 'without the job''s secrets the owner''s request answers unavailable');
select ok(public.get_member_report() ? 'treasury_fetched_at', 'the report says when the yields were last stored');
select is(public.get_member_report()->'treasury_requested_at', 'null'::jsonb, 'and when they were last asked for: never yet');

select tests.authenticate_as('trf_editor');
select is(public.refresh_treasury_yields()->>'requested', 'false', 'an editor may ask too');

select tests.authenticate_as('trf_viewer');
select throws_ok($$select public.refresh_treasury_yields()$$, '42501', 'forbidden', 'a viewer cannot');

-- A request in the last five minutes, from anyone, holds the next one back.
reset role;
insert into private.treasury_refresh (id, requested_at) values (true, now() - interval '2 minutes');
select tests.authenticate_as('trf_owner');
select is(public.refresh_treasury_yields()->>'reason', 'recent', 'a request two minutes ago holds this one back');
select ok((public.get_member_report()->>'treasury_requested_at') is not null, 'and the report shows when it was');
reset role;
update private.treasury_refresh set requested_at = now() - interval '6 minutes';
select tests.authenticate_as('trf_owner');
select is(public.refresh_treasury_yields()->>'reason', 'unavailable', 'after five minutes it is asked again');

-- MCP.
select pg_temp.as_mcp();
select is(public.mcp_refresh_treasury_yields('trf-1')->'data'->>'reason', 'unavailable', 'MCP asks the same');
select is(public.mcp_refresh_treasury_yields('')->'error'->>'code', 'validation', 'an empty key is validation');

select * from finish();
rollback;
