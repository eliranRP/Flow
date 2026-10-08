-- FLOW-207. mcp_sync_bank_finish stores only the fixed failure pairs flow-mcp sends, and
-- mcp_sync_bank_begin drops the user's old jobs. Emails use @example.com.

begin;

select plan(14);

do $users$
begin
  perform tests.create_supabase_user('sjf_owner', 'sjf-owner@example.com');
  perform tests.create_supabase_user('sjf_other', 'sjf-other@example.com');
end
$users$;

create temp table sjf (label text primary key, id uuid);
grant all on sjf to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text, p_user text default 'sjf_owner')
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid(p_user);
  select id into tid from pg_temp.sjf where label = p_label;
  if uid is null or tid is null then
    raise exception 'missing mcp actor %', p_label;
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', uid,
      'role', 'authenticated',
      'aal', 'aal1',
      'mcp_tid', tid
    )::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp(text, text) to authenticated, service_role;

create or replace function pg_temp.job(p_label text)
returns uuid
language sql
set search_path = ''
as $$
  select id from pg_temp.sjf where label = p_label;
$$;
grant execute on function pg_temp.job(text) to authenticated, service_role;

select tests.authenticate_as('sjf_owner');
select lives_ok($$select public.create_company('Sync Retention Co', true)$$, 'owner creates a company');
insert into sjf (label, id) select 'company', id from public.companies where name = 'Sync Retention Co';

select tests.authenticate_as('sjf_other');
select lives_ok($$select public.create_company('Sync Retention Other Co', true)$$, 'other creates a company');
insert into sjf (label, id) select 'other_company', id from public.companies where name = 'Sync Retention Other Co';

reset role;

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('sjf_owner'), c.id, 'hash-sjf-write-01', 'pepper-1', array['read','write'], now() + interval '90 days'
from sjf c where c.label = 'company';
insert into sjf (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-sjf-write-01';


-- The other user has a credential too, for the retention scope check.
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('sjf_other'), c.id, 'hash-sjf-other-01', 'pepper-1', array['write'], now() + interval '90 days'
from sjf c where c.label = 'other_company';
insert into sjf (label, id) select 'other_write', id from private.mcp_credentials where token_hash = 'hash-sjf-other-01';

insert into public.connector_connections (
  company_id, provider,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
  kek_ref, kek_version, envelope_version
)
select c.id, 'mercury', '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea,
  'MERCURY_KEK', '1', '1'
from sjf c where c.label = 'company';

-- 1. Only the fixed failure pairs flow-mcp sends are stored as given.
select pg_temp.as_mcp('write');
insert into sjf (label, id) select 'f1', (public.mcp_sync_bank_begin('f-1')->'data'->>'job_id')::uuid;
insert into sjf (label, id) select 'f2', (public.mcp_sync_bank_begin('f-2')->'data'->>'job_id')::uuid;
insert into sjf (label, id) select 'f3', (public.mcp_sync_bank_begin('f-3')->'data'->>'job_id')::uuid;
insert into sjf (label, id) select 'f4', (public.mcp_sync_bank_begin('f-4')->'data'->>'job_id')::uuid;
insert into sjf (label, id) select 'f5', (public.mcp_sync_bank_begin('f-5')->'data'->>'job_id')::uuid;
select public.mcp_sync_bank_finish(pg_temp.job('f1'),
  '{"ok": false, "error": {"code": "refused", "message": "Call 555-0100 to fix your bank"}}'::jsonb);
select public.mcp_sync_bank_finish(pg_temp.job('f2'),
  '{"ok": false, "error": {"code": "not_found", "message": "bank is not connected"}}'::jsonb);
select public.mcp_sync_bank_finish(pg_temp.job('f3'),
  '{"ok": false, "error": {"code": "refused", "message": "bank key was rejected; reconnect in Settings"}}'::jsonb);
select public.mcp_sync_bank_finish(pg_temp.job('f4'),
  '{"ok": false, "error": {"code": "not_found", "message": "retry"}}'::jsonb);
select public.mcp_sync_bank_finish(pg_temp.job('f5'),
  '{"ok": false, "error": {"code": "unavailable", "message": "unavailable"}}'::jsonb);
select is(public.mcp_sync_status(pg_temp.job('f1'))->'data'->'error',
  '{"code": "refused", "message": "The bank sync failed."}'::jsonb, 'free text is stored as the generic failure');
select is(public.mcp_sync_status(pg_temp.job('f2'))->'data'->'error',
  '{"code": "not_found", "message": "bank is not connected"}'::jsonb, 'a fixed pair is stored as sent');
select is(public.mcp_sync_status(pg_temp.job('f3'))->'data'->'error'->>'message',
  'bank key was rejected; reconnect in Settings', 'the reconnect message is stored as sent');
select is(public.mcp_sync_status(pg_temp.job('f4'))->'data'->'error',
  '{"code": "refused", "message": "The bank sync failed."}'::jsonb, 'a known message under another code is the generic failure');
select is(public.mcp_sync_status(pg_temp.job('f5'))->'data'->'error',
  '{"code": "unavailable", "message": "unavailable"}'::jsonb, 'the unavailable pair is stored as sent');

-- 2. Retention: begin drops this user's old jobs only.
reset role;
insert into private.mcp_sync_jobs (id, token_id, user_id, company_id, state, result, started_at, finished_at)
values
  ('00000000-0000-4000-8000-0000000000a1', pg_temp.job('write'), tests.get_supabase_uid('sjf_owner'), pg_temp.job('company'),
   'done', '{"added": 0, "duplicates": 0, "removed": 0, "newest_date": null}', now() - interval '9 days', now() - interval '8 days'),
  ('00000000-0000-4000-8000-0000000000a2', pg_temp.job('write'), tests.get_supabase_uid('sjf_owner'), pg_temp.job('company'),
   'done', '{"added": 0, "duplicates": 0, "removed": 0, "newest_date": null}', now() - interval '3 days', now() - interval '3 days'),
  ('00000000-0000-4000-8000-0000000000a4', pg_temp.job('other_write'), tests.get_supabase_uid('sjf_other'), pg_temp.job('other_company'),
   'done', '{"added": 0, "duplicates": 0, "removed": 0, "newest_date": null}', now() - interval '9 days', now() - interval '8 days');
insert into private.mcp_sync_jobs (id, token_id, user_id, company_id, state, started_at)
values
  ('00000000-0000-4000-8000-0000000000a3', pg_temp.job('write'), tests.get_supabase_uid('sjf_owner'), pg_temp.job('company'),
   'running', now() - interval '2 days'),
  ('00000000-0000-4000-8000-0000000000a5', pg_temp.job('write'), tests.get_supabase_uid('sjf_owner'), pg_temp.job('company'),
   'running', now() - interval '2 hours');
insert into private.mcp_sync_jobs (token_id, user_id, company_id, state, error, started_at, finished_at)
values (pg_temp.job('write'), tests.get_supabase_uid('sjf_owner'), pg_temp.job('company'),
  'failed', '{"code": "unavailable", "message": "retry"}', now() - interval '30 days', now() - interval '30 days');

select pg_temp.as_mcp('write');
select is(public.mcp_sync_bank_begin('f-new')->>'ok', 'true', 'a new job starts');
reset role;
select is(
  (select count(*)::integer from private.mcp_sync_jobs
   where id in ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a3')),
  0, 'a job finished 8 days ago and one stuck running for 2 days are dropped');
select is(
  (select count(*)::integer from private.mcp_sync_jobs
   where user_id = tests.get_supabase_uid('sjf_owner') and finished_at < now() - interval '7 days'),
  0, 'an old failed job is dropped too');
select is(
  (select count(*)::integer from private.mcp_sync_jobs where id = '00000000-0000-4000-8000-0000000000a2'),
  1, 'a job finished 3 days ago stays');
select is(
  (select count(*)::integer from private.mcp_sync_jobs where id = '00000000-0000-4000-8000-0000000000a4'),
  1, 'another user''s old job stays');
select is(
  (select count(*)::integer from private.mcp_sync_jobs where id = '00000000-0000-4000-8000-0000000000a5'),
  1, 'a job running for 2 hours stays');
select is(
  (select count(*)::integer from private.mcp_sync_jobs where id = pg_temp.job('f1')),
  1, 'this run''s finished jobs stay');

select * from finish();
rollback;
