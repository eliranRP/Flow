-- FLOW-1037 (decision 0255). A recurring charge that moves to another payee: expected_months' handover
-- leaves it out of this month, missing_bills does not call it late, and the owner's answer
-- (answer_recurring_handover, mcp_answer_recurring_handover and its undo) ends the old charge and makes
-- the new one recurring, or brings the old one back. Invented data only. Amounts are agorot. "Today" is
-- 2026-10-20.

begin;

select plan(41);

do $users$
begin
  perform tests.create_supabase_user('rh_owner', 'rh-owner@example.com');
  perform tests.create_supabase_user('rh_viewer', 'rh-viewer@example.com');
  perform tests.create_supabase_user('rh_outsider', 'rh-outsider@example.com');
end
$users$;

create temp table rh (label text primary key, id uuid);
grant all on rh to authenticated, service_role;

insert into rh (label, id) values
  ('co', tests.fixture_company('rh_owner', 'Example Handover LLC')),
  ('other_co', tests.fixture_company('rh_outsider', 'Example Outside LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.rh where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into rh (label, id) values
  ('maple', tests.fixture_project(pg_temp.id('co'), 'Maple House')),
  ('cedar', tests.fixture_project(pg_temp.id('co'), 'Cedar Lot')),
  ('aspen', tests.fixture_project(pg_temp.id('co'), 'Aspen Court')),
  ('larch', tests.fixture_project(pg_temp.id('co'), 'Larch Row')),
  ('birch', tests.fixture_project(pg_temp.id('co'), 'Birch Yard')),
  ('fees', tests.fixture_category(pg_temp.id('co'), 'Service fees')),
  ('utilities', tests.fixture_category(pg_temp.id('co'), 'Utilities'));
insert into public.company_members (company_id, user_id, role)
values (pg_temp.id('co'), tests.get_supabase_uid('rh_viewer'), 'viewer');

-- northgate: the old servicer, Maple's loan since April. summit: the new one, a different name, already
-- paying Cedar's loan; this month it paid Maple's at the usual amount. bayview: Maple, 3% off. harbor:
-- the usual amount, on Cedar. pine: the usual amount on Maple, but it paid Maple in August too.
insert into public.suppliers (company_id, name)
select pg_temp.id('co'), n
from unnest(array['Northgate Servicing', 'Summit Loan Care', 'Bayview Lending', 'Harbor Mortgage', 'Pine Credit',
  'Willow Power', 'Juniper Grid', 'Spruce Gas', 'Hazel Energy', 'Oakline Services', 'Rowan Utility']) n;
insert into rh (label, id)
select lower(split_part(s.name, ' ', 1)), s.id
from public.suppliers s where s.company_id = pg_temp.id('co');

-- label, party, project, date, amount
create temp table rh_lines (label text, party text, project text, doc_date date, amount bigint);
insert into rh_lines
select 'northgate_' || to_char(d, 'MM'), 'northgate', 'maple', d::date + 4, 250000
from generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;
insert into rh_lines
select 'summit_cedar_' || to_char(d, 'MM'), 'summit', 'cedar', d::date + 6, 180000
from generate_series('2026-04-01'::date, '2026-10-01'::date, interval '1 month') d;
insert into rh_lines values
  ('summit_maple_10', 'summit', 'maple', '2026-10-05', 249000),
  ('bayview_10', 'bayview', 'maple', '2026-10-06', 257500),
  ('harbor_10', 'harbor', 'cedar', '2026-10-07', 250000),
  ('pine_08', 'pine', 'maple', '2026-08-12', 40000),
  ('pine_10', 'pine', 'maple', '2026-10-08', 250000);

-- In USD, apart from the ILS figures above. willow: Aspen's monthly charge; juniper's October line has no
-- project of its own and is split, its part on Aspen at the usual amount. spruce: Larch's monthly charge;
-- hazel paid Larch at the usual amount in October, but its August line, with no project, had a part on Larch.
-- oakline: Birch's quarterly charge (January, April, July); rowan paid Birch at the usual amount in October.
create temp table rh_usd (label text, party text, project text, doc_date date, amount bigint);
insert into rh_usd
select p || '_' || to_char(d, 'MM'), p, case p when 'willow' then 'aspen' else 'larch' end, d::date + 2,
  case p when 'willow' then 100000 else 70000 end
from unnest(array['willow', 'spruce']) p,
  generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;
insert into rh_usd values
  ('juniper_10', 'juniper', null, '2026-10-09', 150000),
  ('hazel_08', 'hazel', null, '2026-08-14', 50000),
  ('hazel_10', 'hazel', 'larch', '2026-10-10', 70000),
  ('oakline_01', 'oakline', 'birch', '2026-01-12', 300000),
  ('oakline_04', 'oakline', 'birch', '2026-04-12', 300000),
  ('oakline_07', 'oakline', 'birch', '2026-07-12', 300000),
  ('rowan_10', 'rowan', 'birch', '2026-10-11', 300000);
insert into rh (label, id)
select l.label, tests.fixture_line(pg_temp.id('co'), 'rh:' || l.label, l.amount, 'expense', pg_temp.id(l.project),
  pg_temp.id('utilities'), l.doc_date, 'USD')
from rh_usd l;
update public.transactions t
set supplier_id = pg_temp.id(l.party)
from rh_usd l
where t.id = pg_temp.id(l.label);
select tests.line_split(pg_temp.id('juniper_10'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.id('utilities'), 'project_id', pg_temp.id('aspen'), 'amount_minor', 100000),
  jsonb_build_object('category_id', pg_temp.id('fees'), 'project_id', pg_temp.id('cedar'), 'amount_minor', 50000)));
select tests.line_split(pg_temp.id('hazel_08'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.id('utilities'), 'project_id', pg_temp.id('larch'), 'amount_minor', 30000),
  jsonb_build_object('category_id', pg_temp.id('fees'), 'project_id', pg_temp.id('cedar'), 'amount_minor', 20000)));

insert into rh (label, id)
select l.label, tests.fixture_line(pg_temp.id('co'), 'rh:' || l.label, l.amount, 'expense', pg_temp.id(l.project),
  null, l.doc_date)
from rh_lines l;
update public.transactions t
set supplier_id = pg_temp.id(l.party)
from rh_lines l
where t.id = pg_temp.id(l.label);

-- The old servicer is also marked recurring party-wide: the charge's own "not recurring" must still win.
insert into public.recurring_overrides (company_id, direction, party_id, currency, project_id, recurring)
values (pg_temp.id('co'), 'expense', pg_temp.id('northgate'), 'ILS', null, true);

create or replace function pg_temp.item(p_party text, p_project text)
returns jsonb
language sql
as $$
  select e from jsonb_array_elements(public.expected_months(2, null, '2026-10-20') -> 'recurring') e
  where (e ->> 'party_id')::uuid = pg_temp.id(p_party) and (e ->> 'project_id')::uuid = pg_temp.id(p_project);
$$;
grant execute on function pg_temp.item(text, text) to authenticated, service_role;

-- This month's expected ILS expense in expected_months' cells.
create or replace function pg_temp.open_expense()
returns bigint
language sql
as $$
  select coalesce(sum((c ->> 'expense_minor')::bigint), 0)::bigint
  from jsonb_array_elements(public.expected_months(2, null, '2026-10-20') -> 'months') m,
    jsonb_array_elements(m -> 'by_currency') c
  where (m ->> 'open')::boolean and c ->> 'currency' = 'ILS';
$$;
grant execute on function pg_temp.open_expense() to authenticated, service_role;

create or replace function pg_temp.late(p_party text)
returns boolean
language sql
as $$
  select exists (select 1 from jsonb_array_elements(public.missing_bills('2026-10-20')) e
    where (e ->> 'party_id')::uuid = pg_temp.id(p_party));
$$;
grant execute on function pg_temp.late(text) to authenticated, service_role;

create or replace function pg_temp.own_override(p_party text, p_project text default 'maple')
returns boolean
language sql
as $$
  select o.recurring from public.recurring_overrides o
  where o.company_id = pg_temp.id('co') and o.party_id = pg_temp.id(p_party) and o.project_id = pg_temp.id(p_project);
$$;

-- 1-4. The handover is offered and leaves the forecast.
select tests.authenticate_as('rh_owner');
select is(
  pg_temp.item('northgate', 'maple') -> 'handover',
  jsonb_build_object('party_id', pg_temp.id('summit'), 'party_name', 'Summit Loan Care',
    'transaction_id', pg_temp.id('summit_maple_10'), 'doc_date', '2026-10-05', 'amount_minor', -249000),
  'the old servicer''s charge names the new servicer''s payment on the same project and amount'
);
select is(
  pg_temp.open_expense(),
  0::bigint,
  'this month''s cells no longer expect the old charge'
);
select is(
  (select sum((c ->> 'expense_minor')::bigint)::bigint from jsonb_array_elements(public.expected_months(2, null, '2026-10-20') -> 'months') m,
     jsonb_array_elements(m -> 'by_currency') c where not (m ->> 'open')::boolean and c ->> 'currency' = 'ILS'),
  -430000::bigint,
  'unanswered, next month still expects the old charge (and the new servicer''s other loan)'
);
select is(pg_temp.late('northgate'), false, 'missing_bills does not call the handed-over charge late');

-- 5-9. No brings the old charge back and stops the pair; nothing else is offered.
select is(
  public.answer_recurring_handover('expense', pg_temp.id('northgate'), 'ILS', pg_temp.id('maple'), pg_temp.id('summit'), false)
    - 'direction'::text - 'party_id'::text - 'currency'::text - 'project_id'::text - 'to_party_id'::text - 'answer_set_at'::text,
  '{"same": false, "prior_same": null, "prior_from_recurring": null, "prior_to_recurring": null, "prior_to_pace": null}'::jsonb,
  'the owner says no'
);
select is(
  pg_temp.item('northgate', 'maple') -> 'handover',
  'null'::jsonb,
  'after no, the pair is not offered, and a payee 3% off, on another project or with earlier lines on it never is'
);
select is(pg_temp.open_expense(), -250000::bigint, 'after no, the old charge counts again this month');
select is(pg_temp.late('northgate'), true, 'after no, the old charge is late again');
select is(
  public.answer_recurring_handover('expense', pg_temp.id('northgate'), 'ILS', pg_temp.id('maple'), pg_temp.id('summit'), null)
    ->> 'prior_same',
  'false',
  'taking the answer back names the answer before'
);

-- 10-15. Yes ends the old charge (its own row wins over the party-wide "recurring") and makes the new one recurring.
select is(
  pg_temp.item('northgate', 'maple') -> 'handover' ->> 'party_name',
  'Summit Loan Care',
  'taken back, the handover is offered again'
);
select is(
  public.answer_recurring_handover('expense', pg_temp.id('northgate'), 'ILS', pg_temp.id('maple'), pg_temp.id('summit'), true)
    - 'direction'::text - 'party_id'::text - 'currency'::text - 'project_id'::text - 'to_party_id'::text - 'answer_set_at'::text,
  '{"same": true, "prior_same": null, "prior_from_recurring": null, "prior_to_recurring": null, "prior_to_pace": null}'::jsonb,
  'the owner says yes'
);
select is(pg_temp.item('northgate', 'maple'), null, 'yes ends the old charge, though the party is marked recurring');
select is(
  (pg_temp.item('summit', 'maple') ->> 'seen_this_month')::boolean,
  true,
  'yes makes the new servicer''s charge on the project recurring, seen this month'
);
select is(pg_temp.late('northgate'), false, 'after yes, nothing is late');
reset role;
select is(
  array[pg_temp.own_override('northgate'), pg_temp.own_override('summit')],
  array[false, true],
  'yes writes the two per-charge overrides'
);

-- 16-17. Taking a yes back puts both overrides back as they were (the new charge had its own "not recurring").
select tests.authenticate_as('rh_owner');
select public.answer_recurring_handover('expense', pg_temp.id('northgate'), 'ILS', pg_temp.id('maple'), pg_temp.id('summit'), null);
reset role;
insert into public.recurring_overrides (company_id, direction, party_id, currency, project_id, recurring)
values (pg_temp.id('co'), 'expense', pg_temp.id('summit'), 'ILS', pg_temp.id('maple'), false);
select tests.authenticate_as('rh_owner');
select public.answer_recurring_handover('expense', pg_temp.id('northgate'), 'ILS', pg_temp.id('maple'), pg_temp.id('summit'), true);
select is(
  public.answer_recurring_handover('expense', pg_temp.id('northgate'), 'ILS', pg_temp.id('maple'), pg_temp.id('summit'), null)
    - 'direction'::text - 'party_id'::text - 'currency'::text - 'project_id'::text - 'to_party_id'::text - 'answer_set_at'::text,
  '{"same": null, "prior_same": true, "prior_from_recurring": false, "prior_to_recurring": true, "prior_to_pace": null}'::jsonb,
  'taking the yes back names the answer and the overrides it replaces'
);
reset role;
select is(
  array[pg_temp.own_override('northgate'), pg_temp.own_override('summit')],
  array[null, false]::boolean[],
  'taken back, the old charge has no own override again and the new one is back to not recurring'
);

-- 18-21. The MCP's yes, and its undo restores both overrides.
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('rh_owner'), pg_temp.id('co'), 'hash-rh-write', 'kid', array['write']::text[], '2099-01-01');
insert into rh (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-rh-write';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('rh_owner');
  tid uuid;
begin
  select id into tid from pg_temp.rh where label = 'write';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

create temp table rh_out (label text primary key, body jsonb);
grant all on rh_out to authenticated, service_role;

select pg_temp.as_mcp();
insert into rh_out
values ('yes', public.mcp_answer_recurring_handover('rh-1', 'expense', pg_temp.id('northgate'), 'ILS',
  pg_temp.id('maple'), pg_temp.id('summit'), true));
select is(
  (select body -> 'data' ->> 'undo_kind' from rh_out where label = 'yes'),
  'recurring_handover',
  'the MCP says yes with an undo'
);
select is(
  public.mcp_answer_recurring_handover('rh-1', 'expense', pg_temp.id('northgate'), 'ILS',
    pg_temp.id('maple'), pg_temp.id('summit'), true),
  (select body from rh_out where label = 'yes'),
  'the same key replays the same answer'
);
select is(
  public.mcp_undo('rh-undo-1', 'recurring_handover', (select (body -> 'data' ->> 'id')::uuid from rh_out where label = 'yes')) ->> 'ok',
  'true',
  'undo recurring_handover'
);
reset role;
select is(
  array[pg_temp.own_override('northgate'), pg_temp.own_override('summit')]
    || array[(select count(*) = 0 from public.recurring_handovers where company_id = pg_temp.id('co'))],
  array[null, false, true]::boolean[],
  'the undo takes the answer back and restores both overrides'
);

-- 22-29. The undo is a conflict once the pair was answered again; a yes then a no restores both overrides.
create or replace function pg_temp.mcp_answer(p_key text, p_same boolean)
returns jsonb
language sql
as $$
  select public.mcp_answer_recurring_handover(p_key, 'expense', pg_temp.id('northgate'), 'ILS',
    pg_temp.id('maple'), pg_temp.id('summit'), p_same);
$$;
grant execute on function pg_temp.mcp_answer(text, boolean) to authenticated, service_role;

select pg_temp.as_mcp();
insert into rh_out values
  ('w1', pg_temp.mcp_answer('rh-w1', true)),
  ('w2', pg_temp.mcp_answer('rh-w2', true));
create or replace function pg_temp.write_of(p_label text)
returns uuid
language sql
as $$ select (body -> 'data' ->> 'id')::uuid from pg_temp.rh_out where label = p_label; $$;
grant execute on function pg_temp.write_of(text) to authenticated, service_role;
select is(
  public.mcp_undo('rh-undo-w1', 'recurring_handover', pg_temp.write_of('w1')) -> 'error' ->> 'code',
  'conflict',
  'a yes answered yes again: undoing the first is a conflict'
);
select is(
  public.mcp_undo('rh-undo-w2', 'recurring_handover', pg_temp.write_of('w2')) ->> 'ok',
  'true',
  'undoing the latest yes goes through'
);
insert into rh_out values
  ('w3', pg_temp.mcp_answer('rh-w3', false)),
  ('w4', pg_temp.mcp_answer('rh-w4', true));
select is(
  public.mcp_undo('rh-undo-w1b', 'recurring_handover', pg_temp.write_of('w1')) -> 'error' ->> 'code',
  'conflict',
  'yes, then no, then yes: undoing the first yes is a conflict'
);
select is(
  public.mcp_undo('rh-undo-w4', 'recurring_handover', pg_temp.write_of('w4')) ->> 'ok',
  'true',
  'undoing the last yes puts the no back'
);
reset role;
select is(
  array[pg_temp.own_override('northgate'), pg_temp.own_override('summit')]
    || array[(select same from public.recurring_handovers where company_id = pg_temp.id('co'))],
  array[null, false, false]::boolean[],
  'back at no, both overrides are as before the yes'
);
select tests.authenticate_as('rh_owner');
select public.answer_recurring_handover('expense', pg_temp.id('northgate'), 'ILS', pg_temp.id('maple'), pg_temp.id('summit'), null);
select public.answer_recurring_handover('expense', pg_temp.id('northgate'), 'ILS', pg_temp.id('maple'), pg_temp.id('summit'), true);
select is(
  public.answer_recurring_handover('expense', pg_temp.id('northgate'), 'ILS', pg_temp.id('maple'), pg_temp.id('summit'), false)
    ->> 'prior_same',
  'true',
  'the owner says yes, then no'
);
reset role;
select is(
  array[pg_temp.own_override('northgate'), pg_temp.own_override('summit')],
  array[null, false]::boolean[],
  'a yes then a no restores both overrides'
);
select tests.authenticate_as('rh_owner');
select is(
  public.answer_recurring_handover('expense', pg_temp.id('northgate'), 'ILS', pg_temp.id('maple'), pg_temp.id('summit'), null)
    ->> 'answer_set_at',
  null,
  'taken back, there is no answer and no set_at'
);

-- 30-32. Lines are read by their parts: a split line's part on the project is a candidate, and an earlier
-- part on the project counts as an earlier line.
select is(
  pg_temp.item('willow', 'aspen') -> 'handover',
  jsonb_build_object('party_id', pg_temp.id('juniper'), 'party_name', 'Juniper Grid',
    'transaction_id', pg_temp.id('juniper_10'), 'doc_date', '2026-10-09', 'amount_minor', -100000),
  'a split line''s part on the charge''s project, at the usual amount, is offered with the part''s amount'
);
select is(
  pg_temp.item('spruce', 'larch') -> 'handover',
  'null'::jsonb,
  'a payee whose earlier line had a part on the project is not offered'
);
select is(
  (select count(*)::integer from jsonb_array_elements(public.expected_months(2, null, '2026-10-20') -> 'months') m,
     jsonb_array_elements(m -> 'by_currency') c
   where (m ->> 'open')::boolean and c ->> 'currency' = 'USD' and (c ->> 'expense_minor')::bigint = -70000),
  1,
  'this month''s USD cells expect the charge with no handover only'
);

-- 33-36. A quarterly charge handed over stays quarterly, and taking the answer back restores the pace.
select is(
  public.answer_recurring_handover('expense', pg_temp.id('oakline'), 'USD', pg_temp.id('birch'), pg_temp.id('rowan'), true,
    '2026-10-20') ->> 'prior_to_pace',
  null,
  'the owner says yes to the quarterly charge''s handover'
);
select is(
  (select jsonb_build_object('pace', e ->> 'pace', 'next', e ->> 'next_due_month')
   from jsonb_array_elements(public.expected_months(4, null, '2026-10-20') -> 'recurring') e
   where (e ->> 'party_id')::uuid = pg_temp.id('rowan')),
  '{"pace": "quarter", "next": "2027-01"}'::jsonb,
  'the new payee''s charge is quarterly, next due in January'
);
reset role;
select is(
  (select o.pace from public.recurring_overrides o
   where o.company_id = pg_temp.id('co') and o.party_id = pg_temp.id('rowan') and o.project_id = pg_temp.id('birch')),
  'quarter',
  'the yes wrote the new charge''s pace'
);
select tests.authenticate_as('rh_owner');
select public.answer_recurring_handover('expense', pg_temp.id('oakline'), 'USD', pg_temp.id('birch'), pg_temp.id('rowan'), null);
reset role;
select is(
  (select count(*)::integer from public.recurring_overrides o
   where o.company_id = pg_temp.id('co') and o.project_id = pg_temp.id('birch')),
  0,
  'taken back, neither charge on the project keeps an override'
);

-- 37-40. Who may answer, and another company's charge.
select tests.authenticate_as('rh_viewer');
select throws_ok(
  format('select public.answer_recurring_handover(%L, %L, %L, %L, %L, true)', 'expense', pg_temp.id('northgate'), 'ILS',
    pg_temp.id('maple'), pg_temp.id('summit')),
  '42501', 'forbidden',
  'a viewer is refused'
);
select tests.authenticate_as('rh_outsider');
select throws_ok(
  format('select public.answer_recurring_handover(%L, %L, %L, %L, %L, true)', 'expense', pg_temp.id('northgate'), 'ILS',
    pg_temp.id('maple'), pg_temp.id('summit')),
  'party not found',
  'another company''s owner cannot reach the charge'
);
select is(
  (select count(*)::integer from jsonb_array_elements(public.expected_months(2, null, '2026-10-20') -> 'recurring') e
   where e -> 'handover' <> 'null'::jsonb),
  0,
  'another company sees no handover of this one'
);
select tests.authenticate_as('rh_owner');
select throws_ok(
  format('select public.answer_recurring_handover(%L, %L, %L, %L, %L, true)', 'expense', pg_temp.id('northgate'), 'ILS',
    null, pg_temp.id('summit')),
  'validation',
  'a charge with no project has no handover to answer'
);

-- 41. The answers are read and written only through the functions.
select tests.clear_authentication();
reset role;
select ok(
  not has_table_privilege('authenticated', 'public.recurring_handovers', 'select')
  and not has_function_privilege('anon', 'public.answer_recurring_handover(text, uuid, text, uuid, uuid, boolean, date)', 'execute')
  and not has_function_privilege('anon', 'public.mcp_answer_recurring_handover(text, text, uuid, text, uuid, uuid, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'private.recurring_handover(uuid, public.txn_direction, uuid, text, uuid, bigint, date)', 'execute'),
  'the answers are read and written only through the functions'
);

select * from finish();
rollback;
