-- FLOW-450 (decision 0244). A property's returns: get_property_returns, get_property_return_lines,
-- the value history (project_values), units and land on set_project_investment, and the tax
-- bracket (set_tax_bracket, MCP set_tax_bracket with undo kind tax_bracket). Invented data only.
-- Amounts are cents of an invented company's shekels.

begin;

select plan(52);

do $users$
begin
  perform tests.create_supabase_user('prr_owner', 'prr-owner@example.com');
  perform tests.create_supabase_user('prr_viewer', 'prr-viewer@example.com');
  perform tests.create_supabase_user('prr_other', 'prr-other@example.com');
end
$users$;

create temp table prr (label text primary key, id uuid);
grant all on prr to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.prr where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into prr (label, id) values ('co', tests.fixture_company('prr_owner', 'Example Returns LLC', true));
insert into prr (label, id) values ('other_co', tests.fixture_company('prr_other', 'Example Other Returns LLC'));
insert into prr (label, id) values
  ('flat', tests.fixture_project(pg_temp.id('co'), 'Example Duplex')),
  ('job', tests.fixture_project(pg_temp.id('co'), 'Example Job')),
  ('other_flat', tests.fixture_project(pg_temp.id('other_co'), 'Other Duplex')),
  ('repairs', tests.fixture_category(pg_temp.id('co'), 'Repairs')),
  ('roof', tests.fixture_category(pg_temp.id('co'), 'Roof')),
  ('purchase', tests.fixture_category(pg_temp.id('co'), 'Purchase', 'expense', true)),
  ('rent', tests.fixture_category(pg_temp.id('co'), 'Rent', 'income'));
update public.categories set rehab = true where id = pg_temp.id('roof');
insert into prr (label, id)
select 'interest', c.id from public.categories c
where c.company_id = pg_temp.id('co') and c.loan_part = 'interest';
insert into public.company_viewers (user_id, company_id)
values (tests.get_supabase_uid('prr_viewer'), pg_temp.id('co'));

-- The year 2026 on the duplex. Income 24,000.00. Operating expenses: repairs 3,000.00, the escrow
-- part of the loan payment 100.00 and the duplex's 100.00 of a shared 400.00 line. CapEx: a roof
-- 1,800.00. Not counted: the purchase. A repair in 2025, an unpaid invoice and a pending line are
-- outside the year's statement.
insert into prr (label, id) values
  ('rent1', tests.fixture_line(pg_temp.id('co'), 'prr:rent1', 2400000, 'income', pg_temp.id('flat'), pg_temp.id('rent'), '2026-03-01')),
  ('rep1', tests.fixture_line(pg_temp.id('co'), 'prr:rep1', 300000, p_project => pg_temp.id('flat'), p_category => pg_temp.id('repairs'), p_doc_date => '2026-04-01')),
  ('roof1', tests.fixture_line(pg_temp.id('co'), 'prr:roof1', 180000, p_project => pg_temp.id('flat'), p_category => pg_temp.id('roof'), p_doc_date => '2026-05-01')),
  ('buy', tests.fixture_line(pg_temp.id('co'), 'prr:buy', 15000000, p_project => pg_temp.id('flat'), p_category => pg_temp.id('purchase'), p_doc_date => '2026-01-05')),
  ('old', tests.fixture_line(pg_temp.id('co'), 'prr:old', 50000, p_project => pg_temp.id('flat'), p_category => pg_temp.id('repairs'), p_doc_date => '2025-06-01')),
  ('unpaid', tests.fixture_line(pg_temp.id('co'), 'prr:unpaid', 7000, p_project => pg_temp.id('flat'), p_category => pg_temp.id('repairs'), p_doc_kind => 'invoice')),
  ('pend', tests.fixture_line(pg_temp.id('co'), 'prr:pend', 3000, p_project => pg_temp.id('flat'), p_category => pg_temp.id('repairs'), p_line_status => 'pending')),
  ('shared', tests.fixture_line(pg_temp.id('co'), 'prr:shared', 40000, p_category => pg_temp.id('repairs'), p_pnl_role => 'shared', p_doc_date => '2026-07-01')),
  ('other_rent', tests.fixture_line(pg_temp.id('other_co'), 'prr:other', 999900, 'income', pg_temp.id('other_flat')));
update public.transactions set cash_date = null where id = pg_temp.id('unpaid');
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net) values
  (pg_temp.id('co'), pg_temp.id('shared'), pg_temp.id('flat'), 2500, -10000),
  (pg_temp.id('co'), pg_temp.id('shared'), pg_temp.id('job'), 7500, -30000);

-- The duplex's loan: 120,000.00 borrowed. One payment of 1,000.00 in four parts: interest 600.00,
-- escrow 100.00, principal 200.00 and fees 100.00 (filed in Repairs).
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency, project_id
)
values (pg_temp.id('co'), 'Duplex mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 0, 'ILS', pg_temp.id('flat'));
insert into prr (label, id) values
  ('pay', tests.fixture_line(pg_temp.id('co'), 'prr:pay', 100000, p_project => pg_temp.id('flat'), p_category => pg_temp.id('interest'), p_doc_date => '2026-06-01'));
select tests.loan_split(pg_temp.id('pay'), (select id from public.loans where name = 'Duplex mortgage'), (
  select jsonb_agg(jsonb_build_object('part', v.part, 'amount_minor', v.amount, 'scheduled_minor', v.amount,
    'category_id', coalesce(
      (select c.id from public.categories c where c.company_id = pg_temp.id('co') and c.loan_part = v.part::public.loan_split_part),
      pg_temp.id('repairs')),
    'needs_review', false) order by v.n)
  from (values (1, 'interest', 60000), (2, 'escrow', 10000), (3, 'principal', 20000), (4, 'fees', 10000)) as v(n, part, amount)));

select public.store_mcp_credential(tests.get_supabase_uid('prr_owner'), 'hash-prr-write01', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into prr (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-prr-write01';
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('prr_owner'), pg_temp.id('co'), 'hash-prr-read001', 'pepper-1', array['read'], now() + interval '90 days');
insert into prr (label, id) select 'read', id from private.mcp_credentials where token_hash = 'hash-prr-read001';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('prr_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id(p_label))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

create or replace function pg_temp.ret()
returns jsonb
language sql
as $$ select public.get_property_returns(pg_temp.id('flat'), '2026-01-01', '2026-12-31'); $$;
grant execute on function pg_temp.ret() to authenticated, service_role;

create or replace function pg_temp.lines(p_line text, p_category uuid default null)
returns jsonb
language sql
as $$ select public.get_property_return_lines(pg_temp.id('flat'), p_line, '2026-01-01', '2026-12-31', p_category); $$;
grant execute on function pg_temp.lines(text, uuid) to authenticated, service_role;

select tests.authenticate_as('prr_owner');

-- The statement, with nothing typed in yet.
select is((pg_temp.ret()->'statement'->>'income_minor')::bigint, 2400000::bigint, 'income: the year''s paid rent');
select is((pg_temp.ret()->'statement'->>'opex_minor')::bigint, -320000::bigint,
  'operating expenses: repairs, the escrow part and the shared share, not the 2025, unpaid or pending lines');
select is((pg_temp.ret()->'statement'->>'noi_minor')::bigint, 2080000::bigint, 'NOI = income + operating expenses');
select is((pg_temp.ret()->'statement'->>'debt_service_minor')::bigint, -90000::bigint,
  'loan payments: the interest, principal and fees parts');
select is((pg_temp.ret()->'statement'->>'capex_minor')::bigint, -180000::bigint, 'CapEx: a category switched into rehab');
select is((pg_temp.ret()->'statement'->>'not_counted_minor')::bigint, -15000000::bigint, 'the purchase is not counted');
select is((pg_temp.ret()->'statement'->>'cash_flow_minor')::bigint, 1810000::bigint,
  'cash flow = NOI + loan payments + CapEx (CapEx below NOI)');
select is((pg_temp.ret()->'sources'->>'principal_minor')::bigint, 20000::bigint, 'principal paid');
select is(pg_temp.ret()->'statement'->'lines'->'opex'->>'lines', '3', 'three lines feed operating expenses');
select is(
  (select sum((e->>'amount_minor')::bigint) from jsonb_array_elements(pg_temp.ret()->'statement'->'by_category'->'opex') e),
  -320000::numeric, 'the categories of a line add up to it');
select is(pg_temp.ret()->'missing', '["purchase", "value", "land", "tax_bracket", "units"]'::jsonb,
  'every missing input is named');
select is(pg_temp.ret()->'equity'->>'money_in_minor', null, 'money in the deal waits for the purchase price');
select is(pg_temp.ret()->'sources'->>'appreciation_minor', null, 'appreciation waits for values');
select is(pg_temp.ret()->'sources'->>'tax_savings_minor', null, 'tax savings wait for land and bracket');
select is(pg_temp.ret()->'metrics'->>'cash_on_cash_bp', null, 'and so does cash-on-cash');
select is((pg_temp.ret()->'metrics'->>'dscr_milli')::integer, 23111, 'DSCR needs no input: NOI / loan payments');

-- The inputs.
select public.set_project_investment(pg_temp.id('flat'),
  '{"purchase_minor": 15000000, "arv_minor": 19000000, "value_minor": 17000000, "value_date": "2025-12-31", "units": 2, "land_minor": 2000000}');
select public.set_project_investment(pg_temp.id('flat'), '{"value_minor": 18000000, "value_date": "2026-10-01"}');
select is(
  (select jsonb_agg(jsonb_build_array(v.value_date, v.value_minor) order by v.value_date) from public.project_values v where v.project_id = pg_temp.id('flat')),
  '[["2025-12-31", 17000000], ["2026-10-01", 18000000]]'::jsonb, 'every value is kept by its date');
select is(public.set_tax_bracket(2400), jsonb_build_object('id', pg_temp.id('co'), 'tax_bracket_bp', 2400, 'prior', null),
  'set_tax_bracket returns the bracket before and after');

select is(pg_temp.ret()->'missing', '[]'::jsonb, 'nothing is missing now');
select is((pg_temp.ret()->'equity'->>'money_in_minor')::bigint, 3540000::bigint,
  'money in the deal = purchase + rehab so far (all time, paid) - what was borrowed');
select is((pg_temp.ret()->'equity'->>'equity_today_minor')::bigint, 6020000::bigint, 'equity today = value - loan balance');
select is((pg_temp.ret()->'equity'->>'forced_equity_minor')::bigint, 3460000::bigint, 'forced equity = ARV - purchase - rehab');
select is((pg_temp.ret()->'sources'->>'appreciation_minor')::bigint, 1000000::bigint,
  'appreciation = the value at the end of the period - the value at its start');
select is((pg_temp.ret()->'sources'->>'building_minor')::bigint, 13540000::bigint, 'building = purchase + rehab - land');
select is((pg_temp.ret()->'sources'->>'depreciation_year_minor')::bigint, 492364::bigint, 'depreciation = building / 27.5');
select is((pg_temp.ret()->'sources'->>'tax_savings_minor')::bigint, 118167::bigint, 'tax savings = depreciation x bracket');
select is((pg_temp.ret()->'sources'->>'total_minor')::bigint, 2948167::bigint,
  'total = cash flow + principal + appreciation + tax savings');
select is((pg_temp.ret()->'sources'->>'total_bp')::integer, 8328, 'total return on the money in the deal');
select is((pg_temp.ret()->'metrics'->>'cash_on_cash_bp')::integer, 5113, 'cash-on-cash = cash flow / money in the deal');
select is((pg_temp.ret()->'metrics'->>'cap_rate_bp')::integer, 1156, 'cap rate = NOI / value today');
select is((pg_temp.ret()->'metrics'->>'cash_flow_per_unit_month_minor')::bigint, 75417::bigint,
  'cash flow per unit per month');

-- A value for an earlier date (as an undo leaves it) drops the later ones.
select public.set_project_investment(pg_temp.id('flat'), '{"value_minor": 17000000, "value_date": "2025-12-31"}');
select is((select count(*)::integer from public.project_values v where v.project_id = pg_temp.id('flat')), 1,
  'an earlier value date drops the values after it');
select public.set_project_investment(pg_temp.id('flat'), '{"value_minor": 18000000, "value_date": "2026-10-01"}');
-- Clearing the value (an undo of the first value too) drops its entry, and appreciation waits.
select public.set_project_investment(pg_temp.id('flat'), '{"value_minor": null, "value_date": null}');
select is((select count(*)::integer from public.project_values v where v.project_id = pg_temp.id('flat')), 1,
  'clearing the value drops its entry and the ones after it');
select is(pg_temp.ret()->'sources'->>'appreciation_minor', null, 'and appreciation waits for a value again');
select public.set_project_investment(pg_temp.id('flat'), '{"value_minor": 18000000, "value_date": "2026-10-01"}');

-- The lines behind a figure.
select is((pg_temp.lines('opex')->>'count')::integer, 3, 'the lines behind operating expenses');
select is((pg_temp.lines('opex')->>'total_minor')::bigint, -320000::bigint, 'add up to it');
select is((pg_temp.lines('opex', pg_temp.id('repairs'))->>'count')::integer, 2, 'one category: repairs and the shared share');
select is((pg_temp.lines('principal')->>'total_minor')::bigint, -20000::bigint, 'the principal part alone');
select is((public.get_property_return_lines(pg_temp.id('flat'), 'rehab')->>'total_minor')::bigint, -540000::bigint,
  'rehab: all time, the building cost''s lines');
select is((pg_temp.lines('income')->'rows'->0->>'description'), 'prr:rent1', 'a row carries the line''s description');
select throws_ok($$select public.get_property_return_lines(pg_temp.id('flat'), 'profit')$$,
  '22023', 'validation', 'an unknown line is refused');

-- Isolation and roles.
select is(public.get_property_returns(pg_temp.id('other_flat')), null, 'another company''s project reads as not found');
select is(public.get_property_return_lines(pg_temp.id('other_flat'), 'income'), null, 'and so do its lines');
select tests.authenticate_as('prr_viewer');
select is((pg_temp.ret()->'statement'->>'cash_flow_minor')::bigint, 1810000::bigint, 'a viewer reads the returns');
select throws_ok($$select public.set_tax_bracket(1000)$$, '42501', 'forbidden', 'a viewer cannot set the bracket');

-- MCP.
select pg_temp.as_mcp('write');
select is(public.mcp_set_tax_bracket('prr-tax-1', 3000)->'data'->>'undo_kind', 'tax_bracket',
  'MCP set_tax_bracket returns its undo kind');
select is(public.mcp_set_tax_bracket('prr-tax-2', 10001)->'error'->>'code', 'validation', 'a bracket over 100% is validation');
select is(public.mcp_undo('prr-undo-1', 'tax_bracket', pg_temp.id('co'))->>'ok', 'true', 'undo works');
select is((select tax_bracket_bp from public.companies where id = pg_temp.id('co')), 2400, 'and puts the bracket back');
select public.mcp_set_project_investment('prr-inv-1', pg_temp.id('flat'), '{"units": 3, "land_minor": 1}');
select is(public.mcp_undo('prr-undo-2', 'project_investment', pg_temp.id('flat'))->>'ok', 'true', 'undo of units and land works');
select is((select array[units::bigint, land_minor] from public.projects where id = pg_temp.id('flat')), array[2::bigint, 2000000],
  'and puts both back');
select pg_temp.as_mcp('read');
select is(public.mcp_set_tax_bracket('prr-tax-3', 1000)->'error'->>'code', 'forbidden', 'a read token cannot write');

select * from finish();
rollback;
