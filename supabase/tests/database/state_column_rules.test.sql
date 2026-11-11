-- FLOW-1166 part 1 (decision 0266): one CHECK ties the columns of a state together, for loans,
-- projects, prepaid_schedules and company_invites (20261111071445_state_column_rules.sql). Each rule
-- refuses the meaningless row, and each writer's row still goes in: the app's direct loan writes,
-- mcp_set_loan_refinance, mcp_update_loan, mcp_undo, delete_loan / restore_loan, upsert_project,
-- mcp_create_project, mcp_update_project, mcp_create / end_prepaid_schedule, invite_member,
-- decline_invite, reopen_invite and cancel_invite. Also: two loans never name each other
-- (loans_refinance_pair), and an expired invite no longer blocks a new one to the same address.
-- Invented names and figures, @example.com only. Dates follow current_date where a month matters.

begin;

select plan(60);

do $users$
begin
  perform tests.create_supabase_user('sr_owner', 'sr-owner@example.com');
  perform tests.create_supabase_user('sr_invitee', 'sr-invitee@example.com');
end
$users$;

-- The invitee signed in with Google with that address.
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'google', now(), now(), now()
from auth.users u
where u.email = 'sr-invitee@example.com';

create temp table sr (label text primary key, id uuid);
grant all on sr to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid language sql set search_path = '' as $$ select id from pg_temp.sr where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- The month k months from this one, as 'YYYY-MM' and as its first day.
create or replace function pg_temp.ym(k integer)
returns text language sql set search_path = '' as $$
  select to_char(date_trunc('month', current_date) + make_interval(months => k), 'YYYY-MM');
$$;
create or replace function pg_temp.m1(k integer)
returns date language sql set search_path = '' as $$
  select (date_trunc('month', current_date) + make_interval(months => k))::date;
$$;

-- Act as the owner's flow-mcp credential.
create or replace function pg_temp.as_mcp()
returns void language plpgsql set search_path = '' as $$
declare
  uid uuid := tests.get_supabase_uid('sr_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1',
    'mcp_tid', pg_temp.id('tok'))::text, true);
end; $$;

-- One MCP call as the owner; a raised error comes back as {"raised": message}.
create or replace function pg_temp.mcp(p_sql text)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_mcp();
  execute p_sql into r;
  reset role;
  return r;
exception when others then
  reset role;
  return jsonb_build_object('raised', sqlerrm);
end; $$;

create or replace function pg_temp.add_loan(p_key text)
returns uuid language sql set search_path = '' as $$
  select (pg_temp.mcp(format(
    'select public.mcp_add_loan(%L, %L, 5000000, 60000, null, %L::date, null, 0, %L, null, %L, null, null)',
    p_key, 'Example ' || p_key, '2026-01-01', 'ILS', 'demand'))->'data'->>'id')::uuid;
$$;

create or replace function pg_temp.loan(p_label text)
returns text language sql set search_path = '' as $$
  select l.status::text || ':' || coalesce(l.closed_on::text, '-') || ':'
    || coalesce((select s.label from pg_temp.sr s where s.id = l.refinanced_into_id), '-')
  from public.loans l where l.id = pg_temp.id(p_label);
$$;

create or replace function pg_temp.project(p_label text)
returns text language sql set search_path = '' as $$
  select p.status::text || ':' || (p.finished_on is not null)::text from public.projects p where p.id = pg_temp.id(p_label);
$$;

create or replace function pg_temp.invite(p_label text)
returns text language sql set search_path = '' as $$
  select i.status || ':' || (i.decided_at is not null)::text || ':' || (i.decided_by is not null)::text
  from public.company_invites i where i.id = pg_temp.id(p_label);
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- The owner's company, made as the app makes it, and a flow-mcp credential for it.
select tests.authenticate_as('sr_owner');
insert into sr (label, id) select 'co', public.create_company('Example State Rules Co', true);
reset role;
select public.store_mcp_credential(
  tests.get_supabase_uid('sr_owner'), 'hash-sr-write-001', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into sr (label, id) select 'tok', id from private.mcp_credentials where token_hash = 'hash-sr-write-001';

insert into sr (label, id) values
  ('a', pg_temp.add_loan('sr-a')),
  ('b', pg_temp.add_loan('sr-b')),
  ('c', pg_temp.add_loan('sr-c')),
  ('d', pg_temp.add_loan('sr-d')),
  ('e', pg_temp.add_loan('sr-e')),
  ('f', pg_temp.add_loan('sr-f')),
  ('x', pg_temp.add_loan('sr-x'));

-- ---------------------------------------------------------------------------------------------
-- loans_refinance_chk: a refinance link only on a loan that is not open.
-- ---------------------------------------------------------------------------------------------

select tests.authenticate_as('sr_owner');
select throws_ok(
  format('update public.loans set refinanced_into_id = %L where id = %L', pg_temp.id('b'), pg_temp.id('a')),
  '23514', 'new row for relation "loans" violates check constraint "loans_refinance_chk"',
  'the app cannot link an open loan'
);
-- The close sheet's write: status, date and link in one update.
select lives_ok(
  format($$update public.loans set status = 'closed', closed_on = '2026-06-30', refinanced_into_id = %L where id = %L$$,
    pg_temp.id('b'), pg_temp.id('a')),
  'the app closes a loan with its link in one write'
);
reset role;
select is(pg_temp.loan('a'), 'closed:2026-06-30:b', 'which stores the closed loan with the link');

-- loans_refinance_pair: b may not name a back, from the app or set_loan_refinance.
select tests.authenticate_as('sr_owner');
select throws_ok(
  format($$update public.loans set status = 'closed', closed_on = '2026-06-30', refinanced_into_id = %L where id = %L$$,
    pg_temp.id('a'), pg_temp.id('b')),
  '23514', 'loan_refinance_pair', 'two loans never name each other'
);
-- The reopen's write: open, no date, no link in one update.
select lives_ok(
  format($$update public.loans set status = 'open', closed_on = null, refinanced_into_id = null where id = %L$$, pg_temp.id('a')),
  'the app reopens a loan and clears its link in one write'
);
reset role;
select is(pg_temp.loan('a'), 'open:-:-', 'so the reopened loan names nothing');

select throws_ok(
  format($$insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, start_date, escrow_minor, currency, kind,
      refinanced_into_id)
    select company_id, 'Example inserted open', principal_minor, annual_rate_ppm, start_date, escrow_minor, currency, kind, %L
    from public.loans where id = %L$$, pg_temp.id('b'), pg_temp.id('a')),
  '23514', 'new row for relation "loans" violates check constraint "loans_refinance_chk"',
  'an open loan is not inserted with a link'
);
select lives_ok(
  format($$insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, start_date, escrow_minor, currency, kind,
      status, closed_on, refinanced_into_id)
    select company_id, 'Example inserted closed', principal_minor, annual_rate_ppm, start_date, escrow_minor, currency, kind,
      'closed', '2026-06-30', %L
    from public.loans where id = %L$$, pg_temp.id('b'), pg_temp.id('a')),
  'a closed loan is inserted with its link'
);

-- MCP: close with update_loan, link with set_loan_refinance, reopen, undo the reopen.
select is(
  pg_temp.mcp(format('select public.mcp_update_loan(%L, %L, %L::jsonb)', 'sr-close-c', pg_temp.id('c'),
    '{"status": "closed", "closed_on": "2026-06-30"}'))->>'ok',
  'true', 'update_loan closes c'
);
select is(
  pg_temp.mcp(format('select public.mcp_set_loan_refinance(%L, %L, %L)', 'sr-link-c', pg_temp.id('c'), pg_temp.id('x')))->>'ok',
  'true', 'set_loan_refinance links c to x'
);
select is(
  pg_temp.mcp(format('select public.mcp_update_loan(%L, %L, %L::jsonb)', 'sr-rename-c', pg_temp.id('c'),
    '{"name": "Example c renamed"}'))->>'ok',
  'true', 'update_loan renames the linked loan (it writes the link column unchanged)'
);
select is(
  pg_temp.mcp(format('select public.mcp_update_loan(%L, %L, %L::jsonb)', 'sr-reopen-c', pg_temp.id('c'), '{"status": "open"}'))->>'ok',
  'true', 'update_loan reopens c'
);
select is(pg_temp.loan('c'), 'open:-:-', 'and clears its link');
select is(
  pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L)', 'sr-reopen-c-undo', 'loan_update', pg_temp.id('c')))->>'ok',
  'true', 'undo of the reopen'
);
select is(pg_temp.loan('c'), 'closed:2026-06-30:x', 'puts the status, date and link back together');

-- The undo of a close, after a link was named, leaves the loan open with no link.
select is(
  pg_temp.mcp(format('select public.mcp_update_loan(%L, %L, %L::jsonb)', 'sr-close-d', pg_temp.id('d'),
    '{"status": "closed", "closed_on": "2026-06-30"}'))->>'ok',
  'true', 'update_loan closes d'
);
select is(
  pg_temp.mcp(format('select public.mcp_set_loan_refinance(%L, %L, %L)', 'sr-link-d', pg_temp.id('d'), pg_temp.id('x')))->>'ok',
  'true', 'set_loan_refinance links d to x'
);
select is(
  pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L)', 'sr-close-d-undo', 'loan_update', pg_temp.id('d')))->>'ok',
  'true', 'undo of the close'
);
select is(pg_temp.loan('d'), 'open:-:-', 'reopens d with no link');

-- The undo of a cleared link on a loan reopened since is a conflict.
select is(
  pg_temp.mcp(format('select public.mcp_update_loan(%L, %L, %L::jsonb)', 'sr-close-e', pg_temp.id('e'),
    '{"status": "closed", "closed_on": "2026-06-30"}'))->>'ok',
  'true', 'update_loan closes e'
);
select is(
  pg_temp.mcp(format('select public.mcp_set_loan_refinance(%L, %L, %L)', 'sr-link-e', pg_temp.id('e'), pg_temp.id('x')))->>'ok',
  'true', 'e is linked to x'
);
select is(
  pg_temp.mcp(format('select public.mcp_set_loan_refinance(%L, %L, null)', 'sr-unlink-e', pg_temp.id('e')))->>'ok',
  'true', 'and the link is cleared'
);
select is(
  pg_temp.mcp(format('select public.mcp_update_loan(%L, %L, %L::jsonb)', 'sr-reopen-e', pg_temp.id('e'), '{"status": "open"}'))->>'ok',
  'true', 'e is reopened'
);
select is(
  pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L)', 'sr-unlink-e-undo', 'loan_refinance', pg_temp.id('e')))->'error'->>'code',
  'conflict', 'the undo of the cleared link is a conflict on the open loan'
);
select is(pg_temp.loan('e'), 'open:-:-', 'which still names nothing');

-- Restore: a loan reopened since the delete is not relinked.
update public.loans set status = 'closed', closed_on = '2026-06-30', refinanced_into_id = pg_temp.id('f') where id = pg_temp.id('b');
select ok((pg_temp.mcp(format('select public.delete_loan(%L)', pg_temp.id('f')))->>'loan_id') is not null, 'f is deleted');
select is(pg_temp.loan('b'), 'closed:2026-06-30:-', 'which clears b''s link');
update public.loans set status = 'open', closed_on = null where id = pg_temp.id('b');
select is(pg_temp.mcp(format('select public.restore_loan(%L)', pg_temp.id('f')))->>'raised', null, 'f comes back');
select is(pg_temp.loan('b'), 'open:-:-', 'and b, open now, is not linked to it again');

-- ---------------------------------------------------------------------------------------------
-- projects_finished_chk: an active project has no finish date.
-- ---------------------------------------------------------------------------------------------

select tests.authenticate_as('sr_owner');
insert into sr (label, id) select 'p_app', public.upsert_project(null, 'Example Oak house', 100000, 'active', null);
select is(pg_temp.project('p_app'), 'active:false', 'upsert_project makes an active project with no date');
select lives_ok(
  format($$select public.upsert_project(%L, 'Example Oak house', 100000, 'finished', null)$$, pg_temp.id('p_app')),
  'upsert_project finishes it'
);
select is(pg_temp.project('p_app'), 'finished:true', 'with a date');
select lives_ok(
  format($$select public.upsert_project(%L, 'Example Oak house', 100000, 'active', null)$$, pg_temp.id('p_app')),
  'upsert_project makes it active again'
);
select is(pg_temp.project('p_app'), 'active:false', 'and clears the date');
reset role;

select throws_ok(
  format($$update public.projects set finished_on = '2026-06-30' where id = %L$$, pg_temp.id('p_app')),
  '23514', 'new row for relation "projects" violates check constraint "projects_finished_chk"',
  'an active project with a finish date is refused'
);
select lives_ok(
  format($$select tests.fixture_project(%L, 'Example finished before the date', 'finished')$$, pg_temp.id('co')),
  'a finished project with no date still goes in (finished before the column)'
);

insert into sr (label, id)
select 'p_mcp', (pg_temp.mcp($$select public.mcp_create_project('sr-p-mcp', 'Example Pine house', 'finished', null, null)$$)
  ->'data'->>'id')::uuid;
select is(pg_temp.project('p_mcp'), 'finished:true', 'create_project makes a finished project with a date');
select is(
  pg_temp.mcp(format('select public.mcp_update_project(%L, %L, %L::jsonb)', 'sr-p-active', pg_temp.id('p_mcp'),
    '{"status": "active"}'))->>'ok',
  'true', 'update_project makes it active'
);
select is(pg_temp.project('p_mcp'), 'active:false', 'with no date');
select is(
  pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L)', 'sr-p-active-undo', 'project_update', pg_temp.id('p_mcp')))->>'ok',
  'true', 'undo project_update'
);
select is(pg_temp.project('p_mcp'), 'finished:true', 'puts the status and its date back together');

-- ---------------------------------------------------------------------------------------------
-- prepaid_schedules_ended_chk: ended_on and end_mode both, exactly when ended.
-- ---------------------------------------------------------------------------------------------

insert into sr (label, id) values
  ('maple', tests.fixture_project(pg_temp.id('co'), 'Example Maple house')),
  ('insurance', tests.fixture_category(pg_temp.id('co'), 'Example insurance', 'expense')),
  ('repairs', tests.fixture_category(pg_temp.id('co'), 'Example repairs', 'expense'));
insert into sr (label, id) values
  ('l_pp', tests.fixture_line(pg_temp.id('co'), 'sr:prepaid', 120000, 'expense', pg_temp.id('maple'), pg_temp.id('repairs'),
    pg_temp.m1(-3)));
insert into sr (label, id)
select 's_pp', (pg_temp.mcp(format(
  'select public.mcp_create_prepaid_schedule(%L, %L::uuid, %L::uuid, %L, %s, %L::uuid, null, 1, null, %L)',
  'sr-pp', pg_temp.id('l_pp'), pg_temp.id('insurance'), pg_temp.ym(-3), 12, pg_temp.id('maple'), 'Example Insurance Co policy'))
  ->'data'->>'schedule_id')::uuid;
select is(
  (select status || ':' || (ended_on is null)::text || ':' || (end_mode is null)::text
   from public.prepaid_schedules where id = pg_temp.id('s_pp')),
  'active:true:true', 'create_prepaid_schedule makes an active schedule with no end'
);
select throws_ok(
  format($$update public.prepaid_schedules set ended_on = %L where id = %L$$, pg_temp.m1(0), pg_temp.id('s_pp')),
  '23514', 'new row for relation "prepaid_schedules" violates check constraint "prepaid_schedules_ended_chk"',
  'an active schedule with an end month is refused'
);
select throws_ok(
  format($$update public.prepaid_schedules set end_mode = 'keep' where id = %L$$, pg_temp.id('s_pp')),
  '23514', 'new row for relation "prepaid_schedules" violates check constraint "prepaid_schedules_ended_chk"',
  'and so is one with only an end mode'
);
select is(
  pg_temp.mcp(format('select public.mcp_end_prepaid_schedule(%L, %L::uuid, %L, %L)', 'sr-pp-end', pg_temp.id('s_pp'),
    pg_temp.ym(0), 'expense'))->'data'->>'status',
  'ended', 'end_prepaid_schedule ends it'
);
select is(
  (select status || ':' || (ended_on is null)::text || ':' || (end_mode is null)::text
   from public.prepaid_schedules where id = pg_temp.id('s_pp')),
  'ended:false:false', 'with its end month and mode'
);
select is(
  pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'sr-pp-end-undo', 'prepaid_end', pg_temp.id('s_pp')))->>'ok',
  'true', 'undo prepaid_end'
);
select is(
  (select status || ':' || (ended_on is null)::text || ':' || (end_mode is null)::text
   from public.prepaid_schedules where id = pg_temp.id('s_pp')),
  'active:true:true', 'puts the schedule back active with no end'
);

-- ---------------------------------------------------------------------------------------------
-- company_invites_decided_chk: a pending invite has no decision; a decided one has its time.
-- ---------------------------------------------------------------------------------------------

select tests.authenticate_as('sr_owner');
insert into sr (label, id) select 'inv', (public.invite_member('sr-invitee@example.com', 'editor')->>'id')::uuid;
reset role;
select is(pg_temp.invite('inv'), 'pending:false:false', 'invite_member makes a pending invite with no decision');
select throws_ok(
  format($$update public.company_invites set decided_at = now() where id = %L$$, pg_temp.id('inv')),
  '23514', 'new row for relation "company_invites" violates check constraint "company_invites_decided_chk"',
  'a pending invite with a decision time is refused'
);
select throws_ok(
  format($$update public.company_invites set status = 'cancelled' where id = %L$$, pg_temp.id('inv')),
  '23514', 'new row for relation "company_invites" violates check constraint "company_invites_decided_chk"',
  'and so is a decided one with no time'
);

select tests.authenticate_as('sr_invitee');
select is(public.decline_invite(pg_temp.id('inv'))->>'status', 'declined', 'the invitee declines');
reset role;
select is(pg_temp.invite('inv'), 'declined:true:true', 'with the time and who');
select tests.authenticate_as('sr_invitee');
select is(public.reopen_invite(pg_temp.id('inv'))->>'status', 'pending', 'the toast''s undo reopens it');
reset role;
select is(pg_temp.invite('inv'), 'pending:false:false', 'and clears the decision');

-- An expired invite no longer blocks a new one: it is cancelled and a new one is made.
reset role;
update public.company_invites set expires_at = now() - interval '1 day' where id = pg_temp.id('inv');
select tests.authenticate_as('sr_owner');
insert into sr (label, id) select 'inv2', (public.invite_member('sr-invitee@example.com', 'viewer')->>'id')::uuid;
reset role;
select isnt(pg_temp.id('inv2'), pg_temp.id('inv'), 'inviting the address again makes a new invite');
select is(pg_temp.invite('inv'), 'cancelled:true:true', 'and cancels the expired one');
select tests.authenticate_as('sr_owner');
select is(public.invite_member('sr-invitee@example.com', 'viewer')->>'existing', 'true',
  'an invite still running is returned as existing, as before');
select is(public.cancel_invite(pg_temp.id('inv2'))->>'status', 'cancelled', 'the owner cancels it');
reset role;
select is(pg_temp.invite('inv2'), 'cancelled:true:true', 'with the time and who');

select * from finish();

rollback;
