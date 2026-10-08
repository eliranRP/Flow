-- MCP set_jev_mode with undo kind jev_mode (FLOW-702, #231 review; decisions 0095 and 0145).
-- Invented data only.

begin;

select plan(16);

do $users$
begin
  perform tests.create_supabase_user('sjm_owner', 'sjm-owner@example.com');
  perform tests.create_supabase_user('sjm_other', 'sjm-other@example.com');
end
$users$;

create temp table sjm (label text primary key, id uuid);
grant all on sjm to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.sjm where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into sjm (label, id) values ('co', tests.fixture_company('sjm_owner', 'Example Jev Mode LLC'));
insert into sjm (label, id) values ('other_co', tests.fixture_company('sjm_other', 'Example Other Jev LLC'));
insert into public.company_integrations (company_id, provider, enabled, mode, threshold)
values (pg_temp.id('other_co'), 'jev', true, 'shadow', 0.90);

select public.store_mcp_credential(tests.get_supabase_uid('sjm_owner'), 'hash-sjm-write01', array['read','write'],
  now() + interval '90 days', 'pepper-1');
select public.store_mcp_credential(tests.get_supabase_uid('sjm_other'), 'hash-sjm-other01', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into sjm (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-sjm-write01';
insert into sjm (label, id) select 'other', id from private.mcp_credentials where token_hash = 'hash-sjm-other01';

create or replace function pg_temp.as_mcp(p_user text, p_label text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid(p_user);
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id(p_label))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text, text) to authenticated, service_role;

-- Turn Jev on in auto at 85%, from no row at all.
select pg_temp.as_mcp('sjm_owner', 'write');
select is((public.mcp_set_jev_mode('sjm-1', true, 'auto', 0.85)->'data') - 'id',
  '{"enabled": true, "mode": "auto", "threshold": 0.85, "prior": null, "undo_kind": "jev_mode"}'::jsonb,
  'set_jev_mode stores auto and the threshold, with no row before');
select is(public.mcp_set_jev_mode('sjm-1', true, 'auto', 0.85)->'data'->>'mode', 'auto', 'the same key replays');
select is(public.mcp_set_jev_mode('sjm-1', true, 'shadow', 0.85)->'error'->>'code', 'conflict',
  'the same key with other input is a conflict');
select is(public.mcp_set_jev_mode('sjm-2', true, 'live', null)->'error'->>'code', 'validation', 'an unknown mode is refused');
select is(public.mcp_set_jev_mode('sjm-3', true, 'auto', 0.49)->'error'->>'code', 'validation', 'a threshold below 0.50 is refused');
select is(public.mcp_set_jev_mode('sjm-4', null, 'auto', null)->'error'->>'code', 'validation', 'the switch is required');

-- Undo of the first write removes the row it created.
select is(public.mcp_undo('sjm-u1', 'jev_mode', pg_temp.id('co'))->>'ok', 'true', 'undo takes the first write back');
reset role;
select is((select count(*)::integer from public.company_integrations where company_id = pg_temp.id('co')), 0,
  'and leaves no row, as before');

-- A second write keeps what was before; undo puts it back while it still stands.
select pg_temp.as_mcp('sjm_owner', 'write');
select public.mcp_set_jev_mode('sjm-5', true, 'shadow', 0.90);
select is(public.mcp_set_jev_mode('sjm-6', true, 'auto', null)->'data'->'prior',
  '{"enabled": true, "mode": "shadow", "threshold": 0.90}'::jsonb, 'the reply names the values before');
select is(public.mcp_undo('sjm-u6', 'jev_mode', pg_temp.id('co'))->>'ok', 'true', 'undo puts shadow back');
reset role;
select is((select mode from public.company_integrations where company_id = pg_temp.id('co')), 'shadow',
  'mode is shadow again');

-- Changed since: a conflict, and nothing moves.
select pg_temp.as_mcp('sjm_owner', 'write');
select public.mcp_set_jev_mode('sjm-7', true, 'auto', 0.95);
reset role;
update public.company_integrations set threshold = 0.80 where company_id = pg_temp.id('co');
select pg_temp.as_mcp('sjm_owner', 'write');
select is(public.mcp_undo('sjm-u7', 'jev_mode', pg_temp.id('co'))->'error'->>'code', 'conflict',
  'a setting changed since the write is not undone');
reset role;
select is((select threshold from public.company_integrations where company_id = pg_temp.id('co')), 0.80::numeric,
  'and the newer threshold stays');

-- A read token cannot write; another company's undo does not reach this company.
select public.store_mcp_credential(tests.get_supabase_uid('sjm_owner'), 'hash-sjm-read001', array['read'],
  now() + interval '90 days', 'pepper-1');
insert into sjm (label, id) select 'read', id from private.mcp_credentials where token_hash = 'hash-sjm-read001';
select pg_temp.as_mcp('sjm_owner', 'read');
select is(public.mcp_set_jev_mode('sjm-8', false, null, null)->'error'->>'code', 'forbidden', 'a read token cannot write');
select pg_temp.as_mcp('sjm_other', 'other');
select is(public.mcp_undo('sjm-u9', 'jev_mode', pg_temp.id('co'))->'error'->>'code', 'not_found',
  'another company cannot undo this company''s write');
reset role;
select is((select mode from public.company_integrations where company_id = pg_temp.id('other_co')), 'shadow',
  'and its own row is unchanged');

select * from finish();
rollback;
