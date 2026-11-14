-- FLOW-1168 (decision 0266): the server jobs' end states. A Jev line refused as invalid waits until
-- it or its company's projects and categories change; a new-lines, weekly or test push claim and an
-- invite email claim can be given back, a bounded number of times, when nothing was sent; a name the thread purge cannot remove leaves its list for a day; a
-- sync_bank job stores an incomplete pull and why a pull did not run, and its own token finishes it
-- after a revoke. Invented names and @example.com emails only.

begin;

select plan(84);

do $users$
begin
  perform tests.create_supabase_user('je_owner', 'je-owner@example.com');
  perform tests.create_supabase_user('je_other', 'je-other@example.com');
end
$users$;

create temp table je (label text primary key, id uuid);
grant all on je to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql as $$ select id from pg_temp.je where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;
grant execute on function pg_temp.as_service() to authenticated, service_role;

create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;
grant execute on function pg_temp.as_postgres() to authenticated, service_role;

insert into je (label, id) values
  ('co', tests.fixture_company('je_owner', 'Example Jobs Works')),
  ('other_co', tests.fixture_company('je_other', 'Example Other Jobs'));
insert into je (label, id) values
  ('line', tests.fixture_line(pg_temp.id('co'), 'je:line', 4200, p_source => 'sumit', p_doc_date => '2026-11-01')),
  ('line2', tests.fixture_line(pg_temp.id('co'), 'je:line2', 5100, p_source => 'sumit', p_doc_date => '2026-11-02'));
-- Both lines wait in לאישור with no suggestion.
insert into public.review_queue (company_id, transaction_id, status)
select pg_temp.id('co'), id, 'open' from je where label in ('line', 'line2');

-- ---------------------------------------------------------------------------------------------
-- A. Jev: a refused line
-- ---------------------------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.jev_mark_failed(uuid, uuid, text, boolean)', 'execute')
  and has_function_privilege('service_role', 'public.jev_mark_failed(uuid, uuid, text, boolean)', 'execute'),
  'only the service role marks a Jev failure'
);

select pg_temp.as_service();
select lives_ok(
  $$select public.jev_mark_failed(pg_temp.id('co'), pg_temp.id('line'), 'jev-1.13.0', true)$$,
  'the job marks a line Jev refused'
);
select lives_ok(
  $$select public.jev_mark_failed(pg_temp.id('co'), pg_temp.id('line2'), 'jev-1.13.0')$$,
  'the three-argument call still marks a failure that can pass'
);
select pg_temp.as_postgres();

select is(
  (select (refused_at = now(), retry_after = now() + interval '30 days', attempts)::text
   from public.jev_line_failures where transaction_id = pg_temp.id('line')),
  '(t,t,1)',
  'a refused line waits 30 days'
);
select is(
  (select (refused_at is null, retry_after = now() + interval '6 hours')::text
   from public.jev_line_failures where transaction_id = pg_temp.id('line2')),
  '(t,t)',
  'a failure that can pass waits 6 hours, as before'
);
select throws_ok(
  $$update public.jev_line_failures set retry_after = now() + interval '1 hour' where transaction_id = pg_temp.id('line')$$,
  '23514', null,
  'a refusal is always the 30-day wait (jev_line_failures_refused_chk)'
);

select tests.authenticate_as('je_owner');
select is(
  (select (d->>'lines_not_retried', d->>'lines_without_suggestion')::text
   from (select public.mcp_jev_status() d) s),
  '(1,2)',
  'get_jev_status counts the refused line, and keeps it in lines_without_suggestion'
);
reset role;

-- A write that does not change the request keeps the refusal.
update public.transactions set user_assigned = false where id = pg_temp.id('line');
select is((select count(*)::int from public.jev_line_failures where transaction_id = pg_temp.id('line')), 1,
  'a write to a column the request is not built from keeps the refusal');

-- A changed description is a new request: the refusal goes, a failure that can pass stays.
update public.transactions set description = 'je:line edited' where id in (pg_temp.id('line'), pg_temp.id('line2'));
select is((select count(*)::int from public.jev_line_failures where transaction_id = pg_temp.id('line')), 0,
  'a line whose description changes is asked again');
select is((select count(*)::int from public.jev_line_failures where transaction_id = pg_temp.id('line2')), 1,
  'a failure that can pass keeps its own wait');

-- Each column the request is built from brings the line back.
select pg_temp.as_service();
select public.jev_mark_failed(pg_temp.id('co'), pg_temp.id('line'), 'jev-1.13.0', true);
select pg_temp.as_postgres();
update public.transactions set provider_meta = provider_meta || '{"card_last4": "4242"}' where id = pg_temp.id('line');
select is((select count(*)::int from public.jev_line_failures where transaction_id = pg_temp.id('line')), 0,
  'a new card or account on the line asks again');

-- A refusal then a failure that can pass is a failure that can pass.
select pg_temp.as_service();
select public.jev_mark_failed(pg_temp.id('co'), pg_temp.id('line'), 'jev-1.13.0', true);
select public.jev_mark_failed(pg_temp.id('co'), pg_temp.id('line'), 'jev-1.13.0', false);
select pg_temp.as_postgres();
select is(
  (select (refused_at is null, attempts)::text from public.jev_line_failures where transaction_id = pg_temp.id('line')),
  '(t,2)',
  'a later failure that can pass clears the refusal'
);

-- FLOW-1174: a refusal holds only while the company's projects and categories are as the refused
-- request had them: a change there can be what made Jev refuse it.
delete from public.company_integrations where provider = 'jev';
insert into public.company_integrations (company_id, provider, enabled, mode, threshold)
values (pg_temp.id('co'), 'jev', true, 'shadow', 0.9);
insert into je (label, id) values ('cat', tests.fixture_category(pg_temp.id('co'), 'Example Repairs'));
select pg_temp.as_service();
select public.jev_mark_failed(pg_temp.id('co'), pg_temp.id('line'), 'jev-1.13.0', true);
select public.jev_mark_failed(pg_temp.id('co'), pg_temp.id('line2'), 'jev-1.13.0', true);
select pg_temp.as_postgres();
select is(
  (select count(*)::int from public.jev_line_failures
   where company_id = pg_temp.id('co') and refused_inputs = private.jev_inputs_key(pg_temp.id('co'))),
  2,
  'a refusal records the projects and categories its request was built from'
);
select throws_ok(
  $$update public.jev_line_failures set refused_inputs = null where transaction_id = pg_temp.id('line')$$,
  '23514', null,
  'a refusal always names its inputs (jev_line_failures_refused_chk)'
);
select ok(not private.jev_has_work(), 'both open lines refused: no work');
update public.categories set sort_order = sort_order + 100 where id = pg_temp.id('cat');
select ok(not private.jev_has_work(), 'a category write the request does not read keeps the refusals');
update public.categories set name = 'Example Repairs and Upkeep' where id = pg_temp.id('cat');
select ok(private.jev_has_work(), 'a renamed category makes the refused lines work again');
select tests.authenticate_as('je_owner');
select is((public.mcp_jev_status()->>'lines_not_retried')::int, 0, 'get_jev_status no longer counts them as not retried');
reset role;
select pg_temp.as_service();
select is(public.jev_refusals_reset(pg_temp.id('co')), 2, 'the run clears the refusals the change made stale');
select is(public.jev_refusals_reset(pg_temp.id('co')), 0, 'and only those');
select public.jev_mark_failed(pg_temp.id('co'), pg_temp.id('line'), 'jev-1.13.0', true);
select pg_temp.as_postgres();
select is(
  (select refused_inputs = private.jev_inputs_key(pg_temp.id('co')) from public.jev_line_failures where transaction_id = pg_temp.id('line')),
  true,
  'a line refused again records the new inputs'
);
select pg_temp.as_service();
select is(public.jev_refusals_reset(pg_temp.id('co')), 0, 'a refusal under the current inputs stays');
select pg_temp.as_postgres();
select tests.fixture_project(pg_temp.id('co'), 'Example Street 9');
select is(
  (select refused_inputs = private.jev_inputs_key(pg_temp.id('co')) from public.jev_line_failures where transaction_id = pg_temp.id('line')),
  false,
  'a new project makes it stale too'
);

-- ---------------------------------------------------------------------------------------------
-- B. Push claims
-- ---------------------------------------------------------------------------------------------

-- Israel time from a setting, so the weekly gate can be read at a chosen hour.
create or replace function private.israel_now()
returns timestamp without time zone
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('test.israel_now', true), '')::timestamp,
    pg_catalog.now() at time zone 'Asia/Jerusalem');
$$;

select tests.authenticate_as('je_owner');
do $sub$ begin
  perform public.push_subscribe('https://fcm.googleapis.com/fcm/send/je-1', repeat('A', 87), repeat('A', 22));
  perform public.set_notification_prefs(p_new_transaction => true, p_evening_reminder => false, p_weekly_summary => true);
end $sub$;
reset role;
update public.notification_prefs set new_line_mark = now() - interval '1 hour', weekly_sent_on = '2026-11-01'
where user_id = tests.get_supabase_uid('je_owner');

select pg_temp.as_service();
create temp table claimed as select * from public.push_claim_targets('new');
grant all on claimed to service_role;
select is(
  (select (claim->>'prev')::timestamptz from claimed),
  now() - interval '1 hour',
  'a new-lines claim names the mark it moved from'
);
select pg_temp.as_postgres();
select is((select count(*)::int from private.push_new_due_users()), 0, 'once claimed, the user is not due');
select pg_temp.as_service();
select is(
  public.push_release_claims('new', (select jsonb_agg(jsonb_build_object('user_id', user_id, 'claim', claim)) from claimed)),
  1,
  'a claim no device took is given back'
);
select pg_temp.as_postgres();
select is((select count(*)::int from private.push_new_due_users()), 1, 'so the next run sends it');
select pg_temp.as_service();
select is(
  public.push_release_claims('new', (select jsonb_agg(jsonb_build_object('user_id', user_id, 'claim', claim)) from claimed)),
  0,
  'a claim is given back once'
);
-- A claim made since is not undone by an older release.
truncate claimed;
insert into claimed select * from public.push_claim_targets('new');
select is(
  public.push_release_claims('new', jsonb_build_array(jsonb_build_object(
    'user_id', tests.get_supabase_uid('je_owner'),
    'claim', jsonb_build_object('mark', now() - interval '2 hours', 'prev', null)))),
  0,
  'a release names the mark its own claim set'
);
select is(
  public.push_release_claims('new', jsonb_build_array(jsonb_build_object(
    'user_id', tests.get_supabase_uid('je_owner'),
    'claim', jsonb_build_object('mark', (select claim->'mark' from claimed), 'prev', now())))),
  0,
  'a release never moves the mark forward'
);
-- FLOW-1174: a send whose answer was lost may have reached the device, so the same lines are given
-- back at most twice: they go out at most three times, and the device's tag replaces the copy.
select is(
  public.push_release_claims('new', (select jsonb_agg(jsonb_build_object('user_id', user_id, 'claim', claim)) from claimed)),
  1,
  'the same lines are given back a second time'
);
truncate claimed;
insert into claimed select * from public.push_claim_targets('new');
select is(
  public.push_release_claims('new', (select jsonb_agg(jsonb_build_object('user_id', user_id, 'claim', claim)) from claimed)),
  0,
  'never a third time: the claim is kept'
);
select pg_temp.as_postgres();
select is(
  (select (new_line_mark = (select (claim->>'mark')::timestamptz from claimed), new_releases)::text
   from public.notification_prefs where user_id = tests.get_supabase_uid('je_owner')),
  '(t,2)',
  'the mark stays where the kept claim set it'
);
select throws_ok(
  $$update public.notification_prefs set new_releases = 3 where user_id = tests.get_supabase_uid('je_owner')$$,
  '23514', null,
  'at most two releases per mark (notification_prefs_new_releases_chk)'
);
-- Lines claimed from another mark get their own two.
update public.notification_prefs set new_line_mark = now() - interval '30 minutes'
where user_id = tests.get_supabase_uid('je_owner');
select pg_temp.as_service();
truncate claimed;
insert into claimed select * from public.push_claim_targets('new');
select is(
  public.push_release_claims('new', (select jsonb_agg(jsonb_build_object('user_id', user_id, 'claim', claim)) from claimed)),
  1,
  'a claim from a new mark can be given back again'
);
select throws_ok($$select public.push_release_claims('evening', '[]')$$, '22023', null, 'only new and weekly claims are given back');

-- Weekly: given back, tried again until noon that Sunday, then claimed again.
select set_config('test.israel_now', '2026-11-15 08:10', true);
select pg_temp.as_postgres();
select is(private.push_weekly_due(), true, 'the weekly gate opens at 08:00 on Sunday');
select pg_temp.as_service();
truncate claimed;
insert into claimed select * from public.push_claim_targets('weekly');
select is((select claim from claimed), '{"day": "2026-11-15", "prev": "2026-11-01"}'::jsonb, 'a weekly claim names its day and the one before');
select set_config('test.israel_now', '2026-11-15 09:00', true);
select pg_temp.as_postgres();
select is(private.push_weekly_due(), false, 'after 08:59 nothing claimed is tried again');
select pg_temp.as_service();
select is(
  public.push_release_claims('weekly', (select jsonb_agg(jsonb_build_object('user_id', user_id, 'claim', claim)) from claimed)),
  1,
  'a weekly claim no device took is given back'
);
select is(
  (select (weekly_sent_on, weekly_released_on)::text from public.notification_prefs where user_id = tests.get_supabase_uid('je_owner')),
  '(2026-11-01,2026-11-15)',
  'the summary is unsent again and marked given back today'
);
select pg_temp.as_postgres();
select is(private.push_weekly_due(), true, 'the 09:00 gate tries it again');
select set_config('test.israel_now', '2026-11-15 12:00', true);
select is(private.push_weekly_due(), false, 'not after 11:59');
select pg_temp.as_service();
select set_config('test.israel_now', '2026-11-15 10:00', true);
truncate claimed;
insert into claimed select * from public.push_claim_targets('weekly');
select is(
  (select (weekly_sent_on, weekly_released_on is null)::text from public.notification_prefs where user_id = tests.get_supabase_uid('je_owner')),
  '(2026-11-15,t)',
  'the next claim clears the given-back day'
);
select pg_temp.as_postgres();
select throws_ok(
  $$update public.notification_prefs set weekly_released_on = weekly_sent_on where user_id = tests.get_supabase_uid('je_owner')$$,
  '23514', null,
  'a day is never both sent and given back (notification_prefs_weekly_released_chk)'
);

-- The test push: the claim names its row; giving it back frees one of the 5 an hour.
select tests.authenticate_as('je_owner');
create temp table test_claims (claim jsonb);
grant all on test_claims to authenticated, service_role;
insert into test_claims select public.claim_push_test() from generate_series(1, 5);
select throws_ok($$select public.claim_push_test()$$, '23514', 'push_test_limit', 'five test claims an hour');
select throws_ok($$select public.release_push_test(tests.get_supabase_uid('je_owner'), 1)$$, '42501', null,
  'a user cannot give a test claim back');
select pg_temp.as_service();
select is(
  public.release_push_test(tests.get_supabase_uid('je_owner'), (select (claim->>'claim')::bigint from test_claims limit 1)),
  true,
  'push-send gives back a test claim no device took'
);
select is(
  public.release_push_test(tests.get_supabase_uid('je_other'), (select (claim->>'claim')::bigint from test_claims offset 1 limit 1)),
  false,
  'a claim is given back only for its own user'
);
select tests.authenticate_as('je_owner');
select is((public.claim_push_test()->>'devices')::int, 1, 'so the user can test again');

-- ---------------------------------------------------------------------------------------------
-- C. Invite email
-- ---------------------------------------------------------------------------------------------

select tests.authenticate_as('je_owner');
insert into je (label, id) select 'invite', (public.invite_member('je-invitee@example.com', 'viewer')->>'id')::uuid;
select is((public.claim_invite_email(pg_temp.id('invite'))->>'email_sends')::int, 1, 'the first email is claimed');
select throws_ok($$select public.release_invite_email(pg_temp.id('invite'), 1)$$, '42501', null,
  'a user cannot give an email claim back');
select pg_temp.as_service();
select is(public.release_invite_email(pg_temp.id('invite'), 2), false, 'only the latest claim is given back');
select is(public.release_invite_email(pg_temp.id('invite'), 1), true, 'a send Resend refused gives its claim back');
select pg_temp.as_postgres();
select is(
  (select (email_sends, emailed_at is null)::text from public.company_invites where id = pg_temp.id('invite')),
  '(0,t)',
  'no email counted, none recorded'
);
select tests.authenticate_as('je_owner');
select is(
  (select array_agg((public.claim_invite_email(pg_temp.id('invite'))->>'email_sends')::int) from generate_series(1, 3)),
  array[1, 2, 3],
  'three emails can still be claimed'
);
select throws_ok($$select public.claim_invite_email(pg_temp.id('invite'))$$, '23514', 'invite_email_limit',
  'and never a fourth');
-- FLOW-1174: an invite gives back at most 3 claims, so Resend hears at most 6 tries for it (3 sends
-- and 3 refused), however often an owner's client asks.
select pg_temp.as_service();
select is(public.release_invite_email(pg_temp.id('invite'), 3), true, 'a second refused send is given back');
select tests.authenticate_as('je_owner');
select is((public.claim_invite_email(pg_temp.id('invite'))->>'email_sends')::int, 3, 'and claimed again');
select pg_temp.as_service();
select is(public.release_invite_email(pg_temp.id('invite'), 3), true, 'a third refused send is given back');
select tests.authenticate_as('je_owner');
select is((public.claim_invite_email(pg_temp.id('invite'))->>'email_sends')::int, 3, 'and claimed again');
select pg_temp.as_service();
select is(public.release_invite_email(pg_temp.id('invite'), 3), false, 'never a fourth release');
select pg_temp.as_postgres();
select is(
  (select (email_sends, email_releases)::text from public.company_invites where id = pg_temp.id('invite')),
  '(3,3)',
  'three sends kept, three given back'
);
select throws_ok(
  $$update public.company_invites set email_releases = 4 where id = pg_temp.id('invite')$$,
  '23514', null,
  'at most three releases (company_invites_email_releases_chk)'
);
select pg_temp.as_postgres();
select throws_ok(
  $$update public.company_invites set emailed_at = null where id = pg_temp.id('invite')$$,
  '23514', null,
  'a counted email has its time (company_invites_emailed_chk)'
);

-- ---------------------------------------------------------------------------------------------
-- D. Thread purge
-- ---------------------------------------------------------------------------------------------

create function pg_temp.path(p_name text) returns text language sql stable as $$
  -- A deleted company's folder: listed at once, whatever its age.
  select '0a1b2c3d-0000-4000-8000-00000000dead/' || pg_temp.id('line')::text || '/' || p_name;
$$;
grant execute on function pg_temp.path(text) to service_role;
insert into storage.objects (bucket_id, name, created_at) values
  ('transaction-files', pg_temp.path('stuck.jpg'), now() - interval '3 days'),
  ('transaction-files', pg_temp.path('next.jpg'), now() - interval '2 days');

select pg_temp.as_service();
select is(public.thread_files_to_purge(10), jsonb_build_array(pg_temp.path('stuck.jpg'), pg_temp.path('next.jpg')),
  'the purge lists both orphans, oldest first');
select is(public.thread_files_purge_skip(jsonb_build_array(pg_temp.path('stuck.jpg'), 7)), 1,
  'the purge records the name it could not remove (and nothing that is not a name)');
select is(public.thread_files_to_purge(1), jsonb_build_array(pg_temp.path('next.jpg')),
  'so the list moves past it');
select pg_temp.as_postgres();
update private.thread_purge_skips set skipped_at = skipped_at - interval '25 hours', retry_at = retry_at - interval '25 hours';
select pg_temp.as_service();
select is(public.thread_files_to_purge(1), jsonb_build_array(pg_temp.path('stuck.jpg')),
  'a day later it is listed again');
select public.thread_files_purge_skip(jsonb_build_array(pg_temp.path('stuck.jpg')));
select pg_temp.as_postgres();
update storage.objects set created_at = now() + interval '1 second' where name = pg_temp.path('stuck.jpg');
select pg_temp.as_service();
select is(public.thread_files_to_purge(10), jsonb_build_array(pg_temp.path('next.jpg'), pg_temp.path('stuck.jpg')),
  'an object uploaded again since its skip is listed again');
-- FLOW-1174: a name Storage kept (the reason is not said, it may pass) waits an hour, not a day.
select is(public.thread_files_purge_skip(jsonb_build_array(pg_temp.path('next.jpg')), false), 1,
  'the purge records a name Storage kept');
select is(public.thread_files_to_purge(10), jsonb_build_array(pg_temp.path('stuck.jpg')), 'so the list moves past it');
select pg_temp.as_postgres();
select is(
  (select retry_at - skipped_at from private.thread_purge_skips where name = pg_temp.path('next.jpg')),
  interval '1 hour',
  'for an hour'
);
select throws_ok(
  $$update private.thread_purge_skips set retry_at = skipped_at + interval '2 days'$$,
  '23514', null,
  'a skip waits an hour or a day (thread_purge_skips_wait_chk)'
);
update private.thread_purge_skips set skipped_at = skipped_at - interval '61 minutes', retry_at = retry_at - interval '61 minutes'
where name = pg_temp.path('next.jpg');
select pg_temp.as_service();
select is(public.thread_files_to_purge(10), jsonb_build_array(pg_temp.path('next.jpg'), pg_temp.path('stuck.jpg')),
  'an hour later it is listed again');
select pg_temp.as_postgres();
select ok(
  not has_function_privilege('authenticated', 'public.thread_files_purge_skip(jsonb, boolean)', 'execute'),
  'no client records a purge skip'
);

-- ---------------------------------------------------------------------------------------------
-- E. sync_bank jobs
-- ---------------------------------------------------------------------------------------------

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('je_owner'), pg_temp.id('co'), 'hash-je-write-01', 'pepper-1', array['read', 'write'], now() + interval '90 days'),
  (tests.get_supabase_uid('je_owner'), pg_temp.id('co'), 'hash-je-write-02', 'pepper-1', array['read', 'write'], now() + interval '90 days');
insert into je (label, id) select 'token', id from private.mcp_credentials where token_hash = 'hash-je-write-01';
insert into je (label, id) select 'token2', id from private.mcp_credentials where token_hash = 'hash-je-write-02';
insert into je (label, id)
select 'job' || n, gen_random_uuid() from generate_series(1, 5) n;
insert into private.mcp_sync_jobs (id, token_id, user_id, company_id)
select id, pg_temp.id('token'), tests.get_supabase_uid('je_owner'), pg_temp.id('co') from je where label like 'job%';

create function pg_temp.as_mcp(p_token text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', tests.get_supabase_uid('je_owner')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', tests.get_supabase_uid('je_owner'), 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id(p_token))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

select pg_temp.as_mcp('token');
select public.mcp_sync_bank_finish(pg_temp.id('job1'), '{"ok": true, "complete": false,
  "data": {"added": 3, "duplicates": 0, "removed": 0, "newest_date": "2026-11-12"}}');
select is(
  (public.mcp_sync_status(pg_temp.id('job1'))->'data') - 'started_at' - 'finished_at' - 'job_id',
  '{"state": "done", "added": 3, "duplicates": 0, "removed": 0, "newest_date": "2026-11-12", "complete": false}'::jsonb,
  'a page-capped pull is done and says it is not complete'
);
select public.mcp_sync_bank_finish(pg_temp.id('job2'), '{"ok": true,
  "data": {"added": 0, "duplicates": 1, "removed": 0, "newest_date": null}}');
select is(
  (public.mcp_sync_status(pg_temp.id('job2'))->'data') ? 'complete',
  false,
  'a finish that does not say leaves complete out, as before'
);
select public.mcp_sync_bank_finish(pg_temp.id('job3'), '{"ok": false,
  "error": {"code": "unavailable", "message": "retry", "reason": "rate_limited", "retry_at": "2026-11-13T18:00:00Z"}}');
select is(
  public.mcp_sync_status(pg_temp.id('job3'))->'data'->'error',
  jsonb_build_object('code', 'unavailable', 'message', 'retry', 'reason', 'rate_limited',
    'retry_at', '2026-11-13T18:00:00Z'::timestamptz),
  'a rate limited pull says so, and until when'
);
select public.mcp_sync_bank_finish(pg_temp.id('job4'), '{"ok": false,
  "error": {"code": "refused", "message": "The bank sync failed.", "reason": "busy"}}');
select is(
  public.mcp_sync_status(pg_temp.id('job4'))->'data'->'error',
  '{"code": "refused", "message": "The bank sync failed."}'::jsonb,
  'a reason is stored only beside a retry'
);
-- The token is revoked while the pull runs: it still records the end; another token cannot.
select pg_temp.as_postgres();
update private.mcp_credentials set revoked_at = now() where id = pg_temp.id('token');
select pg_temp.as_mcp('token2');
select is(
  public.mcp_sync_bank_finish(pg_temp.id('job5'), '{"ok": false, "error": {"code": "unavailable", "message": "retry", "reason": "busy"}}')->'error'->>'code',
  'not_found',
  'another token cannot finish the job'
);
select pg_temp.as_mcp('token');
select is(
  public.mcp_sync_bank_finish(pg_temp.id('job5'), '{"ok": false, "error": {"code": "unavailable", "message": "retry", "reason": "busy"}}')->'data'->>'state',
  'failed',
  'the job''s own token records its end after a revoke'
);
select pg_temp.as_postgres();
select is(
  (select error from private.mcp_sync_jobs where id = pg_temp.id('job5')),
  '{"code": "unavailable", "message": "retry", "reason": "busy"}'::jsonb,
  'a skipped pull reads as busy, not as a rate limit'
);
select throws_ok(
  $$update private.mcp_sync_jobs set complete = true where id = pg_temp.id('job5')$$,
  '23514', null,
  'only a done job says whether it is complete (mcp_sync_jobs_complete_chk)'
);

select * from finish();
rollback;
