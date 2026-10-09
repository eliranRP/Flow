-- FLOW-502 part 2: the new-lines and weekly targets, their claims, and one evening row per owner.

begin;

select plan(23);

do $users$
begin
  perform tests.create_supabase_user('pw_owner', 'pw-owner@example.com');
  perform tests.create_supabase_user('pw_other', 'pw-other@example.com');
end
$users$;

create temp table pw (label text primary key, id uuid);
grant all on pw to authenticated;

select tests.authenticate_as('pw_owner');
do $made$ begin perform public.create_company('Week Books', true); end $made$;
insert into pw (label, id) select 'a', id from public.companies where name = 'Week Books';

do $sub$ begin
  perform public.push_subscribe('https://fcm.googleapis.com/fcm/send/pw-1', repeat('A', 87), repeat('A', 22));
  perform public.set_notification_prefs(p_new_transaction => true, p_evening_reminder => true, p_weekly_summary => true);
end $sub$;

-- Turning תנועה חדשה on starts counting from now.
reset role;
select is(
  (select new_line_mark from public.notification_prefs where user_id = tests.get_supabase_uid('pw_owner')),
  pg_catalog.now(),
  'turning the switch on sets the mark to now'
);
-- Age the mark so lines made in this transaction count as new.
update public.notification_prefs set new_line_mark = pg_catalog.now() - interval '1 hour'
where user_id = tests.get_supabase_uid('pw_owner');

select tests.authenticate_as('pw_owner');
do $again$ begin perform public.set_notification_prefs(p_new_transaction => true); end $again$;
reset role;
select is(
  (select new_line_mark from public.notification_prefs where user_id = tests.get_supabase_uid('pw_owner')),
  pg_catalog.now() - interval '1 hour',
  'turning on a switch that is already on keeps the mark'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.sub', '', true);

create function pg_temp.line(p_id text, p_status text) returns jsonb language sql as $$
  select jsonb_build_object(
    'source', 'mercury', 'external_id', p_id, 'direction', 'expense', 'line_status', p_status,
    'doc_kind', 'expense', 'currency', 'USD', 'amount_original', 500, 'amount_negated', true,
    'doc_date', '2026-09-01', 'description', 'A payment',
    'vat', jsonb_build_object('amount', 0, 'status', 'source')
  );
$$;

select is((select count(*)::int from public.push_claim_targets('new')), 0, 'no new lines means no new-lines push');
select is(private.push_new_due(), false, 'the five-minute cron does not post');

do $lines$ begin
  perform public.upsert_connector_lines(
    (select id from pw where label = 'a'), 'mercury',
    jsonb_build_object('lines', jsonb_build_array(pg_temp.line('pw-1', 'posted'), pg_temp.line('pw-void', 'void'))),
    null, null
  );
  perform public.upsert_connector_lines(
    (select id from pw where label = 'a'), 'mercury',
    jsonb_build_object('lines', jsonb_build_array(pg_temp.line('pw-2', 'posted'))),
    null, null
  );
end $lines$;
-- An open review item with no bank line counts as waiting, not as a new line.
insert into public.review_queue (company_id, status, reason)
select id, 'open', 'missing_category' from pw where label = 'a';

select is(private.push_new_due(), true, 'new lines make the cron post');

create temp table waiting_now as
select coalesce((select w.waiting from private.push_waiting_by_owner() w where w.user_id = tests.get_supabase_uid('pw_owner')), 0) as n;

select results_eq(
  $$select user_id, endpoint, fresh, waiting from public.push_claim_targets('new')$$,
  $$select tests.get_supabase_uid('pw_owner'), 'https://fcm.googleapis.com/fcm/send/pw-1'::text, 2, n from waiting_now$$,
  'both posted lines count; the void line does not'
);
select is((select count(*)::int from public.push_claim_targets('new')), 0, 'a claimed line is not sent again');

-- A removed line and a line older than a day are not new.
reset role;
update public.notification_prefs set new_line_mark = null where user_id = tests.get_supabase_uid('pw_owner');
update public.transactions set removed_at = pg_catalog.now() where external_id = 'pw-2';
set local session_replication_role = replica;
update public.transactions set created_at = pg_catalog.now() - interval '2 days' where external_id = 'pw-1';
set local session_replication_role = origin;
select is((select count(*)::int from private.push_new_due_users()), 0, 'removed lines and lines older than a day are not new');

-- Switch off: not due.
update public.transactions set created_at = pg_catalog.now(), removed_at = null;
update public.notification_prefs set new_transaction = false where user_id = tests.get_supabase_uid('pw_owner');
select is((select count(*)::int from private.push_new_due_users()), 0, 'a user with the switch off is not due');

-- Evening: the owner's open review count, as before.
select results_eq(
  $$select user_id, waiting from private.push_evening_due_users()$$,
  $$select tests.get_supabase_uid('pw_owner'), n from waiting_now$$,
  'the evening row carries the open review count'
);
select is((select n from waiting_now) > 0, true, 'the review count includes the open item');

-- Weekly: the week's lines and the open count, once a day.
select is((select count(*)::int from private.push_weekly_due_users()), 1, 'the owner is due for the weekly summary');
select results_eq(
  $$select fresh, waiting from public.push_claim_targets('weekly')$$,
  $$select 2, n from waiting_now$$,
  'the weekly summary counts the week''s lines and the open review lines'
);
select is((select count(*)::int from public.push_claim_targets('weekly')), 0, 'the weekly summary goes once a day');
select is(
  (select weekly_sent_on from public.notification_prefs where user_id = tests.get_supabase_uid('pw_owner')),
  private.israel_now()::date,
  'the claim stamps today'
);
select is((select count(*)::int from private.push_weekly_due_users()), 0, 'nobody is due after the claim');
select is(private.push_weekly_due(), false, 'so the hourly cron does not post');

-- A run that read the same due list but waited on the claim's row lock claims nothing: the
-- claim's own conditions are rechecked on the updated row.
update public.notification_prefs set new_transaction = true, new_line_mark = pg_catalog.now() - interval '1 hour'
where user_id = tests.get_supabase_uid('pw_owner');
create temp table stale_due as select * from private.push_new_due_users();
select is((select count(*)::int from public.push_claim_targets('new')), 1, 'the first run claims the user');
select is(
  (select count(*)::int from public.notification_prefs p join stale_due d on d.user_id = p.user_id
   where p.new_line_mark is null or p.new_line_mark < d.upto),
  0,
  'the second run''s recheck finds the mark already moved'
);

-- Refusals and the schedule.
select throws_ok($$select * from public.push_claim_targets('monthly')$$, '22023', null, 'an unknown kind is refused');
select throws_ok($$select private.schedule_push_kind('monthly')$$, '22023', null, 'the schedule refuses an unknown kind');
select lives_ok($$select private.schedule_push_kind('new')$$, 'the schedule runs (and skips without Vault secrets)');

select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
select tests.authenticate_as('pw_other');
select throws_ok($$select * from public.push_claim_targets('new')$$, '42501', null, 'a user cannot claim push targets');

select * from finish();
rollback;
