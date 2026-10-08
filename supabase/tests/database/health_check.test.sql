-- private.health (FLOW-802, decision 0151): each check raises its alert with a count, a healthy
-- state is ok, alerts carry no company ids, and only the service role may call it. Invented data.

begin;

select plan(22);

do $users$
begin
  perform tests.create_supabase_user('hc_owner', 'hc-owner@example.com');
  perform tests.create_supabase_user('hc_other', 'hc-other@example.com');
end
$users$;

create temp table hc (label text primary key, id uuid);
insert into hc (label, id) values
  ('a', tests.fixture_company('hc_owner', 'Example Health LLC')),
  ('b', tests.fixture_company('hc_other', 'Example Other Health LLC'));

create or replace function pg_temp.hc_id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.hc where label = p_label; $$;

grant all on hc to service_role;
grant execute on function pg_temp.hc_id(text) to service_role;

-- The count of one check's alert, 0 when it is not raised.
create or replace function pg_temp.alert(p_check text)
returns integer
language sql
as $$
  select coalesce((
    select (a->>'count')::integer
    from jsonb_array_elements(private.health()->'alerts') a
    where a->>'check' = p_check
  ), 0);
$$;

-- Start from a clean slate: the seed data may hold connections and cron runs.
delete from public.connector_refresh_requests;
delete from public.connector_connections;
delete from private.mcp_sync_jobs;
delete from public.jev_usage;
delete from public.company_integrations;
delete from cron.job_run_details;

insert into public.connector_connections (
  company_id, provider, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
  kek_ref, kek_version, envelope_version, last_sync_at
)
select pg_temp.hc_id(l), 'sumit', '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea,
  'SUMIT_KEK', '1', '1', now() - interval '1 hour'
from unnest(array['a', 'b']) l;

select is((private.health()->>'ok')::boolean, true, 'a healthy state is ok with no alerts');

-- Refresh queue: waiting too long for the drain, or claimed and never finished.
insert into public.connector_refresh_requests (company_id, provider, requested_at)
values (pg_temp.hc_id('a'), 'sumit', now() - interval '3 hours');
select is(pg_temp.alert('refresh_unclaimed'), 1, 'a request unclaimed for 3 hours is stuck');
update public.connector_connections set last_error = 'auth' where company_id = pg_temp.hc_id('a');
select is(pg_temp.alert('refresh_unclaimed'), 0, 'not while its connection waits on a new key (that is a sync error)');
update public.connector_connections set last_error = null where company_id = pg_temp.hc_id('a');
delete from public.connector_refresh_requests;

-- A sync that claimed and finished leaves its request claimed; only a claim left on the
-- connection means a sync died.
insert into public.connector_refresh_requests (company_id, provider, requested_at)
values (pg_temp.hc_id('a'), 'sumit', now() - interval '3 hours');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select count(*)::integer from public.claim_connector_refreshes(20, 'sumit')), 1, 'the drain claims the request');
do $$ begin perform public.stamp_connector_sync(pg_temp.hc_id('a'), 'sumit'); end $$;
reset role;
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select is(private.health(now() + interval '3 hours')->'alerts' @> '[{"check": "refresh_claimed"}]', false,
  'a finished sync is not stuck, though its request stays claimed');
delete from public.connector_refresh_requests;
update public.connector_connections set sync_claimed_at = now() - interval '2 hours' where company_id = pg_temp.hc_id('a');
select is(pg_temp.alert('refresh_claimed'), 1, 'a sync claim 2 hours old is a sync that died');
update public.connector_connections set sync_claimed_at = null;

-- Syncs.
update public.connector_connections set last_sync_at = now() - interval '2 days' where company_id = pg_temp.hc_id('b');
select is(pg_temp.alert('sync_stale'), 1, 'a connection with no sync in 2 days is stale');
update public.connector_connections set last_sync_at = now(), last_error = 'timeout' where company_id = pg_temp.hc_id('b');
select is(pg_temp.alert('sync_error'), 1, 'a connection whose last sync failed is an error');
update public.connector_connections set last_error = 'sync_sweep_empty' where company_id = pg_temp.hc_id('b');
select is(pg_temp.alert('sync_error'), 0, 'a sweep note on a syncing connection is not a failure');
update public.connector_connections set last_error = null, reject_attempts = 3 where company_id = pg_temp.hc_id('b');
select is(pg_temp.alert('sync_error'), 1, 'so is one rejected 3 times');
update public.connector_connections set reject_attempts = 0;

-- MCP sync_bank jobs.
do $$
begin
  perform public.store_mcp_credential(tests.get_supabase_uid('hc_owner'), 'hash-hc-write001', array['read','write'],
    now() + interval '90 days', 'pepper-1');
end
$$;
insert into private.mcp_sync_jobs (token_id, user_id, company_id, state, started_at)
select id, tests.get_supabase_uid('hc_owner'), pg_temp.hc_id('a'), 'running', now() - interval '1 hour'
from private.mcp_credentials where token_hash = 'hash-hc-write001';
select is(pg_temp.alert('mcp_sync_stuck'), 1, 'an MCP sync job running for an hour is stuck');
select is(private.health(now() + interval '2 days')->'alerts' @> '[{"check": "mcp_sync_stuck"}]', false,
  'it alerts for one day, not every day after');
delete from private.mcp_sync_jobs;

-- Jev calls near the daily cap.
insert into public.company_integrations (company_id, provider, enabled, mode, threshold, daily_call_cap)
values (pg_temp.hc_id('a'), 'jev', true, 'shadow', 0.9, 5);
insert into public.jev_usage (company_id, run_id, usage_day, reserved, calls, started_at, finished_at)
values (pg_temp.hc_id('a'), gen_random_uuid(), (now() at time zone 'utc')::date, 3, 3, now(), now());
select is(pg_temp.alert('jev_cap'), 0, '3 of 5 calls is under 80%');
insert into public.jev_usage (company_id, run_id, usage_day, reserved, calls, started_at, finished_at)
values (pg_temp.hc_id('a'), gen_random_uuid(), (now() at time zone 'utc')::date, 1, 1, now(), now());
select is(pg_temp.alert('jev_cap'), 1, '4 of 5 calls is at 80%');
select is((private.health()->>'ok')::boolean, true, 'a Jev cap warning alone leaves the check ok');
delete from public.jev_usage;

-- Cron: a Flow job whose last run is old is late; a failed run in the last day is a failure.
do $$ begin perform cron.schedule('flow-health-test', '0 3 * * *', 'select 1'); end $$;
insert into cron.job_run_details (jobid, runid, status, start_time, end_time)
select jobid, 900001, 'succeeded', now() - interval '30 hours', now() - interval '30 hours'
from cron.job where jobname = 'flow-health-test';
select is(pg_temp.alert('cron_late'), 1, 'a daily job last run 30 hours ago is late');
insert into cron.job_run_details (jobid, runid, status, start_time, end_time)
select jobid, 900002, 'failed', now() - interval '1 hour', now() - interval '1 hour'
from cron.job where jobname = 'flow-health-test';
select is(pg_temp.alert('cron_failed'), 1, 'a failed run in the last day is a failure');
select is(pg_temp.alert('cron_late'), 0, 'and the job is no longer late');

select is((private.health()->>'ok')::boolean, false, 'any alert makes the check not ok');
select ok(position(pg_temp.hc_id('a')::text in private.health()::text) = 0,
  'alerts carry no company id');

set local role service_role;
select lives_ok($$select private.health()$$, 'the service role can run the check');
reset role;

select tests.authenticate_as('hc_owner');
select throws_ok($$select private.health()$$, '42501', null, 'a signed-in user cannot run the check');

select * from finish();
rollback;
