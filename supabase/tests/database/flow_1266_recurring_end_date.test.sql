-- FLOW-1266: a recurring charge can have an end date (recurring_overrides.ends_on). recurring_parties leaves out
-- a charge that is over, expected_months stops at the end date, the schedule says it, and set_payment_end and
-- MCP set_line_end_date (undo line_end) write it. FLOW-859: the undo of a line_recurring write that cleared a
-- passed end date puts it back, and set_payment_end and set_line_end_date refuse a viewer and another company's
-- line or project. FLOW-865: the undo leaves an end date the owner wrote (or cleared) after the write.
-- Covers set_payment_recurring, mcp_set_line_recurring, mcp_undo, set_payment_end, mcp_set_line_end_date.
-- Invented data only. Amounts are agorot. The reads take "today" 2026-10-20; the FLOW-859 dates follow
-- current_date.

begin;

select plan(42);

do $users$
begin
  perform tests.create_supabase_user('ed_owner', 'ed-owner@example.com');
end
$users$;

create temp table ed (label text primary key, id uuid);
grant all on ed to authenticated, service_role;

insert into ed (label, id) values ('co', tests.fixture_company('ed_owner', 'Example End Date LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.ed where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into public.suppliers (company_id, name)
select pg_temp.id('co'), n from unnest(array['Example Rent', 'Example Water', 'Example Survey']) n;
insert into ed (label, id)
select lower(replace(s.name, 'Example ', '')), s.id from public.suppliers s where s.company_id = pg_temp.id('co');

-- Rent: 500.00 on the 12th, April to September 2026. Water: 80.00 on the 25th, the same months.
insert into ed (label, id)
select p.party || ':' || to_char(d, 'YYMM'), tests.fixture_line(
  pg_temp.id('co'), 'ed:' || p.party || to_char(d, 'YYMM'), p.amount, 'expense', null, null, d::date + p.day - 1)
from (values ('rent', 50000::bigint, 12), ('water', 8000::bigint, 25)) p(party, amount, day)
cross join generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;
-- Survey: 300.00 on the 25th every two months, last in July 2026, so late in October (due in September).
insert into ed (label, id)
select 'survey:' || to_char(d, 'YYMM'), tests.fixture_line(
  pg_temp.id('co'), 'ed:survey' || to_char(d, 'YYMM'), 30000, 'expense', null, null, d::date + 24)
from generate_series('2026-01-01'::date, '2026-07-01'::date, interval '2 months') d;
update public.transactions t
set supplier_id = pg_temp.id(split_part(e.label, ':', 1))
from pg_temp.ed e
where e.label like '%:%' and t.id = e.id;

create or replace function pg_temp.listed(p_party text)
returns boolean
language sql
as $$
  select exists (
    select 1 from private.recurring_parties(pg_temp.id('co'), '2026-10-20') rp
    where rp.party_id = pg_temp.id(p_party)
  );
$$;

create or replace function pg_temp.ends(p_party text, p_on date)
returns void
language sql
as $$
  insert into public.recurring_overrides (company_id, direction, party_id, currency, ends_on)
  values (pg_temp.id('co'), 'expense', pg_temp.id(p_party), 'ILS', p_on)
  on conflict (company_id, direction, party_id, currency, project_id) do update set ends_on = excluded.ends_on;
$$;

-- 1. The column.
select has_column('public', 'recurring_overrides', 'ends_on', 'recurring_overrides has ends_on');

-- 2-6. Which charges are over.
select ok(pg_temp.listed('rent') and pg_temp.listed('water'), 'with no end date both charges recur');
select pg_temp.ends('rent', '2026-10-15');
select ok(not pg_temp.listed('rent'), 'a charge whose end date has passed is not recurring');
select pg_temp.ends('rent', '2026-10-25');
select is(
  (select rp.ends_on from private.recurring_parties(pg_temp.id('co'), '2026-10-20') rp where rp.party_id = pg_temp.id('rent')),
  '2026-10-25'::date,
  'a charge due before its end date recurs and says its end date'
);
select pg_temp.ends('water', '2026-10-22');
select ok(not pg_temp.listed('water'), 'a charge not come this month whose next due day is after its end date is over');
select pg_temp.ends('water', '2026-10-31');
select ok(pg_temp.listed('water'), 'a charge due on or before its end date still recurs');

-- A late two-monthly charge is due from this month on: an end date before this month's due day ends it.
select ok(pg_temp.listed('survey'), 'a late two-monthly charge recurs');
insert into public.recurring_overrides (company_id, direction, party_id, currency, ends_on)
values (pg_temp.id('co'), 'expense', pg_temp.id('survey'), 'ILS', '2026-10-22');
select ok(not pg_temp.listed('survey'), 'a late charge whose due day this month is after its end date is over');
delete from public.recurring_overrides where party_id = pg_temp.id('survey');

-- 7-9. The forecast stops at the end date.
delete from public.recurring_overrides where party_id = pg_temp.id('water');
select pg_temp.ends('rent', '2026-12-12');
create or replace function pg_temp.expense_in(p_month int)
returns bigint
language sql
as $$
  select coalesce((
    select sum((c ->> 'expense_minor')::bigint)
    from jsonb_array_elements(public.expected_months(6, null, '2026-10-20') -> 'months' -> p_month -> 'by_currency') c
  ), 0);
$$;
grant execute on function pg_temp.expense_in(int) to authenticated, service_role;
select tests.authenticate_as('ed_owner');
select is(pg_temp.expense_in(2), -88000::bigint, 'December has rent, water and survey: rent''s due day is its end date');
select is(pg_temp.expense_in(3), -8000::bigint, 'January has water only: rent ended in December');
select is(
  (select r ->> 'ends_on' from jsonb_array_elements(public.expected_months(0, null, '2026-10-20') -> 'recurring') r
   where r ->> 'party_id' = pg_temp.id('rent')::text),
  '2026-12-12',
  'expected_months says each charge''s end date'
);
reset role;
select pg_temp.ends('rent', '2026-12-11');
select tests.authenticate_as('ed_owner');
select is(pg_temp.expense_in(2), -38000::bigint, 'an end date a day before December''s due day leaves rent out of December');
reset role;

-- 11. The schedule says it.
select is(
  (select r ->> 'ends_on' from jsonb_array_elements(private.recurring_schedule_json(pg_temp.id('co'), '2026-10-20')) r
   where r ->> 'party_id' = pg_temp.id('rent')::text),
  '2026-12-11',
  'the schedule row says its end date'
);

-- 12-15. The app's write.
delete from public.recurring_overrides where company_id = pg_temp.id('co');
select tests.authenticate_as('ed_owner');
select is(
  public.set_payment_end(pg_temp.id('rent:2609'), '2027-03-31') -> 'prior_ends_on',
  'null'::jsonb,
  'set_payment_end writes an end date, with none before'
);
select is(
  public.set_payment_end(pg_temp.id('rent:2609'), '2027-06-30') ->> 'prior_ends_on',
  '2027-03-31',
  'a second write returns the end date before it, for ביטול'
);
select throws_ok(
  format('select public.set_payment_end(%L, %L)', pg_temp.id('rent:2609'), '1999-12-31'),
  'P0001', 'validation', 'a date before 2000 is refused'
);
select public.set_payment_end(pg_temp.id('rent:2609'), null);
reset role;
select is(
  (select count(*) from public.recurring_overrides where company_id = pg_temp.id('co'))::integer,
  0,
  'clearing the only word removes the row'
);

-- 16. Marking the charge recurring again clears an end date that has passed.
select pg_temp.ends('rent', '2020-01-31');
select private.write_recurring_override(pg_temp.id('co'), 'expense', pg_temp.id('rent'), 'ILS', null, 'recurring', 'true'::jsonb);
select is(
  (select ends_on from public.recurring_overrides where company_id = pg_temp.id('co') and party_id = pg_temp.id('rent')),
  null::date,
  'marking a charge recurring again clears its passed end date'
);
delete from public.recurring_overrides where company_id = pg_temp.id('co');

-- 17-20. The MCP: set, replay, undo, and a conflict once the date changed again.
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('ed_owner'), pg_temp.id('co'), 'hash-ed-write', 'kid', array['write']::text[], '2099-01-01');
insert into ed (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-ed-write';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('ed_owner');
  tid uuid;
begin
  select id into tid from pg_temp.ed where label = 'write';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

select pg_temp.as_mcp();
select is(
  (select jsonb_build_object('kind', d -> 'undo_kind', 'ends_on', d -> 'ends_on', 'prior', d ? 'prior_ends_on')
   from (select public.mcp_set_line_end_date('ed-1', pg_temp.id('rent:2609'), '2027-01-31') -> 'data' as d) x),
  '{"kind": "line_end", "ends_on": "2027-01-31", "prior": false}'::jsonb,
  'set_line_end_date writes the end date and offers undo line_end'
);
select is(
  public.mcp_set_line_end_date('ed-1', pg_temp.id('rent:2609'), '2027-01-31') -> 'data' ->> 'ends_on',
  '2027-01-31',
  'the same key replays'
);
select is(public.mcp_undo('ed-undo-1', 'line_end', pg_temp.id('rent:2609')) ->> 'ok', 'true', 'undo line_end');
select is(
  public.mcp_set_line_end_date('ed-past', pg_temp.id('rent:2609'), '2020-01-31') -> 'error' ->> 'code',
  'validation',
  'a date before today is refused as validation'
);
select public.mcp_set_line_end_date('ed-2', pg_temp.id('rent:2609'), '2027-02-28');
select tests.authenticate_as('ed_owner');
select public.set_payment_end(pg_temp.id('rent:2609'), '2027-05-31');
select pg_temp.as_mcp();
select is(
  public.mcp_undo('ed-undo-2', 'line_end', pg_temp.id('rent:2609')) -> 'error' ->> 'code',
  'conflict',
  'undo after the end date changed again is a conflict'
);
reset role;

-- 24-30. FLOW-859: marking a charge recurring again clears an end date that has passed; the undo puts it back.
-- These dates follow today, so the end date has always passed.
delete from public.recurring_overrides where company_id = pg_temp.id('co');
select pg_temp.ends('rent', current_date - 40);
select pg_temp.as_mcp();
select is(
  public.mcp_set_line_recurring('ed-rec-1', pg_temp.id('rent:2609'), true) -> 'data' ? 'prior_ends_on',
  false,
  'set_line_recurring answers as before: the end date it cleared stays in the undo log'
);
reset role;
select is(
  (select jsonb_build_object('recurring', recurring, 'ends_on', ends_on) from public.recurring_overrides
   where company_id = pg_temp.id('co') and party_id = pg_temp.id('rent')),
  jsonb_build_object('recurring', true, 'ends_on', null),
  'marking the ended charge recurring through the MCP clears its passed end date'
);
select pg_temp.as_mcp();
select is(public.mcp_undo('ed-undo-rec-1', 'line_recurring', pg_temp.id('rent:2609')) ->> 'ok', 'true', 'undo line_recurring');
reset role;
select is(
  (select jsonb_build_object('recurring', recurring, 'ends_on', ends_on) from public.recurring_overrides
   where company_id = pg_temp.id('co') and party_id = pg_temp.id('rent')),
  jsonb_build_object('recurring', null, 'ends_on', current_date - 40),
  'the undo puts back the switch and the end date the write cleared: the charge is ended again'
);
-- An end date set after the write is the owner's newer word: the undo leaves it.
select pg_temp.as_mcp();
select public.mcp_set_line_recurring('ed-rec-2', pg_temp.id('rent:2609'), true);
select public.mcp_set_line_end_date('ed-end-3', pg_temp.id('rent:2609'), current_date + 60);
select public.mcp_undo('ed-undo-rec-2', 'line_recurring', pg_temp.id('rent:2609'));
reset role;
select is(
  (select jsonb_build_object('recurring', recurring, 'ends_on', ends_on) from public.recurring_overrides
   where company_id = pg_temp.id('co') and party_id = pg_temp.id('rent')),
  jsonb_build_object('recurring', null, 'ends_on', current_date + 60),
  'an end date set after the write stays after the undo'
);
-- FLOW-865: an end date the owner clears after the write is their newer word too: the undo leaves it cleared,
-- whether the owner cleared it in the app or through the MCP. A later pace is not an end-date word.
delete from public.recurring_overrides where company_id = pg_temp.id('co');
select pg_temp.ends('rent', current_date - 40);
select pg_temp.as_mcp();
select public.mcp_set_line_recurring('ed-rec-3', pg_temp.id('rent:2609'), true);
reset role;
select tests.authenticate_as('ed_owner');
select public.set_payment_end(pg_temp.id('rent:2609'), current_date + 30);
select public.set_payment_end(pg_temp.id('rent:2609'), null);
reset role;
select pg_temp.as_mcp();
select is(public.mcp_undo('ed-undo-rec-3', 'line_recurring', pg_temp.id('rent:2609')) ->> 'ok', 'true',
  'undo line_recurring after the owner cleared the end date');
reset role;
select is(
  (select count(*) from public.recurring_overrides where company_id = pg_temp.id('co') and party_id = pg_temp.id('rent'))::integer,
  0,
  'the switch goes back and the end date the owner cleared in the app stays cleared'
);
select pg_temp.ends('rent', current_date - 40);
select pg_temp.as_mcp();
select public.mcp_set_line_recurring('ed-rec-4', pg_temp.id('rent:2609'), true);
select public.mcp_set_line_end_date('ed-end-4', pg_temp.id('rent:2609'), null);
select public.mcp_undo('ed-undo-rec-4', 'line_recurring', pg_temp.id('rent:2609'));
reset role;
select is(
  (select count(*) from public.recurring_overrides where company_id = pg_temp.id('co') and party_id = pg_temp.id('rent'))::integer,
  0,
  'an end date cleared through the MCP after the write stays cleared too'
);
select pg_temp.ends('rent', current_date - 40);
select pg_temp.as_mcp();
select public.mcp_set_line_recurring('ed-rec-5', pg_temp.id('rent:2609'), true);
select public.mcp_set_line_pace('ed-pace-5', pg_temp.id('rent:2609'), 'quarter');
select public.mcp_undo('ed-undo-rec-5', 'line_recurring', pg_temp.id('rent:2609'));
reset role;
select is(
  (select jsonb_build_object('recurring', recurring, 'pace', pace, 'ends_on', ends_on) from public.recurring_overrides
   where company_id = pg_temp.id('co') and party_id = pg_temp.id('rent')),
  jsonb_build_object('recurring', null, 'pace', 'quarter', 'ends_on', current_date - 40),
  'a pace set after the write is not an end-date word: the undo still puts back the end date'
);
-- The app's write says the end date it cleared, and null when it cleared none.
delete from public.recurring_overrides where company_id = pg_temp.id('co');
select pg_temp.ends('rent', current_date - 40);
select tests.authenticate_as('ed_owner');
select is(
  public.set_payment_recurring(pg_temp.id('rent:2609'), true) ->> 'prior_ends_on',
  (current_date - 40)::text,
  'set_payment_recurring returns prior_ends_on: the passed end date it cleared'
);
select is(
  public.set_payment_recurring(pg_temp.id('rent:2609'), false) -> 'prior_ends_on',
  'null'::jsonb,
  'and null when it cleared none'
);
reset role;

-- 31-38. Who may write an end date: a viewer is refused, and another company's line or project is refused.
do $others$
begin
  perform tests.create_supabase_user('ed_viewer', 'ed-viewer@example.com');
  perform tests.create_supabase_user('ed_other', 'ed-other@example.com');
end
$others$;
insert into public.company_members (company_id, user_id, role)
values (pg_temp.id('co'), tests.get_supabase_uid('ed_viewer'), 'viewer');
insert into ed (label, id) values ('co_b', tests.fixture_company('ed_other', 'Example Other End Date LLC'));
insert into ed (label, id) values ('b_proj', tests.fixture_project(pg_temp.id('co_b'), 'Example Other House'));
insert into public.suppliers (company_id, name) values (pg_temp.id('co_b'), 'Example Other Rent');
insert into ed (label, id)
select 'b_line', tests.fixture_line(pg_temp.id('co_b'), 'ed:b-rent', 50000, 'expense', pg_temp.id('b_proj'), null,
  current_date - 10);
update public.transactions t set supplier_id = s.id
from public.suppliers s
where t.id = pg_temp.id('b_line') and s.company_id = pg_temp.id('co_b');
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('ed_viewer'), pg_temp.id('co'), 'hash-ed-viewer', 'kid', array['read', 'write']::text[], '2099-01-01');
insert into ed (label, id) select 'viewer_write', id from private.mcp_credentials where token_hash = 'hash-ed-viewer';
delete from public.recurring_overrides where company_id = pg_temp.id('co');

create or replace function pg_temp.as_mcp_of(p_user text, p_token text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid(p_user);
  tid uuid;
begin
  select id into tid from pg_temp.ed where label = p_token;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp_of(text, text) to authenticated, service_role;

select tests.authenticate_as('ed_viewer');
select throws_ok(
  format('select public.set_payment_end(%L, %L)', pg_temp.id('rent:2609'), current_date + 30),
  '42501', 'forbidden', 'set_payment_end refuses a viewer'
);
reset role;
select pg_temp.as_mcp_of('ed_viewer', 'viewer_write');
select is(
  public.mcp_set_line_end_date('ed-v-1', pg_temp.id('rent:2609'), current_date + 30) -> 'error' ->> 'code',
  'forbidden',
  'set_line_end_date refuses a viewer'
);
reset role;
select tests.authenticate_as('ed_owner');
select throws_ok(
  format('select public.set_payment_end(%L, %L)', pg_temp.id('b_line'), current_date + 30),
  'P0001', 'transaction not found', 'set_payment_end refuses another company''s line'
);
select throws_ok(
  format('select public.set_payment_end(%L, %L, %L)', pg_temp.id('rent:2609'), current_date + 30, pg_temp.id('b_proj')),
  'P0001', 'validation', 'set_payment_end refuses another company''s project'
);
reset role;
select pg_temp.as_mcp();
select is(
  public.mcp_set_line_end_date('ed-b-1', pg_temp.id('b_line'), current_date + 30) -> 'error',
  jsonb_build_object('code', 'refused', 'message', 'transaction not found'),
  'set_line_end_date refuses another company''s line'
);
select is(
  public.mcp_set_line_end_date('ed-b-2', pg_temp.id('rent:2609'), current_date + 30, pg_temp.id('b_proj')) -> 'error' ->> 'code',
  'refused',
  'set_line_end_date refuses another company''s project'
);
reset role;
select is(
  (select count(*) from public.recurring_overrides where company_id in (pg_temp.id('co'), pg_temp.id('co_b')))::integer,
  0,
  'and none of the refused writes stored an end date'
);
-- The positive control: the owner's own line and charge, through the MCP.
select pg_temp.as_mcp();
select is(
  public.mcp_set_line_end_date('ed-own-1', pg_temp.id('rent:2609'), current_date + 30) -> 'data' ->> 'ends_on',
  (current_date + 30)::text,
  'the owner sets the end date of their own line''s charge'
);
reset role;

select * from finish();

rollback;
