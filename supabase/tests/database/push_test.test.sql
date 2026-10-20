-- FLOW-516: the test push gate (claim_push_test), its targets, and the app's unsubscribe.

begin;

select plan(18);

do $users$
begin
  perform tests.create_supabase_user('pt_owner', 'pt-owner@example.com');
  perform tests.create_supabase_user('pt_other', 'pt-other@example.com');
end
$users$;

create function pg_temp.key(n integer) returns text language sql as $$ select repeat('A', n); $$;
grant execute on function pg_temp.key(integer) to authenticated;

set local role anon;
select throws_ok($$select public.claim_push_test()$$, '42501', null, 'anon cannot claim a test push');
reset role;

select tests.authenticate_as('pt_owner');
select is(
  public.claim_push_test() - 'user_id',
  '{"devices": 0}'::jsonb,
  'a user with no device gets nothing to send'
);
select is(
  (public.claim_push_test()->>'user_id')::uuid,
  tests.get_supabase_uid('pt_owner'),
  'the claim names the caller from the JWT'
);
select lives_ok(
  $$select public.push_subscribe('https://web.push.apple.com/pt-device-1', pg_temp.key(87), pg_temp.key(22))$$,
  'the owner saves a device'
);
select is(
  (select array_agg((public.claim_push_test()->>'devices')::int) from generate_series(1, 5)),
  array[1, 1, 1, 1, 1],
  'five test pushes in an hour pass, each with the device count'
);
select throws_ok($$select public.claim_push_test()$$, '23514', 'push_test_limit', 'the sixth in an hour is refused');
select throws_ok($$select * from public.push_test_targets(tests.get_supabase_uid('pt_owner'))$$, '42501', null,
  'a user cannot list devices, not even their own');

select tests.authenticate_as('pt_other');
select lives_ok(
  $$select public.push_subscribe('https://fcm.googleapis.com/fcm/send/pt-device-2', pg_temp.key(87), pg_temp.key(22))$$,
  'another user saves a device'
);
select is((public.claim_push_test()->>'devices')::int, 1, 'another user''s limit is their own');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.list_my_push_devices()->'devices'->0) k),
  array['created_at', 'id', 'tag', 'user_agent'],
  'a device row carries no endpoint and no key'
);
select is(
  public.list_my_push_devices()->'devices'->0->>'tag',
  left(encode(sha256(convert_to('https://fcm.googleapis.com/fcm/send/pt-device-2', 'UTF8')), 'hex'), 16),
  'the tag is the start of the endpoint''s SHA-256, so the app can find its own row'
);
select lives_ok($$select public.push_unsubscribe('https://web.push.apple.com/pt-device-1')$$,
  'unsubscribing someone else''s device does nothing');

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select results_eq(
  $$select endpoint from public.push_test_targets(tests.get_supabase_uid('pt_owner'))$$,
  $$values ('https://web.push.apple.com/pt-device-1'::text)$$,
  'the send reads only the claimed user''s devices'
);

-- Back an hour: the limit counts only the last hour.
update private.push_test_sends set sent_at = now() - interval '61 minutes'
where user_id = tests.get_supabase_uid('pt_owner');
select tests.authenticate_as('pt_owner');
select is((public.claim_push_test()->>'devices')::int, 1, 'claims older than an hour do not count');
select is(jsonb_array_length(public.list_my_push_devices()->'devices'), 1, 'each user lists only their own devices');
select ok(public.list_my_push_devices()::text !~ 'push\.apple|fcm\.googleapis|AAAA', 'the list names no endpoint and no key');
select lives_ok($$select public.push_unsubscribe('https://web.push.apple.com/pt-device-1')$$, 'the app removes its own device on sign-out');
select is(public.get_notification_prefs()->>'has_subscription', 'false', 'the device row is gone');

select * from finish();
rollback;
