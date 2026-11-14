-- FLOW-450 (decision 0244). A property's returns: get_property_returns, get_property_return_lines,
-- the value history (project_values), units and land on set_project_investment, and the tax
-- bracket (set_tax_bracket, MCP set_tax_bracket with undo kind tax_bracket). Invented data only.
-- Amounts are cents of an invented company's shekels.

begin;

select plan(127);

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
  ('rent', tests.fixture_category(pg_temp.id('co'), 'Rent', 'income')),
  ('proceeds', tests.fixture_category(pg_temp.id('co'), 'Loan proceeds', 'income', true)),
  ('dep', tests.fixture_category(pg_temp.id('co'), 'Depreciation'));
update public.categories set rehab = false where id = pg_temp.id('dep');
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
  ('other_rent', tests.fixture_line(pg_temp.id('other_co'), 'prr:other', 999900, 'income', pg_temp.id('other_flat'))),
  -- FLOW-453: the loan's net proceeds (kept-out income) with the purchase, insurance paid before the
  -- first rent (a holding cost, in the period but not in the statement), and a non-cash journal
  -- entry (depreciation), which counts nowhere.
  ('proc', tests.fixture_line(pg_temp.id('co'), 'prr:proc', 11000000, 'income', pg_temp.id('flat'), pg_temp.id('proceeds'), '2026-01-05')),
  ('hold', tests.fixture_line(pg_temp.id('co'), 'prr:hold', 100000, p_project => pg_temp.id('flat'), p_category => pg_temp.id('repairs'), p_doc_date => '2026-02-01')),
  ('depr', tests.fixture_line(pg_temp.id('co'), 'prr:depr', 500000, p_project => pg_temp.id('flat'), p_category => pg_temp.id('dep'), p_doc_date => '2026-08-01'));
update public.transactions set in_cash_override = false where id = pg_temp.id('depr');
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
select is((pg_temp.ret()->'statement'->>'not_counted_minor')::bigint, -4000000::bigint, 'the purchase and the loan proceeds are not counted');
select is((pg_temp.ret()->'statement'->>'cash_flow_minor')::bigint, 1810000::bigint,
  'cash flow = NOI + loan payments + CapEx (CapEx below NOI)');
select is((pg_temp.ret()->'sources'->>'principal_minor')::bigint, 20000::bigint, 'principal paid');
select is(pg_temp.ret()->'statement'->'lines'->'opex'->>'lines', '3', 'three lines feed operating expenses');
select is(
  (select sum((e->>'amount_minor')::bigint) from jsonb_array_elements(pg_temp.ret()->'statement'->'by_category'->'opex') e),
  -320000::numeric, 'the categories of a line add up to it');
select is(pg_temp.ret()->>'first_rent', '2026-03-01', 'the first rent payment splits investing from earning');
select is((pg_temp.ret()->'statement'->>'before_rent_minor')::bigint, -100000::bigint,
  'a cost in the period but before the first rent is listed apart, not in the cash flow');
select is(pg_temp.ret()->'equity'->'money_in_parts',
  '{"acquisition_minor": -15000000, "renovation_minor": 0, "holding_minor": -150000, "financing_minor": 11000000, "shortfall_minor": 0}'::jsonb,
  'money in, by part: the purchase line, holding costs before the rent (the 2025 repair and the insurance), the net loan proceeds; the depreciation journal counts nowhere');
select is(pg_temp.ret()->'inputs'->>'purchase_source', 'lines', 'the purchase price comes from the lines');
select is((pg_temp.ret()->'inputs'->>'units')::integer, 1, 'units are 1 until the owner sets them (FLOW-454)');
select is((pg_temp.ret()->'inputs'->>'units_default')::boolean, true, 'and the read says it is the default');
select is((pg_temp.ret()->'metrics'->>'cash_flow_per_unit_month_minor')::bigint, 179916::bigint, 'so cash flow per unit is never missing');
select is((pg_temp.ret()->'inputs'->>'taken_over_minor')::bigint, 0::bigint, 'a loan with its proceeds line is not part of the price');
select is(pg_temp.ret()->'missing', '["value", "land", "tax_bracket"]'::jsonb,
  'every missing input is named');
select is((pg_temp.ret()->'equity'->>'money_in_minor')::bigint, 4150000::bigint, 'money in the deal needs no typed input');
select is(pg_temp.ret()->'sources'->>'appreciation_minor', null, 'appreciation waits for values');
select is(pg_temp.ret()->'sources'->>'tax_savings_minor', null, 'tax savings wait for land and bracket');
select is((pg_temp.ret()->'metrics'->>'cash_on_cash_bp')::integer, 5202, 'and so does cash-on-cash');
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
select is((pg_temp.ret()->'equity'->>'money_in_minor')::bigint, 4150000::bigint,
  'money in the deal = the purchase and the costs before the rent, less the net loan proceeds');
select is((pg_temp.ret()->'equity'->>'equity_today_minor')::bigint, 6020000::bigint, 'equity today = value - loan balance');
select is((pg_temp.ret()->'equity'->>'forced_equity_minor')::bigint, 3360000::bigint, 'forced equity = ARV - purchase - rehab');
select is((pg_temp.ret()->'sources'->>'appreciation_minor')::bigint, 1000000::bigint,
  'appreciation = the value at the end of the period - the value at its start');
select is((pg_temp.ret()->'sources'->>'building_minor')::bigint, 13640000::bigint, 'building = purchase + rehab - land');
select is((pg_temp.ret()->'sources'->>'depreciation_year_minor')::bigint, 496000::bigint, 'depreciation = building / 27.5');
-- FLOW-466: in service from the first rent (1 March): $4,960 a year x 24% x 306 / 365 days.
select is((pg_temp.ret()->'sources'->>'tax_savings_minor')::bigint, 99798::bigint, 'tax savings = depreciation x bracket, from the first rent');
select is((pg_temp.ret()->'sources'->>'total_minor')::bigint, 2929798::bigint,
  'total = cash flow + principal + appreciation + tax savings');
select is((pg_temp.ret()->'sources'->>'total_bp')::integer, 8421, 'total return on the money in the deal, a year from the first rent');
-- FLOW-464: the first rent (1 March) is inside the year, so the per-year metrics scale over the 306
-- days since it (365 / 306), not the 365 of the period; so does the total (FLOW-466).
select is((pg_temp.ret()->>'earning_days')::integer, 306, 'the days since the first rent, to the period''s end');
select is(pg_temp.ret()->>'annualized_from', '2026-03-01', 'scaled to a year from the first rent');
select is((pg_temp.ret()->'metrics'->>'cash_on_cash_bp')::integer, 5202, 'cash-on-cash = cash flow / money in the deal, a year from the first rent');
select is((pg_temp.ret()->'metrics'->>'cap_rate_bp')::integer, 1378, 'cap rate = NOI / value today, a year from the first rent');
select is((pg_temp.ret()->'metrics'->>'cash_flow_per_unit_month_minor')::bigint, 89958::bigint,
  'cash flow per unit per month, over the months since the first rent');
select is(public.get_property_returns(pg_temp.id('flat'), '2026-04-01', '2026-12-31')->>'annualized_from', null,
  'a first rent before the period scales over the whole period');
select is((public.get_property_returns(pg_temp.id('flat'), '2026-04-01', '2026-12-31')->>'earning_days')::integer, 275,
  'and its days are the period''s');

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
select is((public.get_property_return_lines(pg_temp.id('flat'), 'rehab')->>'total_minor')::bigint, -640000::bigint,
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

-- A cash-out refinance after the rent: more came out than went in.
reset role;
insert into prr (label, id) values
  ('refi', tests.fixture_line(pg_temp.id('co'), 'prr:refi', 10000000, 'income', pg_temp.id('flat'), pg_temp.id('proceeds'), '2026-09-01'));
select tests.authenticate_as('prr_owner');
select is((pg_temp.ret()->'equity'->>'money_in_minor')::bigint, -5850000::bigint, 'a cash-out refinance lowers the money in below zero');
select is((pg_temp.ret()->'equity'->>'all_cash_out')::boolean, true, 'all the cash came out');
select is(pg_temp.ret()->'metrics'->>'cash_on_cash_bp', null, 'so there is no cash-on-cash per cent');
select is((public.get_property_return_lines(pg_temp.id('flat'), 'holding')->>'total_minor')::bigint, -150000::bigint,
  'the holding costs line lists its lines');
select is((public.get_property_return_lines(pg_temp.id('flat'), 'money_in')->>'count')::integer, 5,
  'money in lists the purchase, the two holding costs and the two loan proceeds');

-- FLOW-1025 (decision 0251): with all the cash out, a negative cash flow is the owner's money again.
select is((pg_temp.ret()->'equity'->'money_in_parts'->>'shortfall_minor')::bigint, 0::bigint,
  'a positive running cash flow adds nothing to the money in');
select is(pg_temp.ret()->'equity'->>'cash_out_cover_months', null, 'and with a positive cash flow nothing runs out');
reset role;
insert into prr (label, id) values
  ('loss1', tests.fixture_line(pg_temp.id('co'), 'prr:loss1', 2500000, p_project => pg_temp.id('flat'), p_category => pg_temp.id('repairs'), p_doc_date => '2026-10-01'));
select tests.authenticate_as('prr_owner');
-- The year's cash flow: 18,100.00 - 25,000.00 = -6,900.00, all of it since the first rent.
select is((pg_temp.ret()->'equity'->'money_in_parts'->>'shortfall_minor')::bigint, -690000::bigint,
  'the running cash flow since the first rent, below zero, is a part of the money in');
select is((pg_temp.ret()->'equity'->>'money_in_minor')::bigint, -5160000::bigint,
  'and the money in adds it: -58,500.00 + 6,900.00');
-- 51,600.00 still out, against 6,900.00 over the 306 days since the first rent: 75 whole months.
select is((pg_temp.ret()->'equity'->>'cash_out_cover_months')::integer, 75,
  'the cash still out covers 75 months of that cash flow at its yearly pace');
reset role;
insert into prr (label, id) values
  ('loss2', tests.fixture_line(pg_temp.id('co'), 'prr:loss2', 5500000, p_project => pg_temp.id('flat'), p_category => pg_temp.id('repairs'), p_doc_date => '2026-11-01'));
select tests.authenticate_as('prr_owner');
select is((pg_temp.ret()->'equity'->>'money_in_minor')::bigint, 340000::bigint,
  'losses past the cash taken out put money in the deal again');
select is(pg_temp.ret()->'equity'->>'all_cash_out' || '|' || coalesce(pg_temp.ret()->'equity'->>'cash_out_cover_months', 'null'), 'false|null',
  'so not all the cash is out, and nothing is left to cover');
-- The rest of the file reads the duplex without the two losses (an unpaid line is not cash).
reset role;
update public.transactions set cash_date = null where id in (pg_temp.id('loss1'), pg_temp.id('loss2'));
select tests.authenticate_as('prr_owner');

-- FLOW-453 review: a line in another currency before the first rent does not move the rent start,
-- and a rehab cost and a loan payment before the rent land in renovation and holding, not CapEx.
reset role;
insert into prr (label, id) values ('curr', tests.fixture_project(pg_temp.id('co'), 'Example Currency Duplex'));
insert into prr (label, id) values
  ('curr_rent', tests.fixture_line(pg_temp.id('co'), 'prr:curr-rent', 100000, 'income', pg_temp.id('curr'), pg_temp.id('rent'), '2026-03-01')),
  ('curr_roof', tests.fixture_line(pg_temp.id('co'), 'prr:curr-roof', 50000, p_project => pg_temp.id('curr'), p_category => pg_temp.id('roof'), p_doc_date => '2026-02-10')),
  ('curr_usd', tests.fixture_line(pg_temp.id('co'), 'prr:curr-usd', 500000, 'income', pg_temp.id('curr'), pg_temp.id('rent'), '2026-01-15', p_currency => 'USD')),
  ('curr_pay', tests.fixture_line(pg_temp.id('co'), 'prr:curr-pay', 100000, p_project => pg_temp.id('curr'), p_category => pg_temp.id('interest'), p_doc_date => '2026-02-15'));
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency, project_id)
values (pg_temp.id('co'), 'Currency mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 0, 'ILS', pg_temp.id('curr'));
select tests.loan_split(pg_temp.id('curr_pay'), (select id from public.loans where name = 'Currency mortgage'), (
  select jsonb_agg(jsonb_build_object('part', v.part, 'amount_minor', v.amount, 'scheduled_minor', v.amount,
    'category_id', coalesce(
      (select c.id from public.categories c where c.company_id = pg_temp.id('co') and c.loan_part = v.part::public.loan_split_part),
      pg_temp.id('interest')),
    'needs_review', false) order by v.n)
  from (values (1, 'interest', 50000), (2, 'escrow', 10000), (3, 'principal', 40000)) as v(n, part, amount)));
select tests.authenticate_as('prr_owner');
select is(public.get_property_returns(pg_temp.id('curr'), '2026-01-01', '2026-12-31')->>'first_rent', '2026-03-01',
  'the first rent is the rent in the investment currency, not the USD line before it');
select is((public.get_property_returns(pg_temp.id('curr'), '2026-01-01', '2026-12-31')->'equity'->'money_in_parts'->>'renovation_minor')::bigint, -50000::bigint,
  'a rehab cost before the first rent is renovation');
select is((public.get_property_returns(pg_temp.id('curr'), '2026-01-01', '2026-12-31')->'equity'->'money_in_parts'->>'holding_minor')::bigint, -100000::bigint,
  'a loan payment before the first rent is holding');
select is((public.get_property_returns(pg_temp.id('curr'), '2026-01-01', '2026-12-31')->'statement'->>'capex_minor')::bigint, 0::bigint,
  'the rehab cost before the rent is not CapEx');
select is((public.get_property_returns(pg_temp.id('curr'), '2026-01-01', '2026-12-31')->'statement'->>'before_rent_minor')::bigint, -150000::bigint,
  'the period costs before the rent are listed apart');

-- FLOW-461: the land from the books. The books split the purchase into land and building on asset
-- accounts; the company names its land account once and each property reads its postings to it.
reset role;
insert into public.accounts (company_id, name, type) values
  (pg_temp.id('co'), '1 Property - land', 'asset'),
  (pg_temp.id('co'), '1A Property - land improvements', 'asset'),
  (pg_temp.id('co'), '2 Property - building', 'asset');
insert into prr (label, id)
select 'land_acc', a.id from public.accounts a where a.company_id = pg_temp.id('co') and a.name = '1 Property - land';
insert into prr (label, id)
select 'other_acc', a.id from public.accounts a where a.company_id = pg_temp.id('other_co') limit 1;
-- FLOW-463: each leg is filed to the property, without the by-hand flag, as a journal entry does.
insert into public.legs (company_id, transaction_id, account_id, amount_minor, ordinal, leg_kind, project_id, project_explicit)
select pg_temp.id('co'), pg_temp.id('buy'), a.id, v.amount, v.ord, 'journal', pg_temp.id('flat'), false
from (values ('1 Property - land', 2500000, 90), ('1A Property - land improvements', 400000, 91), ('2 Property - building', -2900000, 92)) v(name, amount, ord)
join public.accounts a on a.company_id = pg_temp.id('co') and a.name = v.name;
select tests.authenticate_as('prr_owner');
select is(pg_temp.ret()->'inputs'->>'land_source', 'typed', 'a typed land value wins');
select public.set_project_investment(pg_temp.id('flat'), '{"land_minor": null}');
select is(pg_temp.ret()->'inputs'->'land_suggestion',
  jsonb_build_object('account_id', pg_temp.id('land_acc'), 'name', '1 Property - land', 'amount_minor', 2500000),
  'with no land account named, the land account with a balance on the property is suggested, not land improvements');
select ok(pg_temp.ret()->'missing' ? 'land', 'and the land is still missing until it is chosen');
select is(public.set_land_account(pg_temp.id('land_acc'))->>'land_account_id', pg_temp.id('land_acc')::text,
  'set_land_account names the company''s land account');
select is((pg_temp.ret()->'inputs'->>'land_minor')::bigint, 2500000::bigint, 'the land is the property''s postings to it');
select is(pg_temp.ret()->'inputs'->>'land_source', 'books', 'and comes from the books');
-- FLOW-463: a journal entry with no project on the line files each leg to its property; the leg's
-- project counts, flagged by hand or not. A leg filed elsewhere does not count here, whatever the line's.
reset role;
insert into prr (label, id) values
  ('land_je', tests.fixture_line(pg_temp.id('co'), 'prr:land-je', 300000, p_doc_date => '2026-01-06')),
  ('land_elsewhere', tests.fixture_project(pg_temp.id('co'), 'Example other property'));
insert into public.legs (company_id, transaction_id, account_id, amount_minor, ordinal, leg_kind, project_id, project_explicit)
values
  (pg_temp.id('co'), pg_temp.id('land_je'), pg_temp.id('land_acc'), 300000, 90, 'journal', pg_temp.id('flat'), false),
  (pg_temp.id('co'), pg_temp.id('buy'), pg_temp.id('land_acc'), 700000, 93, 'journal', pg_temp.id('land_elsewhere'), false);
select tests.authenticate_as('prr_owner');
select is((pg_temp.ret()->'inputs'->>'land_minor')::bigint, 2800000::bigint,
  'a leg filed to the property counts though its line has no project, and a leg filed to another property does not');
select is(pg_temp.ret()->'inputs'->'land_suggestion', 'null'::jsonb, 'no suggestion once an account is named');
select throws_ok(format('select public.set_land_account(%L)', pg_temp.id('other_acc')), 'P0001', 'account not found',
  'another company''s account is not found');
select pg_temp.as_mcp('write');
select is(public.mcp_set_land_account('prr-land-1', null)->'data'->>'undo_kind', 'land_account', 'MCP set_land_account returns its undo kind');
select is(public.mcp_undo('prr-land-undo', 'land_account', pg_temp.id('co'))->>'ok', 'true', 'undo works');
select is((select land_account_id from public.companies where id = pg_temp.id('co')), pg_temp.id('land_acc'), 'and puts the account back');
select tests.authenticate_as('prr_owner');

-- FLOW-454: a Sub2 deal. The bank shows only the cash brought to closing; the mortgage taken
-- over (no proceeds line) is part of the price, a later refinance is not, and the money in stays cash.
reset role;
insert into prr (label, id) values ('sub2', tests.fixture_project(pg_temp.id('co'), 'Example Sub2'));
insert into prr (label, id) values
  ('s2buy', tests.fixture_line(pg_temp.id('co'), 'prr:s2buy', 3000000, p_project => pg_temp.id('sub2'), p_category => pg_temp.id('purchase'), p_doc_date => '2026-08-06')),
  ('s2rent', tests.fixture_line(pg_temp.id('co'), 'prr:s2rent', 200000, 'income', pg_temp.id('sub2'), pg_temp.id('rent'), '2026-10-13'));
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency, project_id)
values
  (pg_temp.id('co'), 'Sub2 mortgage taken over', 29000000, 33750, 300, '2026-09-01', 150000, 0, 'ILS', pg_temp.id('sub2')),
  (pg_temp.id('co'), 'Sub2 later refinance', 31000000, 70000, 360, '2027-06-01', 210000, 0, 'ILS', pg_temp.id('sub2'));
select tests.authenticate_as('prr_owner');
create or replace function pg_temp.sub2()
returns jsonb
language sql
as $$ select public.get_property_returns(pg_temp.id('sub2'), '2026-01-01', '2026-12-31'); $$;
grant execute on function pg_temp.sub2() to authenticated, service_role;
select is((pg_temp.sub2()->'inputs'->>'taken_over_minor')::bigint, 29000000::bigint,
  'the mortgage taken over at closing, with no proceeds line, is part of the price; the later refinance is not');
select is((pg_temp.sub2()->'inputs'->>'purchase_minor')::bigint, 32000000::bigint, 'purchase = the cash at closing + the loan taken over');
select is((pg_temp.sub2()->'equity'->>'money_in_minor')::bigint, 3000000::bigint, 'the money in stays the cash brought');

-- FLOW-466: what the loan paid at closing, from the settlement statement, is what the price counts.
insert into prr (label, id) select 'sub2_loan', l.id from public.loans l where l.name = 'Sub2 mortgage taken over';
select is((public.set_loan_closing_paid(pg_temp.id('sub2_loan'), 25000000))->>'closing_paid_minor', '25000000',
  'set_loan_closing_paid keeps what the loan paid at closing');
select is((pg_temp.sub2()->'inputs'->>'taken_over_minor')::bigint, 25000000::bigint, 'the price counts that, not the whole loan');
select is((pg_temp.sub2()->'inputs'->>'purchase_minor')::bigint, 28000000::bigint, 'purchase = the cash at closing + what the loan paid then');
select is((pg_temp.sub2()->'inputs'->'taken_over_loans'->0->>'principal_minor')::bigint, 29000000::bigint, 'the loan still names its principal');
select throws_ok(format('select public.set_loan_closing_paid(%L, 29000001)', pg_temp.id('sub2_loan')), '22023', 'validation',
  'more than the principal is refused');
select throws_ok(format('select public.set_loan_closing_paid(%L, 1)', gen_random_uuid()), 'P0001', 'loan not found',
  'an unknown loan, or another company''s, is not found');
select pg_temp.as_mcp('write');
select is(public.mcp_set_loan_closing_paid('prr-close-1', pg_temp.id('sub2_loan'), null)->'data'->>'undo_kind', 'loan_closing_paid',
  'MCP set_loan_closing_paid returns its undo kind');
select is((select closing_paid_minor from public.loans where id = pg_temp.id('sub2_loan')), null::bigint, 'null is the whole loan again');
select is(public.mcp_undo('prr-close-undo', 'loan_closing_paid', pg_temp.id('sub2_loan'))->>'ok', 'true', 'undo works');
select is((select closing_paid_minor from public.loans where id = pg_temp.id('sub2_loan')), 25000000::bigint, 'and puts the amount back');
select tests.authenticate_as('prr_owner');

-- FLOW-466: with no value by the period's start, appreciation runs from the first value in it; one
-- value alone waits for a second. Tax savings run from the first rent (13 October), not the year.
select public.set_project_investment(pg_temp.id('sub2'), '{"value_minor": 34000000, "value_date": "2026-09-01"}');
select ok(pg_temp.sub2()->'missing' ? 'value_history', 'one value alone: appreciation waits for a second');
select public.set_project_investment(pg_temp.id('sub2'), '{"value_minor": 35000000, "value_date": "2026-10-20"}');
select is((pg_temp.sub2()->'sources'->>'appreciation_minor')::bigint, 1000000::bigint,
  'appreciation = the last value - the first value in the period');
select is(pg_temp.sub2()->'inputs'->'value_start'->>'value_date', '2026-09-01', 'and names where it starts');
select is((public.get_property_returns(pg_temp.id('flat'), '2026-01-01', '2026-02-28')->'sources'->>'tax_savings_minor')::bigint, 0::bigint,
  'no tax savings before the first rent: not yet in service');
-- A later edit that lowers the principal below the amount at closing still saves; the price counts at most the principal.
reset role;
update public.loans set principal_minor = 20000000 where id = pg_temp.id('sub2_loan');
select tests.authenticate_as('prr_owner');
select is((pg_temp.sub2()->'inputs'->>'taken_over_minor')::bigint, 20000000::bigint, 'the price counts at most the principal');

-- FLOW-454 boundaries (0246), one project each so no loan's proceeds fall in another's window: the
-- window from 30 days before the closing (2026-08-06) to 75 days after it; a proceeds line under 80%
-- of the loan; exactly 80%; and proceeds 121 days before the first payment (outside) and 120 (inside).
reset role;
insert into prr (label, id) values
  ('ea', tests.fixture_project(pg_temp.id('co'), 'Edge window')),
  ('eb', tests.fixture_project(pg_temp.id('co'), 'Edge 79 percent')),
  ('ec', tests.fixture_project(pg_temp.id('co'), 'Edge 80 percent')),
  ('ed', tests.fixture_project(pg_temp.id('co'), 'Edge 121 days')),
  ('ee', tests.fixture_project(pg_temp.id('co'), 'Edge 120 days'));
insert into prr (label, id) values
  ('ea-buy', tests.fixture_line(pg_temp.id('co'), 'prr:ea-buy', 3000000, p_project => pg_temp.id('ea'), p_category => pg_temp.id('purchase'), p_doc_date => '2026-08-06')),
  ('eb-buy', tests.fixture_line(pg_temp.id('co'), 'prr:eb-buy', 3000000, p_project => pg_temp.id('eb'), p_category => pg_temp.id('purchase'), p_doc_date => '2026-08-06')),
  ('ec-buy', tests.fixture_line(pg_temp.id('co'), 'prr:ec-buy', 3000000, p_project => pg_temp.id('ec'), p_category => pg_temp.id('purchase'), p_doc_date => '2026-08-06')),
  ('ed-buy', tests.fixture_line(pg_temp.id('co'), 'prr:ed-buy', 3000000, p_project => pg_temp.id('ed'), p_category => pg_temp.id('purchase'), p_doc_date => '2026-08-06')),
  ('ee-buy', tests.fixture_line(pg_temp.id('co'), 'prr:ee-buy', 3000000, p_project => pg_temp.id('ee'), p_category => pg_temp.id('purchase'), p_doc_date => '2026-08-06')),
  ('eb-proc', tests.fixture_line(pg_temp.id('co'), 'prr:eb-proc', 12700000, 'income', pg_temp.id('eb'), pg_temp.id('proceeds'), '2026-08-20')),
  ('ec-proc', tests.fixture_line(pg_temp.id('co'), 'prr:ec-proc', 8000000, 'income', pg_temp.id('ec'), pg_temp.id('proceeds'), '2026-09-10')),
  ('ed-proc', tests.fixture_line(pg_temp.id('co'), 'prr:ed-proc', 5000000, 'income', pg_temp.id('ed'), pg_temp.id('proceeds'), '2026-05-03')),
  ('ee-proc', tests.fixture_line(pg_temp.id('co'), 'prr:ee-proc', 5000000, 'income', pg_temp.id('ee'), pg_temp.id('proceeds'), '2026-05-04'));
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency, project_id)
values
  (pg_temp.id('co'), 'Edge too early', 1000000, 33750, 300, '2026-07-06', 150000, 0, 'ILS', pg_temp.id('ea')),
  (pg_temp.id('co'), 'Edge 30 days before', 2000000, 33750, 300, '2026-07-07', 150000, 0, 'ILS', pg_temp.id('ea')),
  (pg_temp.id('co'), 'Edge 75 days after', 4000000, 33750, 300, '2026-10-20', 150000, 0, 'ILS', pg_temp.id('ea')),
  (pg_temp.id('co'), 'Edge too late', 8000000, 33750, 300, '2026-10-21', 150000, 0, 'ILS', pg_temp.id('ea')),
  (pg_temp.id('co'), 'Edge 79 percent', 16000000, 33750, 300, '2026-09-01', 150000, 0, 'ILS', pg_temp.id('eb')),
  (pg_temp.id('co'), 'Edge exactly 80 percent', 10000000, 33750, 300, '2026-09-15', 150000, 0, 'ILS', pg_temp.id('ec')),
  (pg_temp.id('co'), 'Edge 121 days', 5000000, 33750, 300, '2026-09-01', 150000, 0, 'ILS', pg_temp.id('ed')),
  (pg_temp.id('co'), 'Edge 120 days', 5000000, 33750, 300, '2026-09-01', 150000, 0, 'ILS', pg_temp.id('ee'));
select tests.authenticate_as('prr_owner');
select is((public.get_property_returns(pg_temp.id('ea'), '2026-01-01', '2026-12-31')->'inputs'->>'taken_over_minor')::bigint, 6000000::bigint,
  'a loan taken over counts from 30 days before the closing to 75 days after it; 31 days before and 76 after do not');
select is((public.get_property_returns(pg_temp.id('eb'), '2026-01-01', '2026-12-31')->'inputs'->>'taken_over_minor')::bigint, 16000000::bigint,
  'a proceeds line under 80% of the loan (79%) does not keep the loan out of the price');
select is((public.get_property_returns(pg_temp.id('ec'), '2026-01-01', '2026-12-31')->'inputs'->>'taken_over_minor')::bigint, 0::bigint,
  'a proceeds line of exactly 80% of the loan keeps it out of the price');
select is((public.get_property_returns(pg_temp.id('ed'), '2026-01-01', '2026-12-31')->'inputs'->>'taken_over_minor')::bigint, 5000000::bigint,
  'proceeds 121 days before the first payment are outside its window: the loan counts');
select is((public.get_property_returns(pg_temp.id('ee'), '2026-01-01', '2026-12-31')->'inputs'->>'taken_over_minor')::bigint, 0::bigint,
  'proceeds 120 days before the first payment are inside its window: the loan is out');

-- FLOW-1199 (decision 0269): a hard-money loan funds the purchase at closing and pays its renovation
-- draws into the bank. With no closing amount set, the price counts the principal less those draws:
-- loan proceeds after its start, up to its payoff and before the first rent. A renovation refund, a
-- deposit after the first rent and a draw after the payoff are not draws; a closing amount set wins.
reset role;
insert into public.accounts (company_id, name, type) values (pg_temp.id('co'), 'Example loan principal', 'liability');
insert into prr (label, id) values
  ('hml', tests.fixture_project(pg_temp.id('co'), 'Example renovation')),
  ('draw_cat', tests.fixture_category(pg_temp.id('co'), 'Example draws', 'income', true)),
  ('refund_cat', tests.fixture_category(pg_temp.id('co'), 'Example renovation refunds', 'income', true));
update public.categories set ledger_account_id = (
  select a.id from public.accounts a where a.company_id = pg_temp.id('co') and a.name = 'Example loan principal')
where id = pg_temp.id('draw_cat');
update public.categories set rehab = true, ledger_account_id = (
  select a.id from public.accounts a where a.company_id = pg_temp.id('co') and a.name = 'Example loan principal')
where id = pg_temp.id('refund_cat');
insert into prr (label, id) values
  ('hml-buy', tests.fixture_line(pg_temp.id('co'), 'prr:hml-buy', 3000000, p_project => pg_temp.id('hml'), p_category => pg_temp.id('purchase'), p_doc_date => '2026-03-02')),
  ('hml-d1', tests.fixture_line(pg_temp.id('co'), 'prr:hml-d1', 2000000, 'income', pg_temp.id('hml'), pg_temp.id('draw_cat'), '2026-04-01')),
  ('hml-d2', tests.fixture_line(pg_temp.id('co'), 'prr:hml-d2', 1000000, 'income', pg_temp.id('hml'), pg_temp.id('draw_cat'), '2026-05-01')),
  ('hml-ref', tests.fixture_line(pg_temp.id('co'), 'prr:hml-ref', 50000, 'income', pg_temp.id('hml'), pg_temp.id('refund_cat'), '2026-04-15')),
  ('hml-rent', tests.fixture_line(pg_temp.id('co'), 'prr:hml-rent', 200000, 'income', pg_temp.id('hml'), pg_temp.id('rent'), '2026-07-01')),
  ('hml-dep', tests.fixture_line(pg_temp.id('co'), 'prr:hml-dep', 300000, 'income', pg_temp.id('hml'), pg_temp.id('draw_cat'), '2026-07-05')),
  ('hml-late', tests.fixture_line(pg_temp.id('co'), 'prr:hml-late', 400000, 'income', pg_temp.id('hml'), pg_temp.id('draw_cat'), '2026-10-01'));
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency, project_id, status, closed_on)
values (pg_temp.id('co'), 'Example hard-money loan', 20000000, 120000, 12, '2026-03-01', 200000, 0, 'ILS', pg_temp.id('hml'), 'paid_off', '2026-09-30');
insert into prr (label, id) select 'hml_loan', l.id from public.loans l where l.name = 'Example hard-money loan';
select tests.authenticate_as('prr_owner');
create or replace function pg_temp.hml()
returns jsonb
language sql
as $$ select public.get_property_returns(pg_temp.id('hml'), '2026-01-01', '2026-12-31'); $$;
grant execute on function pg_temp.hml() to authenticated, service_role;
select is((pg_temp.hml()->'inputs'->>'taken_over_minor')::bigint, 17000000::bigint,
  'the loan counts its principal less the draws it paid into the bank before the first rent');
select is((pg_temp.hml()->'inputs'->'taken_over_loans'->0->>'draws_minor')::bigint, 3000000::bigint,
  'a renovation refund, a deposit after the first rent and money after the payoff are not draws');
select is((pg_temp.hml()->'inputs'->>'purchase_minor')::bigint, 20000000::bigint,
  'purchase = the cash at closing + what the loan paid at closing');
select is((public.set_loan_closing_paid(pg_temp.id('hml_loan'), 18000000))->>'closing_paid_minor', '18000000',
  'the owner sets the settlement statement''s amount');
select is((pg_temp.hml()->'inputs'->>'taken_over_minor')::bigint, 18000000::bigint, 'and the amount set wins over the draws');
-- A lender who lends the draws on top of the principal: the payoff repays the principal and the
-- draws, so the draws were not inside the principal and are not taken off.
select public.set_loan_closing_paid(pg_temp.id('hml_loan'), null);
reset role;
-- Another loan's proceeds (80% or more of it, near its start) are not this loan's draws.
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency, project_id)
values (pg_temp.id('co'), 'Example second loan', 10000000, 80000, 360, '2026-06-01', 80000, 0, 'ILS', pg_temp.id('hml'));
insert into prr (label, id) values
  ('hml-second', tests.fixture_line(pg_temp.id('co'), 'prr:hml-second', 8000000, 'income', pg_temp.id('hml'), pg_temp.id('draw_cat'), '2026-06-02'));
select tests.authenticate_as('prr_owner');
select is((pg_temp.hml()->'inputs'->'taken_over_loans'->0->>'draws_minor')::bigint, 3000000::bigint,
  'another loan''s proceeds are not this loan''s draws');
reset role;
-- The company's principal category (one per loan part).
insert into prr (label, id)
select 'principal_cat', c.id from public.categories c where c.company_id = pg_temp.id('co') and c.loan_part = 'principal';
insert into prr (label, id) values
  ('hml-payoff', tests.fixture_line(pg_temp.id('co'), 'prr:hml-payoff', 23000000, p_project => pg_temp.id('hml'), p_category => pg_temp.id('principal_cat'), p_doc_date => '2026-09-30'));
select tests.authenticate_as('prr_owner');
select is((pg_temp.hml()->'inputs'->>'taken_over_minor')::bigint, 20000000::bigint,
  'a payoff of the principal and the draws: the draws were lent on top, the whole principal counts');
select is((pg_temp.hml()->'inputs'->'taken_over_loans'->0->>'draws_minor')::bigint, 0::bigint, 'and no draws are taken off');

-- FLOW-1200 (decision 0270): a refinance closing's costs other than interest (rental-year taxes here)
-- are the rental's, not the deal's holding; the old loan's payoff interest at the same closing stays.
reset role;
insert into prr (label, id) values
  ('rf', tests.fixture_project(pg_temp.id('co'), 'Example refinance')),
  ('rf_tax', tests.fixture_category(pg_temp.id('co'), 'Example refinance taxes', 'expense'));
update public.categories set rehab = false where id = pg_temp.id('rf_tax');
insert into prr (label, id)
select 'rf_int', c.id from public.categories c where c.company_id = pg_temp.id('co') and c.loan_part = 'interest';
insert into prr (label, id) values
  ('rf-buy', tests.fixture_line(pg_temp.id('co'), 'prr:rf-buy', 3000000, p_project => pg_temp.id('rf'), p_category => pg_temp.id('purchase'), p_doc_date => '2026-01-05')),
  ('rf-tax1', tests.fixture_line(pg_temp.id('co'), 'prr:rf-tax1', 10000, p_project => pg_temp.id('rf'), p_category => pg_temp.id('rf_tax'), p_doc_date => '2026-03-01')),
  ('rf-close', tests.fixture_line(pg_temp.id('co'), 'prr:rf-close', 19920000, 'income', pg_temp.id('rf'), pg_temp.id('proceeds'), '2026-06-10')),
  ('rf-rent', tests.fixture_line(pg_temp.id('co'), 'prr:rf-rent', 200000, 'income', pg_temp.id('rf'), pg_temp.id('rent'), '2026-08-01'));
select tests.line_split(pg_temp.id('rf-close'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.id('proceeds'), 'project_id', pg_temp.id('rf'), 'amount_minor', 20000000, 'gross_up', false),
  jsonb_build_object('category_id', pg_temp.id('rf_tax'), 'project_id', pg_temp.id('rf'), 'amount_minor', 50000, 'gross_up', false),
  jsonb_build_object('category_id', pg_temp.id('rf_int'), 'project_id', pg_temp.id('rf'), 'amount_minor', 30000, 'gross_up', false)));
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency, project_id)
values (pg_temp.id('co'), 'Example refinance loan', 20000000, 70000, 360, '2026-07-01', 130000, 0, 'ILS', pg_temp.id('rf'));
select tests.authenticate_as('prr_owner');
select is((public.get_property_returns(pg_temp.id('rf'), '2026-01-01', '2026-12-31')->'deal'->>'holding_minor')::bigint, -40000::bigint,
  'the refinance closing''s taxes are the rental''s; taxes before it and the payoff interest at it stay holding');
select is((public.get_property_return_lines(pg_temp.id('rf'), 'deal_holding')->>'total_minor')::bigint, -40000::bigint,
  'the deal_holding lines add up to the same holding');
select is((public.get_property_returns(pg_temp.id('rf'), '2026-01-01', '2026-12-31')->'equity'->>'money_in_minor')::bigint, -16910000::bigint,
  'the money in still counts every line of the refinance');

select * from finish();
rollback;
