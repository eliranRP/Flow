-- FLOW-1124: the member report's all-in per property (as the investment page counts it), the company's
-- open loans, and each member's loan_ids (the company's loans, each one member's). Invented names and
-- figures only; amounts are cents.

begin;

select plan(14);

do $users$
begin
  perform tests.create_supabase_user('mai_owner', 'mai-owner@example.com');
  perform tests.create_supabase_user('mai_other', 'mai-other@example.com');
end
$users$;

create temp table mai (label text primary key, id uuid);
grant all on mai to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.mai where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into mai (label, id) values ('co', tests.fixture_company('mai_owner', 'Example All In LLC', true));
insert into mai (label, id) values ('other_co', tests.fixture_company('mai_other', 'Example Other All In LLC'));
insert into mai (label, id) values
  ('birch', tests.fixture_project(pg_temp.id('co'), 'Example Birch')),
  ('juniper', tests.fixture_project(pg_temp.id('co'), 'Example Juniper'));
-- Birch's price is typed: 300,000.00; Juniper has none yet.
update public.projects set investment_currency = 'USD', value_minor = 42000000, value_date = '2026-11-01', purchase_minor = 30000000
where id = pg_temp.id('birch');
update public.projects set investment_currency = 'USD', value_minor = 36500000, value_date = '2026-11-01'
where id = pg_temp.id('juniper');

insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency, project_id)
values (pg_temp.id('co'), 'Birch mortgage', 26800000, 65000, 360, '2026-10-01', 170000, 0, 'USD', pg_temp.id('birch'));
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, start_date, escrow_minor, currency, kind)
values (pg_temp.id('co'), 'Member A note', 5000000, 60000, '2026-10-01', 0, 'USD', 'demand'),
       (pg_temp.id('co'), 'Member B note', 4000000, 60000, '2026-10-01', 0, 'USD', 'demand'),
       (pg_temp.id('other_co'), 'Other note', 1000000, 60000, '2026-10-01', 0, 'USD', 'demand');
insert into mai (label, id) select 'birch_loan', id from public.loans where name = 'Birch mortgage';
insert into mai (label, id) select 'a_note', id from public.loans where name = 'Member A note';
insert into mai (label, id) select 'b_note', id from public.loans where name = 'Member B note';
insert into mai (label, id) select 'other_note', id from public.loans where name = 'Other note';

select public.store_mcp_credential(tests.get_supabase_uid('mai_owner'), 'hash-mai-write01', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into mai (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-mai-write01';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('mai_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id(p_label))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

create or replace function pg_temp.prop(p_label text)
returns jsonb
language sql
as $$ select p from jsonb_array_elements(public.get_member_report()->'properties') p where (p->>'project_id')::uuid = pg_temp.id(p_label); $$;
grant execute on function pg_temp.prop(text) to authenticated, service_role;

select tests.authenticate_as('mai_owner');

-- The all-in, as the investment page counts it.
select is(pg_temp.prop('birch')->'purchase_minor', '30000000'::jsonb, 'a property carries its purchase');
select is(pg_temp.prop('birch')->'all_in_minor', '30000000'::jsonb, 'its all-in: no renovation or holding costs yet, the purchase');
select is((pg_temp.prop('birch')->>'all_in_minor')::bigint,
  (pg_temp.prop('birch')->>'purchase_minor')::bigint + (pg_temp.prop('birch')->>'rehab_minor')::bigint + (pg_temp.prop('birch')->>'holding_minor')::bigint,
  'the all-in adds its three parts');
select is(pg_temp.prop('juniper')->'all_in_minor', 'null'::jsonb, 'without a purchase, no all-in');

-- The company's open loans: the members' notes first, none of another company's.
select is(
  (select jsonb_agg(l->>'name') from jsonb_array_elements(public.get_member_report()->'loans') l),
  '["Member A note", "Member B note", "Birch mortgage"]'::jsonb, 'the open loans, demand loans first');
select is(
  (select l - 'loan_id' from jsonb_array_elements(public.get_member_report()->'loans') l where l->>'name' = 'Birch mortgage'),
  jsonb_build_object('name', 'Birch mortgage', 'kind', 'amortizing', 'project_id', pg_temp.id('birch'), 'currency', 'USD', 'balance_minor', 26800000),
  'each with its kind, property, currency and balance');

-- A member's loans.
select is(public.set_member_report(format('{"members": [{"name": "Member A", "ownership_bp": 5000, "loan_ids": ["%s"]}, {"name": "Member B", "ownership_bp": 5000, "loan_ids": ["%s"]}]}',
  pg_temp.id('a_note'), pg_temp.id('b_note'))::jsonb)->'config'->'members'->0->'loan_ids',
  jsonb_build_array(pg_temp.id('a_note')), 'the owner says whose each loan is');
select throws_ok(format($$select public.set_member_report('{"members": [{"name": "Member A", "ownership_bp": 10000, "loan_ids": ["%s"]}]}')$$, pg_temp.id('other_note')),
  'P0001', 'validation', 'another company''s loan is refused');
select throws_ok(format($$select public.set_member_report('{"members": [{"name": "Member A", "ownership_bp": 5000, "loan_ids": ["%s"]}, {"name": "Member B", "ownership_bp": 5000, "loan_ids": ["%s"]}]}')$$,
  pg_temp.id('a_note'), pg_temp.id('a_note')),
  'P0001', 'validation', 'one loan for two members is refused');
select throws_ok(format($$select public.set_member_report('{"members": [{"name": "Member A", "ownership_bp": 10000, "loan_ids": ["%s", "%s"]}]}')$$,
  pg_temp.id('a_note'), pg_temp.id('a_note')),
  'P0001', 'validation', 'a loan named twice is refused');
select throws_ok($$select public.set_member_report('{"members": [{"name": "Member A", "ownership_bp": 10000, "loan_ids": ["not-a-uuid"]}]}')$$,
  'P0001', 'validation', 'a loan id that is not a uuid is refused');
select throws_ok($$select public.set_member_report('{"members": [{"name": "Member A", "ownership_bp": 10000, "loan_ids": "x"}]}')$$,
  'P0001', 'validation', 'loan_ids that is not a list is refused');

-- MCP.
select pg_temp.as_mcp('write');
select is(public.mcp_set_member_report('mai-1', format('{"members": [{"name": "Member A", "ownership_bp": 10000, "loan_ids": ["%s", "%s"]}]}',
  pg_temp.id('a_note'), pg_temp.id('b_note'))::jsonb)->'data'->'config'->'members'->0->'loan_ids',
  jsonb_build_array(pg_temp.id('a_note'), pg_temp.id('b_note')), 'MCP sets a member''s loans');
select is(public.mcp_set_member_report('mai-2', format('{"members": [{"name": "Member A", "ownership_bp": 10000, "loan_ids": ["%s"]}]}',
  pg_temp.id('other_note'))::jsonb)->'error'->>'code', 'validation', 'and answers another company''s loan as validation');

select * from finish();
rollback;
