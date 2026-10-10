-- FLOW-415, server PR 2 (decision 0175). A recurring charge's pace (detected, and the owner's
-- set_payment_pace), recurring income, הגיעו החודש, and per-user dismissals of the alerts.
-- Invented data only. Amounts are agorot. "Today" is 2026-10-20.

begin;

select plan(34);

do $users$
begin
  perform tests.create_supabase_user('rp_owner', 'rp-owner@example.com');
  perform tests.create_supabase_user('rp_editor', 'rp-editor@example.com');
end
$users$;

create temp table rp (label text primary key, id uuid);
grant all on rp to authenticated, service_role;

insert into rp (label, id) values ('co', tests.fixture_company('rp_owner', 'Example Pace LLC'));
insert into public.company_members (company_id, user_id, role)
values ((select id from rp where label = 'co'), tests.get_supabase_uid('rp_editor'), 'editor');

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.rp where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into public.suppliers (company_id, name)
select pg_temp.id('co'), n
from unnest(array['Example Power', 'Example Quarterly', 'Example Bimonthly', 'Example Yearly', 'Example Steady']) n;
insert into public.customers (company_id, name)
select pg_temp.id('co'), n from unnest(array['Example Tenant', 'Example Lessee']) n;
insert into rp (label, id)
select lower(replace(s.name, 'Example ', '')), s.id from public.suppliers s where s.company_id = pg_temp.id('co');
insert into rp (label, id)
select lower(replace(c.name, 'Example ', '')), c.id from public.customers c where c.company_id = pg_temp.id('co');

-- label, party, direction, date, amount
create temp table rp_lines (label text, party text, direction text, doc_date date, amount bigint);
insert into rp_lines
select 'power_' || to_char(d, 'MM'), 'power', 'expense', d::date + 3, case when d = '2026-10-01' then 255300 else 185000 end
from generate_series('2026-04-01'::date, '2026-10-01'::date, interval '1 month') d;
insert into rp_lines
select 'steady_' || to_char(d, 'MM'), 'steady', 'expense', d::date + 9, 10000
from generate_series('2026-07-01'::date, '2026-10-01'::date, interval '1 month') d;
insert into rp_lines values
  ('quarterly_01', 'quarterly', 'expense', '2026-01-05', 90000),
  ('quarterly_04', 'quarterly', 'expense', '2026-04-05', 90000),
  ('quarterly_07', 'quarterly', 'expense', '2026-07-05', 90000),
  ('bimonthly_05', 'bimonthly', 'expense', '2026-05-08', 30000),
  ('bimonthly_07', 'bimonthly', 'expense', '2026-07-08', 30000),
  ('bimonthly_09', 'bimonthly', 'expense', '2026-09-08', 30000),
  ('yearly_2024', 'yearly', 'expense', '2024-10-12', 120000),
  ('yearly_2025', 'yearly', 'expense', '2025-10-10', 130000);
insert into rp_lines
select 'tenant_' || to_char(d, 'MM'), 'tenant', 'income', d::date, case when d = '2026-10-01' then 500000 else 400000 end
from generate_series('2026-06-01'::date, '2026-10-01'::date, interval '1 month') d;
insert into rp_lines
select 'lessee_' || to_char(d, 'MM'), 'lessee', 'income', d::date + 2, 200000
from generate_series('2026-06-01'::date, '2026-09-01'::date, interval '1 month') d;

insert into rp (label, id)
select l.label, tests.fixture_line(
  pg_temp.id('co'), 'rp:' || l.label, l.amount, l.direction, null, null, l.doc_date,
  p_pnl_role => null, p_doc_kind => case when l.direction = 'income' then 'invoice' else 'receipt' end
)
from rp_lines l;
update public.transactions t
set supplier_id = case when l.direction = 'expense' then pg_temp.id(l.party) end,
  customer_id = case when l.direction = 'income' then pg_temp.id(l.party) end
from rp_lines l
where t.id = pg_temp.id(l.label);

create or replace function pg_temp.missing(p_today date default '2026-10-20')
returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(jsonb_build_array(e ->> 'party_name', e ->> 'direction', e ->> 'pace', e ->> 'due_month')
    order by e ->> 'party_name'), '[]'::jsonb)
  from jsonb_array_elements(public.missing_bills(p_today)) e;
$$;
grant execute on function pg_temp.missing(date) to authenticated, service_role;

-- 1-6. The detected pace and late bills, income included.
select tests.authenticate_as('rp_owner');
select is(
  pg_temp.missing(),
  '[["Example Lessee", "income", "month", "2026-10"],
    ["Example Quarterly", "expense", "quarter", "2026-10"],
    ["Example Yearly", "expense", "year", "2026-10"]]'::jsonb,
  'quarterly and yearly are due this month, and a monthly customer is late too; every 2 months is not due yet'
);
select is(
  (select e ->> 'expected_by' from jsonb_array_elements(public.missing_bills('2026-10-20')) e
   where e ->> 'party_name' = 'Example Quarterly'),
  '2026-10-10',
  'a quarterly bill is late after its usual day plus 5'
);
select is(
  (select e ->> 'alert_key' from jsonb_array_elements(public.missing_bills('2026-10-20')) e
   where e ->> 'party_name' = 'Example Lessee'),
  'income:' || pg_temp.id('lessee') || ':ILS:2026-10',
  'each late bill has its key: direction, party, currency and due month'
);
select is(
  (select e ->> 'party_name' from jsonb_array_elements(public.missing_bills('2026-11-20')) e
   where e ->> 'pace' = '2months'),
  'Example Bimonthly',
  'every 2 months is late in November'
);
select is(
  public.payment_recurring(pg_temp.id('bimonthly_09'), '2026-10-20') - 'party' - 'transaction_id',
  jsonb_build_object('recurring', true, 'override', null, 'detected', true, 'typical_day', 8,
    'typical_amount_minor', -30000, 'pace', '2months', 'pace_override', null, 'detected_pace', '2months',
    'next_due_month', '2026-11'),
  'a payment names its pace and next due month'
);
select is(
  public.payment_recurring(pg_temp.id('yearly_2025'), '2026-10-20') -> 'next_due_month',
  '"2026-10"'::jsonb,
  'a yearly bill is due a year after the last one'
);

-- 7-9. Expected months follow the pace.
select is(
  (select jsonb_agg(jsonb_build_array(m ->> 'month', m -> 'by_currency' -> 0 -> 'expense_minor') order by m ->> 'month')
   from jsonb_array_elements(public.expected_months(4, null, '2026-10-20') -> 'months') m),
  '[["2026-10", -210000], ["2026-11", -225000], ["2026-12", -195000], ["2027-01", -315000]]'::jsonb,
  'October: quarterly and yearly (late); November: monthly and every 2 months; January: monthly, every 2 months and quarterly'
);
select is(
  (select e ->> 'pace' from jsonb_array_elements(public.expected_months(3, null, '2026-10-20') -> 'recurring') e
   where (e ->> 'party_id')::uuid = pg_temp.id('yearly')),
  'year',
  'expected months name the pace'
);
select is(
  (select e ->> 'next_due_month' from jsonb_array_elements(public.expected_months(3, null, '2026-10-20') -> 'recurring') e
   where (e ->> 'party_id')::uuid = pg_temp.id('quarterly')),
  '2026-10',
  'and the next due month'
);

-- 10-13. This month's arrivals and changes, income included.
select is(
  (select jsonb_agg(jsonb_build_array(e ->> 'party_name', e ->> 'direction', (e ->> 'changed')::boolean) order by ord)
   from jsonb_array_elements(public.recurring_this_month('2026-10-20')) with ordinality x(e, ord)),
  '[["Example Power", "expense", true], ["Example Steady", "expense", false], ["Example Tenant", "income", true]]'::jsonb,
  'הגיעו החודש: every recurring party seen this month, expenses first'
);
select is(
  (select jsonb_agg(jsonb_build_array(e ->> 'party_name', (e ->> 'change_percent')::integer) order by ord)
   from jsonb_array_elements(public.recurring_changes('2026-10-20')) with ordinality x(e, ord)),
  '[["Example Power", 38], ["Example Tenant", 25]]'::jsonb,
  'the changes: an income change counts too, largest first'
);
select is(
  (select e ->> 'alert_key' from jsonb_array_elements(public.recurring_changes('2026-10-20')) e
   where e ->> 'party_name' = 'Example Tenant'),
  pg_temp.id('tenant_10')::text,
  'a change''s key is its payment'
);
select is(
  (select e ->> 'supplier_name' from jsonb_array_elements(public.recurring_changes('2026-10-20')) e
   where e ->> 'party_name' = 'Example Tenant'),
  null,
  'an income row has no supplier fields'
);

-- 14-21. Dismissals are per user.
select is(
  public.dismiss_recurring_alert('missing', 'expense:' || pg_temp.id('quarterly') || ':ILS:2026-10') ->> 'dismissed',
  'true',
  'the owner hides the late quarterly bill'
);
select is(
  pg_temp.missing(),
  '[["Example Lessee", "income", "month", "2026-10"], ["Example Yearly", "expense", "year", "2026-10"]]'::jsonb,
  'it leaves the owner''s list'
);
select is(
  public.dismiss_recurring_alert('change', pg_temp.id('power_10')::text) ->> 'dismissed',
  'true',
  'and hides the power change'
);
select is(
  (select jsonb_agg(e ->> 'party_name') from jsonb_array_elements(public.recurring_changes('2026-10-20')) e),
  '["Example Tenant"]'::jsonb,
  'it leaves the owner''s changes'
);
select is(
  (select count(*)::integer from jsonb_array_elements(public.recurring_this_month('2026-10-20'))),
  3,
  'הגיעו החודש still lists it'
);
select tests.authenticate_as('rp_editor');
select is(
  (select count(*)::integer from jsonb_array_elements(public.missing_bills('2026-10-20'))),
  3,
  'another member of the company still sees every late bill'
);
select tests.authenticate_as('rp_owner');
select is(
  public.undismiss_recurring_alert('missing', 'expense:' || pg_temp.id('quarterly') || ':ILS:2026-10') ->> 'dismissed',
  'false',
  'undo brings it back'
);
select throws_ok(
  $$select public.dismiss_recurring_alert('missing', 'quarterly')$$,
  'P0001', 'validation',
  'a key that is not a late bill''s is refused'
);

-- 22-27. The owner's pace.
select is(
  public.set_payment_pace(pg_temp.id('power_10'), 'quarter') -> 'prior_pace',
  'null'::jsonb,
  'the owner sets power to every quarter'
);
select is(
  (select jsonb_build_array(e ->> 'pace', e ->> 'next_due_month')
   from jsonb_array_elements(public.expected_months(3, null, '2026-10-20') -> 'recurring') e
   where (e ->> 'party_id')::uuid = pg_temp.id('power')),
  '["quarter", "2027-01"]'::jsonb,
  'power is next due in January'
);
select is(
  public.set_payment_recurring(pg_temp.id('power_10'), false) -> 'pace_override',
  '"quarter"'::jsonb,
  'the recurring switch keeps the pace'
);
select is(
  public.set_payment_recurring(pg_temp.id('power_10'), null) -> 'pace',
  '"quarter"'::jsonb,
  'clearing the recurring switch keeps the pace too'
);
select is(
  public.set_payment_pace(pg_temp.id('power_10'), null) -> 'prior_pace',
  '"quarter"'::jsonb,
  'null goes back to the detected pace'
);
select throws_ok(
  format('select public.set_payment_pace(%L, %L)', pg_temp.id('power_10'), 'weekly'),
  'P0001', 'validation',
  'an unknown pace is refused'
);

-- 28-30. The MCP's pace switch.
select tests.clear_authentication();
reset role;
select is((select count(*)::integer from public.recurring_overrides where company_id = pg_temp.id('co')), 0, 'no switch is left');
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('rp_owner'), pg_temp.id('co'), 'hash-rp-write', 'kid', array['write']::text[], '2099-01-01');
insert into rp (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-rp-write';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('rp_owner');
  tid uuid;
begin
  select id into tid from pg_temp.rp where label = 'write';
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
  public.mcp_set_line_pace('rp-1', pg_temp.id('steady_10'), 'year') -> 'data' ->> 'pace',
  'year',
  'set_line_pace sets steady to yearly'
);
select is(
  public.mcp_undo('rp-undo-1', 'line_pace', pg_temp.id('steady_10')) ->> 'ok',
  'true',
  'undo line_pace'
);

-- 31-32. Who may read the dismissals.
reset role;
select is(
  (select count(*)::integer from public.recurring_overrides where company_id = pg_temp.id('co')),
  0,
  'steady is back on the detected pace'
);
select ok(
  not has_table_privilege('authenticated', 'public.recurring_dismissals', 'select')
  and not has_function_privilege('anon', 'public.dismiss_recurring_alert(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.recurring_this_month(date)', 'execute')
  and not has_function_privilege('anon', 'public.set_payment_pace(uuid, text)', 'execute'),
  'the dismissals are read only through the functions'
);

-- 33-34. FLOW-913: a row says how many of this month's lines its amount sums.
select is(
  (select jsonb_agg(jsonb_build_array(e ->> 'party_name', (e ->> 'line_count')::integer) order by ord)
   from jsonb_array_elements(public.recurring_this_month('2026-10-20')) with ordinality x(e, ord)),
  '[["Example Power", 1], ["Example Steady", 1], ["Example Tenant", 1]]'::jsonb,
  'one line each this month'
);
insert into rp (label, id) values ('tenant_10b', tests.fixture_line(
  pg_temp.id('co'), 'rp:tenant_10b', 100000, 'income', null, null, '2026-10-12',
  p_pnl_role => null, p_doc_kind => 'invoice'
));
update public.transactions set customer_id = pg_temp.id('tenant') where id = pg_temp.id('tenant_10b');
select is(
  (select jsonb_build_array((e ->> 'line_count')::integer, (e ->> 'amount_minor')::bigint)
   from jsonb_array_elements(public.recurring_this_month('2026-10-20')) e
   where e ->> 'party_name' = 'Example Tenant'),
  '[2, 600000]'::jsonb,
  'a second rent this month: two lines, summed'
);

select * from finish();
rollback;
