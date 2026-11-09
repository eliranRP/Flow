-- FLOW-1117 (decision 0263). The member share report's setting: get_member_report, set_member_report
-- (owner only, validation, a null part clears it) and MCP set_member_report with undo kind
-- member_report. Invented names and figures only; amounts are cents.

begin;

select plan(27);

do $users$
begin
  perform tests.create_supabase_user('mrp_owner', 'mrp-owner@example.com');
  perform tests.create_supabase_user('mrp_viewer', 'mrp-viewer@example.com');
  perform tests.create_supabase_user('mrp_other', 'mrp-other@example.com');
end
$users$;

create temp table mrp (label text primary key, id uuid);
grant all on mrp to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.mrp where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into mrp (label, id) values ('co', tests.fixture_company('mrp_owner', 'Example Members LLC', true));
insert into mrp (label, id) values ('other_co', tests.fixture_company('mrp_other', 'Example Other Members LLC'));
insert into mrp (label, id) values
  ('birch', tests.fixture_project(pg_temp.id('co'), 'Example Birch')),
  ('juniper', tests.fixture_project(pg_temp.id('co'), 'Example Juniper')),
  ('job', tests.fixture_project(pg_temp.id('co'), 'Example Job')),
  ('sold', tests.fixture_project(pg_temp.id('co'), 'Example Sold')),
  ('other_flat', tests.fixture_project(pg_temp.id('other_co'), 'Other Flat'));
update public.projects set investment_currency = 'USD', value_minor = 42000000, value_date = '2026-11-01', selling_cost_bp = 700
where id = pg_temp.id('birch');
update public.projects set investment_currency = 'USD', value_minor = 36500000, value_date = '2026-11-01'
where id = pg_temp.id('juniper');
update public.projects set investment_currency = 'USD', value_minor = 20000000, status = 'finished'
where id = pg_temp.id('sold');
insert into public.company_viewers (user_id, company_id)
values (tests.get_supabase_uid('mrp_viewer'), pg_temp.id('co'));

-- Birch's loan: 268,000.00 open, in dollars.
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency, project_id
)
values (pg_temp.id('co'), 'Birch mortgage', 26800000, 65000, 360, '2026-10-01', 170000, 0, 'USD', pg_temp.id('birch'));

select public.store_mcp_credential(tests.get_supabase_uid('mrp_owner'), 'hash-mrp-write01', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into mrp (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-mrp-write01';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('mrp_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id(p_label))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

select tests.authenticate_as('mrp_owner');

-- The read before any setting.
select is(public.get_member_report()->'config', 'null'::jsonb, 'no setting yet reads as null');
select is((public.get_member_report()->>'can_edit')::boolean, true, 'the owner can edit');
select is(
  (select jsonb_agg(p->>'name' order by p->>'name') from jsonb_array_elements(public.get_member_report()->'properties') p),
  '["Example Birch", "Example Juniper"]'::jsonb,
  'the properties: those with a value or an open loan, not a finished one nor one without either');
select is(
  (select p from jsonb_array_elements(public.get_member_report()->'properties') p where p->>'name' = 'Example Birch'),
  jsonb_build_object('project_id', pg_temp.id('birch'), 'name', 'Example Birch', 'currency', 'USD', 'value_minor', 42000000,
    'value_date', '2026-11-01', 'selling_cost_bp', 700, 'loan_balance_minor', 26800000, 'loans_other_currency', false),
  'a property carries its value, date, selling cost and open loan balance');

-- Writing the setting.
select is(public.set_member_report('{"members": [{"name": "Member A", "ownership_bp": 5000}, {"name": "Member B", "ownership_bp": 5000}]}')->'config'->'members'->1->>'name',
  'Member B', 'the owner sets the members');
select is(public.set_member_report('{"assumptions": {"ltv_bp": 7500, "closing_bp": 200, "term_years": 30}, "rate_rule": {"tenor_years": 10, "spread_bp": 150}}')->'config'->'members'->0->>'name',
  'Member A', 'a patch keeps the parts it does not name');
select is(public.set_member_report(format('{"quotes": [{"id": "00000000-0000-4000-8000-000000000001", "lender": "Example Lending", "rate_ppm": 62500, "points_bp": 100, "quoted_on": "2026-11-03", "loan_type": "fixed", "project_id": "%s"}], "yields": [{"on_date": "2026-11-03", "y5_ppm": 41200, "y10_ppm": 43800, "source": "manual"}], "quote_date": "2026-11-03"}', pg_temp.id('birch'))::jsonb)->'config'->'quotes'->0->>'lender',
  'Example Lending', 'quotes and yields are stored');
select is(public.get_member_report()->'config'->'rate_rule', '{"tenor_years": 10, "spread_bp": 150}'::jsonb, 'and read back');
select is(public.set_member_report('{"quote_date": null}')->'config' ? 'quote_date', false, 'a null part clears it');

-- Validation.
select throws_ok($$select public.set_member_report('{"members": [{"name": "Member A", "ownership_bp": 6000}, {"name": "Member B", "ownership_bp": 3000}]}')$$,
  'P0001', 'ownership must add up to 100%', 'ownership that does not add up to 100% is refused');
select throws_ok($$select public.set_member_report('{"members": [{"name": "Member A", "ownership_bp": 5000}, {"name": "member a", "ownership_bp": 5000}]}')$$,
  'P0001', 'validation', 'two members with one name are refused');
select throws_ok($$select public.set_member_report('{"rate_rule": {"tenor_years": 7}}')$$,
  'P0001', 'validation', 'a tenor other than 5 or 10 years is refused');
select throws_ok($$select public.set_member_report('{"quotes": [{"id": "00000000-0000-4000-8000-000000000002", "lender": "Example", "rate_ppm": 62500, "quoted_on": "2026-02-30"}]}')$$,
  'P0001', 'validation', 'a quote with an impossible date is refused');
select throws_ok(format($$select public.set_member_report('{"quotes": [{"id": "00000000-0000-4000-8000-000000000002", "lender": "Example", "rate_ppm": 62500, "quoted_on": "2026-11-03", "project_id": "%s"}]}')$$, pg_temp.id('other_flat')),
  'P0001', 'validation', 'a quote on another company''s property is refused');
select throws_ok($$select public.set_member_report('{"color": "violet"}')$$, 'P0001', 'validation', 'an unknown part is refused');
select throws_ok($$select public.set_member_report('{}')$$, 'P0001', 'validation', 'an empty patch is refused');
select throws_ok($$select public.set_member_report('{"yields": [{"on_date": "2026-11-03", "y5_ppm": -1}]}')$$,
  'P0001', 'validation', 'a negative yield is refused');

-- Roles and isolation.
select tests.authenticate_as('mrp_viewer');
select is(public.get_member_report()->'config'->'members'->0->>'name', 'Member A', 'a viewer reads the setting');
select is((public.get_member_report()->>'can_edit')::boolean, false, 'and cannot edit it');
select throws_ok($$select public.set_member_report('{"quote_date": "2026-11-04"}')$$, '42501', 'forbidden', 'a viewer cannot write');
select tests.authenticate_as('mrp_other');
select is(public.get_member_report()->'config', 'null'::jsonb, 'another company sees its own empty setting');
select is(jsonb_array_length(public.get_member_report()->'properties'), 0, 'and none of the first company''s properties');
select is((select count(*)::integer from public.member_reports), 0, 'nor its row');

-- MCP, with undo.
select pg_temp.as_mcp('write');
select is(public.mcp_set_member_report('mrp-1', '{"assumptions": {"ltv_bp": 7000}}')->'data'->>'undo_kind', 'member_report',
  'MCP set_member_report returns its undo kind');
select is(public.mcp_set_member_report('mrp-1', '{"assumptions": {"ltv_bp": 7000}}')->'data'->'config'->'assumptions',
  '{"ltv_bp": 7000}'::jsonb, 'a replay answers the same');
select is(public.mcp_undo('mrp-undo-1', 'member_report', pg_temp.id('co'))->>'ok', 'true', 'undo works');
select is((select config->'assumptions' from public.member_reports where company_id = pg_temp.id('co')),
  '{"ltv_bp": 7500, "closing_bp": 200, "term_years": 30}'::jsonb, 'and puts the assumptions back');

select * from finish();
rollback;
