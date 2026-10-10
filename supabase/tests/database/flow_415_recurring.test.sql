-- FLOW-415, server part (decision 0172). Recurring charges: missing bills name their project,
-- category and last bill; recurring_changes finds this month's charges 20% or more off usual;
-- the owner's switch (set_payment_recurring) wins over the automatic rule; the MCP's switch has
-- its idempotency key and undo. Invented data only. Amounts are agorot. "Today" is 2026-10-20.

begin;

select plan(36);

do $users$
begin
  perform tests.create_supabase_user('rc_owner', 'rc-owner@example.com');
  perform tests.create_supabase_user('rc_other', 'rc-other@example.com');
  perform tests.create_supabase_user('rc_none', 'rc-none@example.com');
end
$users$;

create temp table rc (label text primary key, id uuid);
grant all on rc to authenticated, service_role;

insert into rc (label, id) values
  ('co', tests.fixture_company('rc_owner', 'Example Recurring LLC')),
  ('co_b', tests.fixture_company('rc_other', 'Example Other LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.rc where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into rc (label, id) values
  ('harbor', tests.fixture_project(pg_temp.id('co'), 'Harbor')),
  ('power_cat', tests.fixture_category(pg_temp.id('co'), 'Example Power Cost')),
  ('water_cat', tests.fixture_category(pg_temp.id('co'), 'Example Water Cost'));

insert into public.suppliers (company_id, name)
select pg_temp.id('co'), n
from unnest(array['Example Power', 'Example Water', 'Example Steady', 'Example Drop', 'Example New']) n;
insert into rc (label, id)
select case s.name
    when 'Example Power' then 'power' when 'Example Water' then 'water' when 'Example Steady' then 'steady'
    when 'Example Drop' then 'drop' else 'new' end, s.id
from public.suppliers s where s.company_id = pg_temp.id('co');

-- label, supplier, date, amount, project, category
create temp table rc_lines (label text, party text, doc_date date, amount bigint, project text, category text);
insert into rc_lines
select 'power_' || to_char(d, 'MM'), 'power', (d::date + 3), 185000, 'harbor', 'power_cat'
from generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;
insert into rc_lines values ('power_10', 'power', '2026-10-04', 255300, 'harbor', 'power_cat');
insert into rc_lines
select 'water_' || to_char(d, 'MM'), 'water', (d::date + 1), 48000, 'harbor', 'water_cat'
from generate_series('2026-06-01'::date, '2026-09-01'::date, interval '1 month') d;
insert into rc_lines
select 'steady_' || to_char(d, 'MM'), 'steady', (d::date + 9), case when d = '2026-10-01' then 11000 else 10000 end, null, null
from generate_series('2026-07-01'::date, '2026-10-01'::date, interval '1 month') d;
insert into rc_lines
select 'drop_' || to_char(d, 'MM'), 'drop', (d::date + 9), case when d = '2026-10-01' then 7000 else 10000 end, null, null
from generate_series('2026-07-01'::date, '2026-10-01'::date, interval '1 month') d;
insert into rc_lines values ('new_10', 'new', '2026-10-15', 5000, null, null);
insert into rc_lines values ('loose_10', null, '2026-10-16', 3000, null, null);

insert into rc (label, id)
select l.label, tests.fixture_line(
  pg_temp.id('co'), 'rc:' || l.label, l.amount, 'expense',
  case when l.project is null then null else pg_temp.id(l.project) end,
  case when l.category is null then null else pg_temp.id(l.category) end,
  l.doc_date, p_pnl_role => case when l.project is null then null else 'project' end
)
from rc_lines l;
update public.transactions t
set supplier_id = pg_temp.id(l.party)
from rc_lines l
where t.id = pg_temp.id(l.label) and l.party is not null;

-- 1-4. Missing bills on the 20th: water (usually the 2nd) has not come in.
select tests.authenticate_as('rc_owner');
select is(
  (select jsonb_agg(e ->> 'supplier_name') from jsonb_array_elements(public.missing_bills('2026-10-20')) e),
  '["Example Water"]'::jsonb,
  'water is the one bill that did not come in'
);
select is(
  (select e - 'supplier_id' - 'project_id' - 'category_id' from jsonb_array_elements(public.missing_bills('2026-10-20')) e),
  jsonb_build_object(
    'supplier_name', 'Example Water', 'currency', 'ILS', 'typical_amount_minor', -48000, 'typical_day', 2,
    'expected_by', '2026-10-07', 'months_seen', 4, 'last_doc_date', '2026-09-02', 'last_amount_minor', -48000,
    'project_name', 'Harbor', 'category_name', 'Example Water Cost', 'source', 'auto'
  ),
  'a missing bill names its project and category, and its last bill''s date and amount'
);
select is(
  (select e ->> 'project_id' from jsonb_array_elements(public.missing_bills('2026-10-20')) e)::uuid,
  pg_temp.id('harbor'),
  'and keeps the ids'
);
select is(public.missing_bills('2026-10-05'), '[]'::jsonb, 'on the 5th it is not late yet');

-- 5-9. Changes this month.
select is(
  (select jsonb_agg(e ->> 'supplier_name' order by ord) from jsonb_array_elements(public.recurring_changes('2026-10-20')) with ordinality x(e, ord)),
  '["Example Power", "Example Drop"]'::jsonb,
  'power (38% up) and drop (30% down) changed; steady (10%) did not; largest first'
);
select is(
  (select e - 'supplier_id' - 'project_id' - 'category_id' - 'transaction_id'
   from jsonb_array_elements(public.recurring_changes('2026-10-20')) e where e ->> 'supplier_name' = 'Example Power'),
  jsonb_build_object(
    'supplier_name', 'Example Power', 'currency', 'ILS', 'amount_minor', -255300, 'typical_amount_minor', -185000,
    'change_percent', 38, 'typical_day', 4, 'project_name', 'Harbor', 'category_name', 'Example Power Cost',
    'source', 'auto'
  ),
  'a change has both amounts, the percent and the usual project and category'
);
select is(
  (select (e ->> 'transaction_id')::uuid from jsonb_array_elements(public.recurring_changes('2026-10-20')) e
   where e ->> 'supplier_name' = 'Example Power'),
  pg_temp.id('power_10'),
  'and names this month''s line'
);
select is(
  (select (e ->> 'change_percent')::integer from jsonb_array_elements(public.recurring_changes('2026-10-20')) e
   where e ->> 'supplier_name' = 'Example Drop'),
  -30,
  'a drop is a negative percent'
);
select is(public.recurring_changes('2026-10-03'), '[]'::jsonb, 'before this month''s charges came in there is none');

-- 10-13. One payment's switch, read.
select is(
  public.payment_recurring(pg_temp.id('power_10'), '2026-10-20') - 'party' - 'transaction_id',
  jsonb_build_object('recurring', true, 'override', null, 'detected', true, 'typical_day', 4, 'typical_amount_minor', -185000),
  'power is recurring by the rule'
);
select is(
  public.payment_recurring(pg_temp.id('power_10'), '2026-10-20') -> 'party',
  jsonb_build_object('direction', 'expense', 'id', pg_temp.id('power'), 'name', 'Example Power', 'currency', 'ILS'),
  'the switch is the supplier''s, in the line''s currency'
);
select is(
  public.payment_recurring(pg_temp.id('new_10'), '2026-10-20') - 'party' - 'transaction_id',
  jsonb_build_object('recurring', false, 'override', null, 'detected', false, 'typical_day', null, 'typical_amount_minor', null),
  'a supplier seen once is not recurring'
);
select is(
  public.payment_recurring(pg_temp.id('loose_10'), '2026-10-20') ->> 'party',
  null,
  'a line with no supplier has no switch'
);

-- 14-21. The owner's switch wins.
select is(
  public.set_payment_recurring(pg_temp.id('power_10'), false) -> 'prior_override',
  'null'::jsonb,
  'the owner turns power off; it was automatic'
);
select is(
  public.payment_recurring(pg_temp.id('power_04'), '2026-10-20') - 'party' - 'transaction_id' - 'typical_day' - 'typical_amount_minor',
  jsonb_build_object('recurring', false, 'override', false, 'detected', true),
  'every power payment says so, and the rule still detects it'
);
select is(
  (select jsonb_agg(e ->> 'supplier_name') from jsonb_array_elements(public.recurring_changes('2026-10-20')) e),
  '["Example Drop"]'::jsonb,
  'power leaves the changes'
);
select is(
  public.set_payment_recurring(pg_temp.id('new_10'), true) -> 'override',
  'true'::jsonb,
  'the owner marks a new supplier recurring'
);
select is(
  public.payment_recurring(pg_temp.id('new_10'), '2026-10-20') - 'party' - 'transaction_id',
  jsonb_build_object('recurring', true, 'override', true, 'detected', false, 'typical_day', 15, 'typical_amount_minor', -5000),
  'its usual day and amount come from its one month'
);
select is(
  (select e ->> 'source' from jsonb_array_elements(public.expected_months(3, null, '2026-10-20') -> 'recurring') e
   where (e ->> 'party_id')::uuid = pg_temp.id('new')),
  'user',
  'expected months count it, marked as the owner''s'
);
select is(
  public.set_payment_recurring(pg_temp.id('power_10'), null) -> 'prior_override',
  'false'::jsonb,
  'null goes back to the rule, and says what it was'
);
select is(
  (select count(*)::integer from jsonb_array_elements(public.recurring_changes('2026-10-20')) e
   where e ->> 'supplier_name' = 'Example Power'),
  1,
  'power is back in the changes'
);

-- 22-23. Lines with no switch, and a company's lines from another.
select throws_ok(
  format('select public.set_payment_recurring(%L, true)', pg_temp.id('loose_10')),
  'P0001', 'no supplier or customer',
  'a line with no supplier cannot be marked'
);
select tests.authenticate_as('rc_other');
select throws_ok(
  format('select public.payment_recurring(%L)', pg_temp.id('power_10')),
  'P0001', 'transaction not found',
  'another company does not read the switch'
);

-- 24-25.
select throws_ok(
  format('select public.set_payment_recurring(%L, false)', pg_temp.id('power_10')),
  'P0001', 'transaction not found',
  'nor write it'
);
select tests.authenticate_as('rc_none');
select throws_ok(
  format('select public.set_payment_recurring(%L, false)', pg_temp.id('power_10')),
  'P0001', 'no company',
  'a user without a company writes nothing'
);

-- 26-33. The MCP's switch.
select tests.clear_authentication();
reset role;
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('rc_owner'), pg_temp.id('co'), 'hash-rc-write', 'kid', array['write']::text[], '2099-01-01');
insert into rc (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-rc-write';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('rc_owner');
  tid uuid;
begin
  select id into tid from pg_temp.rc where label = 'write';
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
  (public.mcp_set_line_recurring('rc-1', pg_temp.id('water_09'), false) -> 'data') - 'party' - 'transaction_id' - 'write_id'
    - 'typical_day' - 'typical_amount_minor' - 'detected',
  jsonb_build_object('recurring', false, 'override', false, 'undo_kind', 'line_recurring', 'id', pg_temp.id('water_09')),
  'set_line_recurring turns water off'
);
reset role;
select is(
  (select recurring from public.recurring_overrides where party_id = pg_temp.id('water')),
  false,
  'the switch is written'
);
select pg_temp.as_mcp();
select is(
  public.mcp_set_line_recurring('rc-1', pg_temp.id('water_09'), false) -> 'data' ->> 'undo_kind',
  'line_recurring',
  'the same key replays'
);
select is(
  public.mcp_set_line_recurring('rc-1', pg_temp.id('water_09'), true) -> 'error' ->> 'code',
  'conflict',
  'the same key with other arguments is a conflict'
);
select is(
  public.mcp_undo('rc-undo-1', 'line_recurring', pg_temp.id('water_09')) ->> 'ok',
  'true',
  'undo line_recurring'
);
reset role;
select is(
  (select count(*)::integer from public.recurring_overrides where party_id = pg_temp.id('water')),
  0,
  'water is back on the rule'
);
select pg_temp.as_mcp();
select is(
  public.mcp_set_line_recurring('rc-2', '00000000-0000-4000-8000-000000000000', true) -> 'error' ->> 'code',
  'refused',
  'an unknown line is refused'
);
select is(
  public.mcp_set_line_recurring('rc-3', pg_temp.id('loose_10'), true) -> 'error' ->> 'code',
  'refused',
  'a line with no supplier is refused'
);

-- 34. A switch changed since the write is a conflict.
select public.mcp_set_line_recurring('rc-4', pg_temp.id('water_08'), true);
reset role;
update public.recurring_overrides set recurring = false where party_id = pg_temp.id('water');
select pg_temp.as_mcp();
select is(
  public.mcp_undo('rc-undo-2', 'line_recurring', pg_temp.id('water_08')) -> 'error' ->> 'code',
  'conflict',
  'undo of a switch changed since is a conflict'
);

-- 35-36. Who may call what.
reset role;
select ok(
  not has_function_privilege('anon', 'public.recurring_changes(date)', 'execute')
  and not has_function_privilege('anon', 'public.payment_recurring(uuid, date)', 'execute')
  and not has_function_privilege('anon', 'public.set_payment_recurring(uuid, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.mcp_set_line_recurring(text, uuid, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'private.recurring_parties(uuid, date, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'private.payment_party(uuid, uuid)', 'execute'),
  'anon calls none of them; the private parts are not callable'
);
select ok(
  not has_table_privilege('authenticated', 'public.recurring_overrides', 'select')
  and not has_table_privilege('anon', 'public.recurring_overrides', 'select'),
  'the switches are read only through the functions'
);

select * from finish();
rollback;
