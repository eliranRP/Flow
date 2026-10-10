-- FLOW-502: push subscriptions and per-user prefs, the evening targets, and the void-line count.

begin;

select plan(33);

do $users$
begin
  perform tests.create_supabase_user('pn_owner', 'pn-owner@example.com');
  perform tests.create_supabase_user('pn_other', 'pn-other@example.com');
  perform tests.create_supabase_user('pn_quiet', 'pn-quiet@example.com');
end
$users$;

create temp table pn (label text primary key, id uuid);
grant all on pn to authenticated;

select tests.authenticate_as('pn_owner');
select lives_ok($$select public.create_company('Push Books', true)$$, 'owner creates a company');
insert into pn (label, id) select 'a', id from public.companies where name = 'Push Books';

select tests.authenticate_as('pn_quiet');
select lives_ok($$select public.create_company('Quiet Books', true)$$, 'a second owner creates a company');
insert into pn (label, id) select 'q', id from public.companies where name = 'Quiet Books';

create function pg_temp.key(n integer) returns text language sql as $$ select repeat('A', n); $$;
grant execute on function pg_temp.key(integer) to authenticated;

-- Prefs: all off by default.
select tests.authenticate_as('pn_owner');
select is(
  public.get_notification_prefs(),
  '{"new_transaction": false, "evening_reminder": false, "weekly_summary": false, "prompt_answered": false, "has_subscription": false}'::jsonb,
  'a new user has every switch off and no device'
);

-- Subscribe.
select throws_ok(
  $$select public.push_subscribe('https://example.com/push/1', pg_temp.key(87), pg_temp.key(22))$$,
  '22023', null, 'an endpoint that is not a push service is refused'
);
select throws_ok(
  $$select public.push_subscribe('https://fcm.googleapis.com/fcm/send/dev-1', 'short', pg_temp.key(22))$$,
  '22023', null, 'a malformed p256dh is refused'
);
select throws_ok(
  $$select public.push_subscribe('https://fcm.googleapis.com/fcm/send/dev-1', pg_temp.key(87), 'a/b')$$,
  '22023', null, 'a malformed auth secret is refused'
);
select lives_ok(
  $$select public.push_subscribe('https://fcm.googleapis.com/fcm/send/dev-1', pg_temp.key(87), pg_temp.key(22), 'Example Browser')$$,
  'the owner saves a device'
);
select lives_ok(
  $$select public.push_subscribe('https://fcm.googleapis.com/fcm/send/dev-1', pg_temp.key(87), pg_temp.key(22), 'Example Browser')$$,
  'saving the same device again is fine'
);
select is((public.get_notification_prefs()->>'has_subscription')::boolean, true, 'the owner now has a device');

-- At most 10 devices per user: the oldest goes.
reset role;
-- The touch trigger would stamp now(); age the first device past it.
set local session_replication_role = replica;
update public.push_subscriptions set updated_at = pg_catalog.now() - interval '1 day'
where endpoint = 'https://fcm.googleapis.com/fcm/send/dev-1';
set local session_replication_role = origin;
select tests.authenticate_as('pn_owner');
select lives_ok(
  $$select public.push_subscribe('https://fcm.googleapis.com/fcm/send/extra-' || n, pg_temp.key(87), pg_temp.key(22))
    from generate_series(1, 10) as n$$,
  'the owner saves ten more devices'
);
reset role;
select results_eq(
  $$select count(*)::int, bool_or(endpoint = 'https://fcm.googleapis.com/fcm/send/dev-1')
    from public.push_subscriptions where user_id = tests.get_supabase_uid('pn_owner')$$,
  $$values (10, false)$$,
  'only the ten newest devices are kept'
);
delete from public.push_subscriptions where user_id = tests.get_supabase_uid('pn_owner');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values (tests.get_supabase_uid('pn_owner'), 'https://fcm.googleapis.com/fcm/send/dev-1', repeat('A', 87), repeat('A', 22));
select tests.authenticate_as('pn_owner');

-- Prefs writes.
select is(
  public.set_notification_prefs(p_weekly_summary => true),
  '{"new_transaction": false, "evening_reminder": false, "weekly_summary": true, "prompt_answered": false, "has_subscription": true}'::jsonb,
  'one switch turns on and the others stay off'
);
select is(
  public.set_notification_prefs(p_new_transaction => true),
  '{"new_transaction": true, "evening_reminder": false, "weekly_summary": true, "prompt_answered": false, "has_subscription": true}'::jsonb,
  'a null leaves a switch as it is'
);
select is(
  public.answer_push_prompt(false),
  '{"new_transaction": true, "evening_reminder": false, "weekly_summary": true, "prompt_answered": true, "has_subscription": true}'::jsonb,
  'not now records the answer and leaves the evening reminder off'
);
select is(
  (public.answer_push_prompt(true)->>'evening_reminder')::boolean,
  true,
  'yes turns the evening reminder on'
);

-- Other users and roles.
select tests.authenticate_as('pn_other');
select is((public.get_notification_prefs()->>'has_subscription')::boolean, false, 'another user sees only their own prefs');
select is(
  (public.answer_push_prompt(true)->>'new_transaction')::boolean,
  true,
  'a first yes also turns on תנועה חדשה'
);
select lives_ok($$select public.push_unsubscribe('https://fcm.googleapis.com/fcm/send/dev-1')$$, 'unsubscribing a device that is not yours does nothing');
select throws_ok($$select * from public.push_subscriptions$$, '42501', null, 'a user cannot read the subscriptions table');
select throws_ok($$select * from public.notification_prefs$$, '42501', null, 'a user cannot read the prefs table');
select throws_ok($$select * from public.push_evening_targets()$$, '42501', null, 'a user cannot list the evening targets');

reset role;
set local role anon;
select throws_ok($$select public.get_notification_prefs()$$, '42501', null, 'anon cannot read prefs');

reset role;
select is(
  (select count(*)::int from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/dev-1'),
  1,
  'the device is still saved after the other user tried to remove it'
);

-- Evening targets: an owner with the reminder on, a device and open review lines.
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.sub', '', true);

select is((select count(*)::int from public.push_evening_targets()), 0, 'no open review lines means no reminder');

insert into public.review_queue (company_id, status, reason)
select id, 'open', 'missing_category' from pn where label in ('a', 'q');
insert into public.review_queue (company_id, status, reason)
select id, 'open', 'missing_category' from pn where label = 'a';

select results_eq(
  $$select endpoint, waiting from public.push_evening_targets()$$,
  $$values ('https://fcm.googleapis.com/fcm/send/dev-1'::text, 2)$$,
  'the owner who opted in is due, with the open count; the owner who did not is not'
);

select lives_ok(
  $$select public.note_push_results(
      array[tests.get_supabase_uid('pn_owner')],
      array['https://fcm.googleapis.com/fcm/send/gone-device']
    )$$,
  'the send function records the results'
);
select is((select count(*)::int from public.push_evening_targets()), 0, 'a user reminded today is not due again today');

update public.notification_prefs set evening_sent_on = (pg_catalog.now() at time zone 'Asia/Jerusalem')::date - 1
where user_id = tests.get_supabase_uid('pn_owner');
select is((select count(*)::int from public.push_evening_targets()), 1, 'the next day the user is due again');

select lives_ok(
  $$select public.note_push_results(array[]::uuid[], array['https://fcm.googleapis.com/fcm/send/dev-1'])$$,
  'a gone device is dropped'
);
select is((select count(*)::int from public.push_subscriptions), 0, 'the gone device is deleted');
select is((select count(*)::int from public.push_evening_targets()), 0, 'a user with no device is not due');

-- The cron gate holds only in the 20:00 Israel hour.
select is(
  private.push_evening_due(),
  false,
  'nobody is due, so the cron does not post'
);

-- FLOW-502: a first-seen void line is stored but not counted as inserted.
select is(
  (public.upsert_connector_lines(
    (select id from pn where label = 'a'),
    'mercury',
    jsonb_build_object('lines', jsonb_build_array(
      jsonb_build_object(
        'source', 'mercury', 'external_id', 'pn-void-1', 'direction', 'expense', 'line_status', 'void',
        'doc_kind', 'expense', 'currency', 'USD', 'amount_original', 500, 'amount_negated', true,
        'doc_date', '2026-09-01', 'description', 'A failed payment',
        'vat', jsonb_build_object('amount', 0, 'status', 'source')
      ),
      jsonb_build_object(
        'source', 'mercury', 'external_id', 'pn-posted-1', 'direction', 'expense', 'line_status', 'posted',
        'doc_kind', 'expense', 'currency', 'USD', 'amount_original', 700, 'amount_negated', true,
        'doc_date', '2026-09-02', 'description', 'A posted payment',
        'vat', jsonb_build_object('amount', 0, 'status', 'source')
      )
    )),
    null,
    null
  )).inserted,
  1,
  'only the posted line counts as inserted'
);

select * from finish();
rollback;
