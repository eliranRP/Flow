-- FLOW-202: sync_bank jobs. begin starts a job, finish validates and stores it,
-- mcp_sync_status reads it. Decision 0102. Emails use @example.com.

begin;

select plan(31);

do $users$
begin
  perform tests.create_supabase_user('sj_owner', 'sj-owner@example.com');
  perform tests.create_supabase_user('sj_other', 'sj-other@example.com');
end
$users$;

create temp table sj (label text primary key, id uuid);
grant all on sj to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text, p_user text default 'sj_owner')
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid(p_user);
  select id into tid from pg_temp.sj where label = p_label;
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
  select id from pg_temp.sj where label = p_label;
$$;
grant execute on function pg_temp.job(text) to authenticated, service_role;

select tests.authenticate_as('sj_owner');
select lives_ok($$select public.create_company('Sync Co', true)$$, 'owner creates a company');
insert into sj (label, id) select 'company', id from public.companies where name = 'Sync Co';

select tests.authenticate_as('sj_other');
select lives_ok($$select public.create_company('Sync Other Co', true)$$, 'other creates a company');
insert into sj (label, id) select 'other_company', id from public.companies where name = 'Sync Other Co';

reset role;

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('sj_owner'), c.id, 'hash-sj-write-01', 'pepper-1', array['read','write'], now() + interval '90 days'
from sj c where c.label = 'company';
insert into sj (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-sj-write-01';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('sj_owner'), c.id, 'hash-sj-write-02', 'pepper-1', array['write'], now() + interval '90 days'
from sj c where c.label = 'company';
insert into sj (label, id) select 'write2', id from private.mcp_credentials where token_hash = 'hash-sj-write-02';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('sj_owner'), c.id, 'hash-sj-read-001', 'pepper-1', array['read'], now() + interval '90 days'
from sj c where c.label = 'company';
insert into sj (label, id) select 'read', id from private.mcp_credentials where token_hash = 'hash-sj-read-001';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('sj_other'), c.id, 'hash-sj-other-01', 'pepper-1', array['read','write'], now() + interval '90 days'
from sj c where c.label = 'other_company';
insert into sj (label, id) select 'other_write', id from private.mcp_credentials where token_hash = 'hash-sj-other-01';

-- No bank connection: no job.
select pg_temp.as_mcp('write');
select is(
  public.mcp_sync_bank_begin('job-none')->'error'->>'code',
  'not_found',
  'begin without a connection is not_found'
);
reset role;
select is((select count(*)::int from private.mcp_sync_jobs), 0, 'no job without a connection');

insert into public.connector_connections (
  company_id, provider,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
  kek_ref, kek_version, envelope_version
)
select c.id, 'mercury', '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea,
  'MERCURY_KEK', '1', '1'
from sj c where c.label = 'company';

-- Begin starts a running job; the same key is the same job.
select pg_temp.as_mcp('write');
insert into sj (label, id)
select 'j1', (public.mcp_sync_bank_begin('job-1')->'data'->>'job_id')::uuid;
select isnt(pg_temp.job('j1'), null, 'begin returns a job id');
select is(
  public.mcp_sync_bank_begin('job-1')->'data',
  jsonb_build_object('state', 'replay', 'job_id', pg_temp.job('j1')),
  'the same key replays the same job'
);
select is(
  public.mcp_sync_status(pg_temp.job('j1'))->'data'->>'state',
  'running',
  'a new job is running'
);
reset role;
select is(
  (select count(*)::int from private.mcp_sync_jobs where token_id = pg_temp.job('write')),
  1,
  'the replay did not start a second job'
);

-- A key used by another tool is a conflict.
select pg_temp.as_mcp('write');
select lives_ok($$select public.mcp_create_project('job-shared', 'Delta Site', 'active')$$, 'another write takes a key');
select is(
  public.mcp_sync_bank_begin('job-shared')->'error'->>'code',
  'conflict',
  'sync with that key is a conflict'
);

-- The finish step stores a valid result.
select is(
  public.mcp_sync_bank_finish(
    pg_temp.job('j1'),
    '{"ok": true, "data": {"added": 3, "duplicates": 2, "removed": 1, "newest_date": "2026-09-15"}}'::jsonb
  )->'data'->>'state',
  'done',
  'a valid result is done'
);
select is(
  (public.mcp_sync_status(pg_temp.job('j1'))->'data') - 'started_at' - 'finished_at',
  jsonb_build_object(
    'job_id', pg_temp.job('j1'), 'state', 'done',
    'added', 3, 'duplicates', 2, 'removed', 1, 'newest_date', '2026-09-15'
  ),
  'status reports added, duplicates, removed, and newest_date'
);
select is(
  public.mcp_sync_bank_finish(pg_temp.job('j1'), '{"ok": false, "error": {"code": "refused", "message": "x"}}'::jsonb)->'error'->>'code',
  'not_found',
  'a finished job cannot be finished again'
);
select is(
  public.mcp_sync_status(pg_temp.job('j1'))->'data'->>'state',
  'done',
  'the second finish changed nothing'
);

-- The finish step checks the shape before it stores.
insert into sj (label, id) select 'j2', (public.mcp_sync_bank_begin('job-2')->'data'->>'job_id')::uuid;
insert into sj (label, id) select 'j3', (public.mcp_sync_bank_begin('job-3')->'data'->>'job_id')::uuid;
insert into sj (label, id) select 'j4', (public.mcp_sync_bank_begin('job-4')->'data'->>'job_id')::uuid;
insert into sj (label, id) select 'j5', (public.mcp_sync_bank_begin('job-5')->'data'->>'job_id')::uuid;
insert into sj (label, id) select 'j6', (public.mcp_sync_bank_begin('job-6')->'data'->>'job_id')::uuid;
select public.mcp_sync_bank_finish(
  pg_temp.job('j2'),
  '{"ok": true, "data": {"added": -1, "duplicates": 0, "removed": 0, "newest_date": null}}'::jsonb
);
select public.mcp_sync_bank_finish(
  pg_temp.job('j3'),
  '{"ok": true, "data": {"added": 1, "duplicates": 0, "removed": 0, "newest_date": null, "secret": "x"}}'::jsonb
);
select public.mcp_sync_bank_finish(
  pg_temp.job('j4'),
  '{"ok": true, "data": {"added": 1, "duplicates": 0, "removed": 0, "newest_date": "15/09/2026"}}'::jsonb
);
select public.mcp_sync_bank_finish(
  pg_temp.job('j5'),
  '{"ok": false, "error": {"code": "unavailable", "message": "retry"}}'::jsonb
);
select public.mcp_sync_bank_finish(
  pg_temp.job('j6'),
  '{"ok": false, "error": {"code": "teapot", "message": "retry"}}'::jsonb
);
select is(
  public.mcp_sync_status(pg_temp.job('j2'))->'data'->'error',
  '{"code": "refused", "message": "The bank sync failed."}'::jsonb,
  'a negative count is stored as the generic failure'
);
select is(
  public.mcp_sync_status(pg_temp.job('j3'))->'data'->'error',
  '{"code": "refused", "message": "The bank sync failed."}'::jsonb,
  'an extra field is stored as the generic failure'
);
select is(
  public.mcp_sync_status(pg_temp.job('j4'))->'data'->'error',
  '{"code": "refused", "message": "The bank sync failed."}'::jsonb,
  'a bad date is stored as the generic failure'
);
select is(
  public.mcp_sync_status(pg_temp.job('j5'))->'data',
  jsonb_build_object(
    'job_id', pg_temp.job('j5'), 'state', 'failed',
    'started_at', public.mcp_sync_status(pg_temp.job('j5'))->'data'->'started_at',
    'finished_at', public.mcp_sync_status(pg_temp.job('j5'))->'data'->'finished_at',
    'error', '{"code": "unavailable", "message": "retry"}'::jsonb
  ),
  'a known failure is stored as sent'
);
select is(
  public.mcp_sync_status(pg_temp.job('j6'))->'data'->'error'->>'code',
  'refused',
  'an unknown error code is stored as the generic failure'
);
insert into sj (label, id) select 'k1', (public.mcp_sync_bank_begin('job-k1')->'data'->>'job_id')::uuid;
insert into sj (label, id) select 'k2', (public.mcp_sync_bank_begin('job-k2')->'data'->>'job_id')::uuid;
insert into sj (label, id) select 'k3', (public.mcp_sync_bank_begin('job-k3')->'data'->>'job_id')::uuid;
insert into sj (label, id) select 'k4', (public.mcp_sync_bank_begin('job-k4')->'data'->>'job_id')::uuid;
select public.mcp_sync_bank_finish(
  pg_temp.job('k1'),
  '{"ok": true, "data": {"added": "3", "duplicates": 0, "removed": 0, "newest_date": null}}'::jsonb
);
select public.mcp_sync_bank_finish(
  pg_temp.job('k2'),
  '{"ok": true, "data": {"added": 1, "duplicates": 0, "removed": 0, "newest_date": "2026-02-30"}}'::jsonb
);
select public.mcp_sync_bank_finish(pg_temp.job('k3'), '{"ok": false, "error": {"code": "refused", "message": ""}}'::jsonb);
select public.mcp_sync_bank_finish(
  pg_temp.job('k4'),
  jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'refused', 'message', repeat('x', 201)))
);
select is(
  public.mcp_sync_status(pg_temp.job('k1'))->'data'->'error'->>'message',
  'The bank sync failed.',
  'a string count is stored as the generic failure'
);
select is(
  public.mcp_sync_status(pg_temp.job('k2'))->'data'->'error'->>'message',
  'The bank sync failed.',
  'an impossible date is stored as the generic failure'
);
select is(
  public.mcp_sync_status(pg_temp.job('k3'))->'data'->'error'->>'message',
  'The bank sync failed.',
  'an empty message is stored as the generic failure'
);
select is(
  public.mcp_sync_status(pg_temp.job('k4'))->'data'->'error'->>'message',
  'The bank sync failed.',
  'a message over 200 characters is stored as the generic failure'
);
select is(
  public.mcp_sync_bank_finish(null, '{}'::jsonb)->'error'->>'code',
  'validation',
  'finish needs a job id'
);

-- Another token of the same user can read the job but not finish it.
insert into sj (label, id) select 'j7', (public.mcp_sync_bank_begin('job-7')->'data'->>'job_id')::uuid;
select pg_temp.as_mcp('write2');
select is(
  public.mcp_sync_bank_finish(pg_temp.job('j7'), '{"ok": false, "error": {"code": "refused", "message": "x"}}'::jsonb)->'error'->>'code',
  'not_found',
  'another token cannot finish the job'
);
select is(
  public.mcp_sync_status(pg_temp.job('j7'))->'data'->>'state',
  'running',
  'a write-only token of the same user reads the job'
);
select pg_temp.as_mcp('read');
select is(
  public.mcp_sync_bank_begin('job-read')->'error'->>'code',
  'forbidden',
  'a read token cannot start a sync'
);

-- Another company's user cannot see the job.
select pg_temp.as_mcp('other_write', 'sj_other');
select is(
  public.mcp_sync_status(pg_temp.job('j1'))->'error'->>'code',
  'not_found',
  'another company''s user cannot read the job'
);

-- A running job past the stale window reads as failed with retry.
reset role;
update private.mcp_sync_jobs set started_at = now() - interval '10 minutes' where id = pg_temp.job('j7');
select pg_temp.as_mcp('write');
select is(
  public.mcp_sync_status(pg_temp.job('j7'))->'data'->'error',
  '{"code": "unavailable", "message": "retry"}'::jsonb,
  'a stale running job reads as retry'
);
select is(
  public.mcp_sync_bank_finish(
    pg_temp.job('j7'),
    '{"ok": true, "data": {"added": 1, "duplicates": 0, "removed": 0, "newest_date": null}}'::jsonb
  )->'error'->>'code',
  'not_found',
  'a stale job cannot be finished, so a retry answer never turns into done'
);

-- PostgREST roles cannot touch the table.
select throws_ok(
  $$select count(*) from private.mcp_sync_jobs$$,
  '42501',
  null,
  'authenticated cannot read the jobs table'
);

select * from finish();

rollback;
