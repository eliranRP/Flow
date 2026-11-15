-- FLOW-1163 leftovers (20261115180000_connector_leftovers.sql):
-- 1. replace_connector_connection resets the cursor and the account choice in the same statement as
--    the new key, so a failing store leaves the old connection whole;
-- 2. the three readers of the claim window (connector_connection_status, sumit_status,
--    private.mcp_bank_connection_json) read private.sync_claim_window();
-- 3. note_connector_rejection is gone;
-- 4. an auth stop clears only on a reconnect: a stamp, a SUMIT failure note and a SUMIT rejection keep it.
-- Invented names and @example.com emails only.

begin;

select plan(49);

do $users$
begin
  perform tests.create_supabase_user('lo_owner', 'lo-owner@example.com');
end
$users$;

create temp table lo (label text primary key, id uuid);
create function pg_temp.lo_id(p_label text) returns uuid language sql as $$ select id from pg_temp.lo where label = p_label; $$;
insert into lo (label, id) values ('a', tests.fixture_company('lo_owner', 'Example Leftover Books'));

-- Mercury: slot 1 holds the old key (bytes 01..), a cursor, the owner's choice; slot 2 is another connection.
insert into public.connector_connections (
  company_id, provider, slot, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_ref, kek_version, envelope_version,
  sync_cursor, accounts_chosen_at, sync_account_ids, skip_account_ids, account_from
) values
  (pg_temp.lo_id('a'), 'mercury', 1, '\x01', '\x0201', '\x03', '\x0401', 'MERCURY_KEK', '1', '3',
   'cursor-1', '2026-01-01T00:00:00Z', array['acc-a', 'acc-b'], array['acc-c'], '{"acc-a":"2026-02-01"}'),
  (pg_temp.lo_id('a'), 'mercury', 2, '\x01', '\x0201', '\x03', '\x0401', 'MERCURY_KEK', '1', '3',
   'cursor-2', '2026-01-01T00:00:00Z', array['acc-z'], '{}', '{}');

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create function pg_temp.slot1() returns text language sql as $$
  select concat_ws('|', encode(key_ciphertext, 'hex'), coalesce(sync_cursor, '~'), coalesce(accounts_chosen_at::text, '~'),
    coalesce(array_to_string(sync_account_ids, ','), '~'), array_to_string(skip_account_ids, ','), account_from::text)
  from public.connector_connections where company_id = pg_temp.lo_id('a') and provider = 'mercury' and slot = 1;
$$;
create function pg_temp.slot2() returns text language sql as $$
  select concat_ws('|', sync_cursor, accounts_chosen_at::text, array_to_string(sync_account_ids, ','))
  from public.connector_connections where company_id = pg_temp.lo_id('a') and provider = 'mercury' and slot = 2;
$$;
create temp table before1 as select pg_temp.slot1() as v;
create temp table before2 as select pg_temp.slot2() as v;

-- 1. A failing store leaves the old connection whole.
select throws_ok(
  format($$select public.replace_connector_connection(%L, 'mercury', 'zz', '0b', '0c', '0d', '1', '3', true, '{}'::jsonb, 1::smallint, true)$$, pg_temp.lo_id('a')),
  null, null, 'a key that cannot be stored fails the reset call');
select is(pg_temp.slot1(), (select v from before1), 'and the old key, cursor and account choice are untouched');
select throws_ok(
  format($$select public.replace_connector_connection(%L, 'mercury', '0a', '0b', '0c', '0d', '1', '3', false, '{}'::jsonb, 1::smallint, true)$$, pg_temp.lo_id('a')),
  'validation failed', 'a key that was not validated fails the reset call');
select throws_ok(
  format($$select public.replace_connector_connection(%L, 'mercury', '0a', '0b', '0c', '0d', '1', '1', true, '{}'::jsonb, 1::smallint, true)$$, pg_temp.lo_id('a')),
  'envelope format is not accepted', 'and so does an envelope format that is not accepted');
select is(pg_temp.slot1(), (select v from before1), 'both leave the old connection as it was');

-- Without a reset the call is the old one: the cursor and the choice stay with the new key.
select lives_ok(
  format($$select public.replace_connector_connection(%L, 'mercury', '0a', '0b', '0c', '0d', '1', '3', true, '{}'::jsonb, 1::smallint)$$, pg_temp.lo_id('a')),
  'a call without the reset arguments (the deployed edge function) stores the key');
select is(pg_temp.slot1(), '0a|cursor-1|2026-01-01 00:00:00+00|acc-a,acc-b|acc-c|{"acc-a": "2026-02-01"}',
  'and keeps the cursor and the choices as before');

-- Reset with no kept choices: the cursor and every choice go, with the key swap.
select lives_ok(
  format($$select public.replace_connector_connection(%L, 'mercury', '1a', '1b', '1c', '1d', '1', '3', true, '{}'::jsonb, 1::smallint, true)$$, pg_temp.lo_id('a')),
  'a reset stores the new key');
select is(pg_temp.slot1(), '1a|~|~|~||{}', 'and clears the cursor and the account choice in the same call');
select is(pg_temp.slot2(), (select v from before2), 'while the other slot is untouched');

-- Reset with kept choices: the cursor goes, the owner's kept choices stay (the key lists some of the accounts).
update public.connector_connections
set sync_cursor = 'cursor-1', accounts_chosen_at = '2026-01-01T00:00:00Z',
    sync_account_ids = array['acc-a', 'acc-b'], skip_account_ids = array['acc-c'], account_from = '{"acc-a":"2026-02-01","acc-b":"2026-03-01"}'
where company_id = pg_temp.lo_id('a') and provider = 'mercury' and slot = 1;
select lives_ok(
  format($$select public.replace_connector_connection(%L, 'mercury', '2a', '2b', '2c', '2d', '1', '3', true, '{}'::jsonb, 1::smallint, true,
    '{"sync_account_ids":["acc-a"],"skip_account_ids":[],"account_from":{"acc-a":"2026-02-01"}}'::jsonb)$$, pg_temp.lo_id('a')),
  'a reset with kept choices stores the new key');
select is(pg_temp.slot1(), '2a|~|2026-01-01 00:00:00+00|acc-a||{"acc-a": "2026-02-01"}',
  'the cursor is gone, and the choice is the kept one');
select lives_ok(
  format($$select public.replace_connector_connection(%L, 'mercury', '3a', '3b', '3c', '3d', '1', '3', true, '{}'::jsonb, 1::smallint, true,
    '{"sync_account_ids":null,"skip_account_ids":["acc-c"],"account_from":{}}'::jsonb)$$, pg_temp.lo_id('a')),
  'kept choices with no synced list (every account) store as well');
select is(pg_temp.slot1(), '3a|~|2026-01-01 00:00:00+00|~|acc-c|{}', 'and keep that null list');
select is(
  (select last_error is null and reject_attempts = 0 and next_attempt_at is null and last_sync_at is null
   from public.connector_connections where company_id = pg_temp.lo_id('a') and provider = 'mercury' and slot = 1),
  true, 'a reset reconnects as a replacement does');

select ok(
  has_function_privilege('service_role', 'public.replace_connector_connection(uuid,public.connector_provider,text,text,text,text,text,text,boolean,jsonb,smallint,boolean,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.replace_connector_connection(uuid,public.connector_provider,text,text,text,text,text,text,boolean,jsonb,smallint,boolean,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.replace_connector_connection(uuid,public.connector_provider,text,text,text,text,text,text,boolean,jsonb,smallint,boolean,jsonb)', 'execute'),
  'only the service role calls the new signature');
select hasnt_function('public', 'replace_connector_connection',
  array['uuid', 'connector_provider', 'text', 'text', 'text', 'text', 'text', 'text', 'boolean', 'jsonb', 'smallint'],
  'and the old signature is gone, so a call without the reset arguments is not ambiguous');

-- 3. note_connector_rejection is gone.
select hasnt_function('public', 'note_connector_rejection', 'note_connector_rejection has no caller and is dropped');

-- 2. The three readers of the claim window read the one private function.
insert into public.connector_connections (
  company_id, provider, slot, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_ref, kek_version, envelope_version, settings
) values (pg_temp.lo_id('a'), 'sumit', 1, '\x01', '\x0201', '\x03', '\x0401', 'SUMIT_KEK', '2', '2', '{"sumit_company_id":"4242"}');

create function pg_temp.set_claim(p_age interval) returns void language sql as $$
  update public.connector_connections set sync_claimed_at = pg_catalog.now() - p_age
  where company_id = pg_temp.lo_id('a') and ((provider = 'mercury' and slot = 1) or provider = 'sumit');
$$;
-- The three answers, in one string: the view, sumit_status() and the MCP bank JSON.
create function pg_temp.syncing() returns text language plpgsql as $$
declare
  v boolean;
  s boolean;
  m boolean;
begin
  reset role;
  select (private.mcp_bank_connection_json(c)->>'syncing')::boolean into m
  from public.connector_connections c where c.company_id = pg_temp.lo_id('a') and c.provider = 'mercury' and c.slot = 1;
  perform tests.authenticate_as('lo_owner');
  select syncing into v from public.connector_connection_status where provider = 'mercury' and slot = 1;
  select (public.sumit_status()->>'syncing')::boolean into s;
  reset role;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return v::text || ',' || s::text || ',' || m::text;
end;
$$;

select is(private.sync_claim_window(), interval '10 minutes', 'the window is 10 minutes');
select pg_temp.set_claim(interval '9 minutes');
select is(pg_temp.syncing(), 'true,true,true', 'a claim 9 minutes old reads as syncing in all three');
select pg_temp.set_claim(interval '11 minutes');
select is(pg_temp.syncing(), 'false,false,false', 'a claim 11 minutes old does not');

-- Change the one function (rolled back with the test): all three follow it.
create or replace function private.sync_claim_window()
returns interval language sql immutable set search_path = '' as $$ select interval '3 minutes' $$;
select pg_temp.set_claim(interval '2 minutes');
select is(pg_temp.syncing(), 'true,true,true', 'with a 3-minute window a claim 2 minutes old reads as syncing in all three');
select pg_temp.set_claim(interval '4 minutes');
select is(pg_temp.syncing(), 'false,false,false', 'and one 4 minutes old does not: the three read the function');
create or replace function private.sync_claim_window()
returns interval language sql immutable set search_path = '' as $$ select interval '10 minutes' $$;
select pg_temp.set_claim(interval '9 minutes');
select is(pg_temp.syncing(), 'true,true,true', 'restored, a claim 9 minutes old reads as syncing again');

select is(
  (select reloptions::text from pg_class where oid = 'public.connector_connection_status'::regclass),
  '{security_invoker=true}', 'the view is still read as the client');
select ok(
  has_table_privilege('authenticated', 'public.connector_connection_status', 'select')
    and not has_table_privilege('anon', 'public.connector_connection_status', 'select'),
  'and keeps its table privileges');
select ok(
  not has_function_privilege('anon', 'private.sync_claim_window()', 'execute')
    and has_function_privilege('authenticated', 'private.sync_claim_window()', 'execute'),
  'the window function is a constant the client may read, not anon');
select is(
  (select count(*)::integer from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and p.proname in ('sumit_status', 'mcp_bank_connection_json', 'claim_connector_refreshes')
     and p.prosrc ~ '10 minutes'),
  0, 'no function of the three claims keeps the literal');

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- 4. Mercury: a stamp that lands after the stop keeps it.
update public.connector_connections set sync_claimed_at = pg_catalog.now(), last_error = null, last_sync_at = null
where company_id = pg_temp.lo_id('a') and provider = 'mercury';
select ok(public.note_connector_failure(pg_temp.lo_id('a'), 'mercury', 'auth', 1::smallint) is null, 'a run finds slot 1''s key bad: auth stop');
select lives_ok(format($$select public.stamp_connector_sync(%L, 'mercury', 1::smallint)$$, pg_temp.lo_id('a')),
  'a run that started before the stop finishes and stamps');
select is(
  (select last_error || ':' || (last_sync_at is not null)::text || ':' || (sync_claimed_at is null)::text || ':' || (next_attempt_at is null)::text
   from public.connector_connections where company_id = pg_temp.lo_id('a') and provider = 'mercury' and slot = 1),
  'auth:true:true:true', 'the stamp keeps the auth stop (and still stamps the time and frees the claim)');

-- A stamp for every slot (the old schema) keeps the stop on the stopped slot and clears the other's passing error.
update public.connector_connections set last_error = 'transient', next_attempt_at = pg_catalog.now() + interval '15 minutes'
where company_id = pg_temp.lo_id('a') and provider = 'mercury' and slot = 2;
select lives_ok(format($$select public.stamp_connector_sync(%L, 'mercury')$$, pg_temp.lo_id('a')), 'a stamp without a slot');
select is(
  (select string_agg(slot::text || '=' || coalesce(last_error, 'ok'), ',' order by slot)
   from public.connector_connections where company_id = pg_temp.lo_id('a') and provider = 'mercury'),
  '1=auth,2=ok', 'keeps slot 1''s stop and clears slot 2''s passing error');
update public.connector_connections set last_error = 'sync_sweep_empty' where company_id = pg_temp.lo_id('a') and provider = 'mercury' and slot = 2;
select lives_ok(format($$select public.stamp_connector_sync(%L, 'mercury', 2::smallint)$$, pg_temp.lo_id('a')), 'a stamp on a sweep stop');
select is(
  (select last_error from public.connector_connections where company_id = pg_temp.lo_id('a') and provider = 'mercury' and slot = 2),
  'sync_sweep_empty', 'still keeps that stop');
select lives_ok(
  format($$select public.replace_connector_connection(%L, 'mercury', '4a', '4b', '4c', '4d', '1', '3', true, '{}'::jsonb, 1::smallint)$$, pg_temp.lo_id('a')),
  'the owner reconnects slot 1');
select is(
  (select coalesce(last_error, 'ok') from public.connector_connections where company_id = pg_temp.lo_id('a') and provider = 'mercury' and slot = 1),
  'ok', 'and the reconnect clears the stop');

-- 4. SUMIT: a failure note, a rejection and a stamp keep a stop.
select lives_ok(format($$select public.note_sumit_rejection(%L, 'sumit_auth')$$, pg_temp.lo_id('a')), 'SUMIT stops on auth');
select ok(public.note_sync_failure(pg_temp.lo_id('a'), 'sync_failed') is not null, 'a failed run after the stop is noted');
select is(
  (select last_error || ':' || (next_attempt_at is null)::text
   from public.connector_connections where company_id = pg_temp.lo_id('a') and provider = 'sumit'),
  'auth:true', 'and the stop stays, with no retry time');
select lives_ok(format($$select public.note_sumit_rejection(%L, 'sumit_rejected')$$, pg_temp.lo_id('a')), 'a rejection after the stop');
select lives_ok(format($$select public.stamp_sumit_sync(%L)$$, pg_temp.lo_id('a')), 'and a stamp');
select is(
  (select last_error || ':' || (next_attempt_at is null)::text || ':' || (last_sync_at is not null)::text
   from public.connector_connections where company_id = pg_temp.lo_id('a') and provider = 'sumit'),
  'auth:true:true', 'leave it too');
select lives_ok(
  format($$select public.replace_sumit_connection(%L, 4242, '5a', '5b', '5c', '5d', '2', '2', true)$$, pg_temp.lo_id('a')),
  'the owner reconnects SUMIT');
select is(
  (select coalesce(last_error, 'ok') from public.connector_connections where company_id = pg_temp.lo_id('a') and provider = 'sumit'),
  'ok', 'and the reconnect clears the stop');
-- Without a stop the notes and the stamp behave as before.
select ok(public.note_sync_failure(pg_temp.lo_id('a'), 'sync_page_cap') is not null, 'a failure without a stop');
select is(
  (select last_error || ':' || (next_attempt_at is not null)::text from public.connector_connections where company_id = pg_temp.lo_id('a') and provider = 'sumit'),
  'sync_page_cap:true', 'is stored with its retry time');
select lives_ok(format($$select public.stamp_sumit_sync(%L)$$, pg_temp.lo_id('a')), 'a sync that succeeds');
select is(
  (select coalesce(last_error, 'ok') || ':' || (next_attempt_at is null)::text from public.connector_connections where company_id = pg_temp.lo_id('a') and provider = 'sumit'),
  'ok:true', 'clears the passing error');

select * from finish();

rollback;
