-- FLOW-1163 (decision 0266): a refresh request's moves (claim, requeue, finish, lapse) through
-- claim_connector_refreshes, settle_connector_refresh and list_due_refresh_requests; `forced` reaches
-- the drain; the lapse uses the claim window (private.sync_claim_window); an auth stop survives note_connector_failure and note_connector_rejection until a
-- reconnect (replace_connector_connection). Invented names and @example.com emails only.

begin;

select plan(26);

do $users$
begin
  perform tests.create_supabase_user('rq_owner', 'rq-owner@example.com');
end
$users$;

create temp table rq (label text primary key, id uuid);
create function pg_temp.rq_id(p_label text) returns uuid language sql as $$ select id from pg_temp.rq where label = p_label; $$;

insert into rq (label, id) values ('a', tests.fixture_company('rq_owner', 'Example Queue Books'));

insert into public.connector_connections (
  company_id, provider, slot, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_ref, kek_version, envelope_version,
  accounts_chosen_at
) values
  (pg_temp.rq_id('a'), 'mercury', 1, '\x01', '\x0201', '\x03', '\x0401', 'MERCURY_KEK', '1', '3', pg_catalog.now()),
  (pg_temp.rq_id('a'), 'sumit', 1, '\x01', '\x0201', '\x03', '\x0401', 'SUMIT_KEK', '2', '2', null);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- claim: `forced` comes back with the request, from both overloads.
insert into public.connector_refresh_requests (company_id, provider, forced)
values (pg_temp.rq_id('a'), 'mercury', true), (pg_temp.rq_id('a'), 'sumit', false);

create temp table claimed_m as
select c.* from public.claim_connector_refreshes(20, 'mercury') c where c.company_id = pg_temp.rq_id('a');
select is((select count(*)::integer from claimed_m), 1, 'the Mercury claim takes the company''s request');
select is((select forced from claimed_m), true, 'and returns it forced');

create temp table claimed_s as
select c.* from public.claim_connector_refreshes(20) c where c.company_id = pg_temp.rq_id('a');
select is((select string_agg(provider::text || ':' || forced::text, ',') from claimed_s), 'sumit:false',
  'the one-argument claim returns the unforced SUMIT request');

-- finish: the run synced or skipped for good; the row goes.
select is(public.settle_connector_refresh((select id from claimed_s), false), 'finished', 'a finished request settles');
select is((select count(*)::integer from public.connector_refresh_requests where id = (select id from claimed_s)), 0,
  'and its row is deleted');
select is(public.settle_connector_refresh((select id from claimed_s), false), 'gone', 'a request settled already is gone');

-- requeue: the run threw; the request is queued again, still forced.
select is(public.settle_connector_refresh((select id from claimed_m), true), 'queued', 'a thrown run requeues its request');
select is(
  (select claimed_at is null and forced from public.connector_refresh_requests where id = (select id from claimed_m)),
  true,
  'which is open again and keeps forced');
select is(public.settle_connector_refresh((select id from claimed_m), true), 'gone', 'an open request is not settled');

-- requeue while another request was queued meanwhile: the two merge.
update public.connector_connections set sync_claimed_at = null where company_id = pg_temp.rq_id('a');
create temp table claimed_m2 as
select c.* from public.claim_connector_refreshes(20, 'mercury') c where c.company_id = pg_temp.rq_id('a');
select is((select id from claimed_m2), (select id from claimed_m), 'the requeued request is claimed again');
insert into public.connector_refresh_requests (company_id, provider, forced, requested_at)
values (pg_temp.rq_id('a'), 'mercury', false, pg_catalog.now() + interval '1 minute');
select is(public.settle_connector_refresh((select id from claimed_m2), true), 'queued', 'a requeue beside a queued request');
select is(
  (select count(*)::integer || ':' || bool_and(forced)::text || ':' || (min(requested_at) <= pg_catalog.now())::text
   from public.connector_refresh_requests
   where company_id = pg_temp.rq_id('a') and provider = 'mercury'),
  '1:true:true',
  'merges into it: one request, forced, from the earlier time');

-- list_due_refresh_requests (SUMIT's drain) returns `forced`.
insert into public.connector_refresh_requests (company_id, provider, forced)
values (pg_temp.rq_id('a'), 'sumit', true);
select is(
  (select forced from public.list_due_refresh_requests(20) d where d.company_id = pg_temp.rq_id('a')),
  true,
  'SUMIT''s list returns the request forced');

-- lapse: a request claimed longer than the window is deleted by the next claim.
update public.connector_connections set sync_claimed_at = null where company_id = pg_temp.rq_id('a');
create temp table claimed_s2 as
select c.* from public.claim_connector_refreshes(20, 'sumit') c where c.company_id = pg_temp.rq_id('a');
select is((select count(*)::integer from claimed_s2), 1, 'the SUMIT request is claimed');
update public.connector_refresh_requests
set claimed_at = pg_catalog.now() - interval '11 minutes'
where id = (select id from claimed_s2);
select is((select count(*)::integer from public.claim_connector_refreshes(20, 'mercury') c where c.company_id = pg_temp.rq_id('a')), 1,
  'a later claim runs');
select is((select count(*)::integer from public.connector_refresh_requests where id = (select id from claimed_s2)), 0,
  'and deletes the request whose run never settled it');

-- An auth stop stays until a reconnect.
select is(
  (select last_error from public.connector_connections where company_id = pg_temp.rq_id('a') and provider = 'sumit'),
  null,
  'the SUMIT connection starts healthy');
select ok(public.note_connector_failure(pg_temp.rq_id('a'), 'sumit', 'transient') is not null, 'a transient failure waits');
select ok(public.note_connector_failure(pg_temp.rq_id('a'), 'mercury', 'auth', 1::smallint) is null, 'Mercury slot 1 stops on auth');
select ok(public.note_connector_failure(pg_temp.rq_id('a'), 'mercury', 'transient', 1::smallint) is not null,
  'a transient failure follows');
select is(
  (select coalesce(last_error, 'ok') || ':' || (next_attempt_at is null)::text
   from public.connector_connections where company_id = pg_temp.rq_id('a') and provider = 'mercury' and slot = 1),
  'auth:true',
  'the auth stop stays, with no retry time');
select lives_ok(format($$select public.note_connector_failure(%L, 'sumit', 'auth')$$, pg_temp.rq_id('a')), 'SUMIT stops on auth');
select is(public.note_connector_rejection(pg_temp.rq_id('a'), 'sumit', 'rejected')->>'code', 'rejected',
  'a rejection follows');
select is(
  (select last_error || ':' || (next_attempt_at is null)::text
   from public.connector_connections where company_id = pg_temp.rq_id('a') and provider = 'sumit'),
  'auth:true',
  'and the auth stop stays too');
select lives_ok(
  format($$select public.replace_connector_connection(%L, 'mercury', '0a', '0b', '0c', '0d', '1', '3', true, '{}'::jsonb, 1::smallint)$$, pg_temp.rq_id('a')),
  'the owner reconnects slot 1');
select is(
  (select coalesce(last_error, 'ok') from public.connector_connections where company_id = pg_temp.rq_id('a') and provider = 'mercury' and slot = 1),
  'ok',
  'and the reconnect clears the stop');

select * from finish();

rollback;
