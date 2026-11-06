-- FLOW-1068 (decision 0261). The selling cost input (set_project_investment, undo kind
-- project_investment), a renovation's net profit and ROI, and a rental's new metrics on
-- get_property_returns. Invented data only; amounts are cents of an invented company's dollars.

begin;

select plan(46);

do $users$
begin
  perform tests.create_supabase_user('roi_owner', 'roi-owner@example.com');
end
$users$;

create temp table roi (label text primary key, id uuid);
grant all on roi to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.roi where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into roi (label, id) values ('co', tests.fixture_company('roi_owner', 'Example ROI LLC', true));
insert into roi (label, id) values
  ('flip', tests.fixture_project(pg_temp.id('co'), 'Example Flip')),
  ('rental', tests.fixture_project(pg_temp.id('co'), 'Example Rental')),
  ('repairs', tests.fixture_category(pg_temp.id('co'), 'Repairs')),
  ('roof', tests.fixture_category(pg_temp.id('co'), 'Roof')),
  ('purchase', tests.fixture_category(pg_temp.id('co'), 'Purchase', 'expense', true)),
  ('rent', tests.fixture_category(pg_temp.id('co'), 'Rent', 'income')),
  ('proceeds', tests.fixture_category(pg_temp.id('co'), 'Loan proceeds', 'income', true));
update public.categories set rehab = true where id = pg_temp.id('roof');
-- Repairs is switched out of rehab, so the flip's 2,000.00 is a holding cost only.
update public.categories set rehab = false where id = pg_temp.id('repairs');
update public.projects set investment_currency = 'USD' where id in (pg_temp.id('flip'), pg_temp.id('rental'));

-- The flip: bought for 150,000.00 on 2026-01-05 with 110,000.00 of loan proceeds, a 30,000.00 roof,
-- and 2,000.00 of holding costs. No rent.
insert into roi (label, id) values
  ('f_buy', tests.fixture_line(pg_temp.id('co'), 'roi:f_buy', 15000000, p_project => pg_temp.id('flip'), p_category => pg_temp.id('purchase'), p_doc_date => '2026-01-05', p_currency => 'USD')),
  ('f_proc', tests.fixture_line(pg_temp.id('co'), 'roi:f_proc', 11000000, 'income', pg_temp.id('flip'), pg_temp.id('proceeds'), '2026-01-05', p_currency => 'USD')),
  ('f_roof', tests.fixture_line(pg_temp.id('co'), 'roi:f_roof', 3000000, p_project => pg_temp.id('flip'), p_category => pg_temp.id('roof'), p_doc_date => '2026-02-01', p_currency => 'USD')),
  ('f_hold', tests.fixture_line(pg_temp.id('co'), 'roi:f_hold', 200000, p_project => pg_temp.id('flip'), p_category => pg_temp.id('repairs'), p_doc_date => '2026-03-01', p_currency => 'USD'));

-- The rental: bought for 100,000.00 on 2026-01-05, rent of 12,000.00 from 2026-06-01, repairs of
-- 2,000.00 after it, no loan.
insert into roi (label, id) values
  ('r_buy', tests.fixture_line(pg_temp.id('co'), 'roi:r_buy', 10000000, p_project => pg_temp.id('rental'), p_category => pg_temp.id('purchase'), p_doc_date => '2026-01-05', p_currency => 'USD')),
  ('r_rent', tests.fixture_line(pg_temp.id('co'), 'roi:r_rent', 1200000, 'income', pg_temp.id('rental'), pg_temp.id('rent'), '2026-06-01', p_currency => 'USD')),
  ('r_rep', tests.fixture_line(pg_temp.id('co'), 'roi:r_rep', 200000, p_project => pg_temp.id('rental'), p_category => pg_temp.id('repairs'), p_doc_date => '2026-07-01', p_currency => 'USD'));

select public.store_mcp_credential(tests.get_supabase_uid('roi_owner'), 'hash-roi-write01', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into roi (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-roi-write01';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('roi_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id('write'))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

create or replace function pg_temp.ret(p_label text)
returns jsonb
language sql
as $$ select public.get_property_returns(pg_temp.id(p_label), '2026-01-01', '2026-12-31'); $$;
grant execute on function pg_temp.ret(text) to authenticated, service_role;

select tests.authenticate_as('roi_owner');

-- No ARV yet: the deal's figures that need it are null, the default selling cost stands.
select is((pg_temp.ret('flip')->'deal'->>'selling_cost_bp')::integer, 800, 'the selling cost is 8% until set');
select is(pg_temp.ret('flip')->'deal'->>'selling_cost_default', 'true', 'and says it is the default');
select is(pg_temp.ret('flip')->'deal'->'net_profit_minor', 'null'::jsonb, 'no ARV: no net profit');
select is(pg_temp.ret('flip')->'metrics'->'rule_70_minor', 'null'::jsonb, 'no ARV: no 70% rule');
select is((pg_temp.ret('flip')->'metrics'->>'break_even_sale_minor')::bigint, 19782609::bigint,
  'the break-even sale needs no ARV: (purchase + rehab + holding) / (1 - 8%)');
select is(pg_temp.ret('flip')->'deal'->>'acquired_on', '2026-01-05', 'the first purchase line dates the purchase');
select is((pg_temp.ret('flip')->'deal'->>'held_days')::integer, 361, 'held from the purchase to the end of the period');

select public.set_project_investment(pg_temp.id('flip'), '{"arv_minor": 25000000}'::jsonb);

select is((pg_temp.ret('flip')->'deal'->>'selling_cost_minor')::bigint, 2000000::bigint, 'selling costs: 8% of the ARV');
select is((pg_temp.ret('flip')->'deal'->>'holding_minor')::bigint, -200000::bigint, 'the holding costs rehab does not count');
select is((pg_temp.ret('flip')->'deal'->>'net_profit_minor')::bigint, 4800000::bigint,
  'net profit = ARV - selling - purchase - rehab - holding');
select is((pg_temp.ret('flip')->'equity'->>'forced_equity_minor')::bigint, 7000000::bigint,
  'forced equity stays ARV - purchase - rehab');
select is((pg_temp.ret('flip')->'equity'->>'money_in_minor')::bigint, 7200000::bigint, 'money in, as before');
select is((pg_temp.ret('flip')->'metrics'->>'flip_roi_bp')::integer, 6667, 'ROI = net profit / money in');
select is((pg_temp.ret('flip')->'metrics'->>'flip_roi_year_bp')::integer, 6741, 'ROI per year = ROI x 365 / days held');
select is((pg_temp.ret('flip')->'metrics'->>'arv_margin_bp')::integer, 1920, 'margin on the ARV = net profit / ARV');
select is((pg_temp.ret('flip')->'metrics'->>'rule_70_minor')::bigint, -500000::bigint,
  '70% rule = ARV x 70% - rehab - purchase (negative: paid over it)');

-- The selling cost: validation, a write, and its undo through MCP.
select throws_ok($$ select public.set_project_investment(pg_temp.id('flip'), '{"selling_cost_bp": 3001}'::jsonb) $$,
  'validation', 'a selling cost over 30% is refused');
select throws_ok($$ select public.set_project_investment(pg_temp.id('flip'), '{"selling_cost_bp": 5.5}'::jsonb) $$,
  'validation', 'a selling cost is whole basis points');
select pg_temp.as_mcp();
select is(public.mcp_set_project_investment('roi-sell-1', pg_temp.id('flip'), '{"selling_cost_bp": 600}'::jsonb)->>'ok', 'true',
  'MCP sets the selling cost');
select is((pg_temp.ret('flip')->'deal'->>'net_profit_minor')::bigint, 5300000::bigint, 'at 6% the net profit grows');
select is(pg_temp.ret('flip')->'deal'->>'selling_cost_default', 'false', 'the selling cost is the owner''s now');
select is(public.mcp_undo('roi-undo-1', 'project_investment', pg_temp.id('flip'))->>'ok', 'true', 'undo puts it back');
select is(pg_temp.ret('flip')->'deal'->>'selling_cost_default', 'true', 'back to the default 8%');
select tests.authenticate_as('roi_owner');

-- The review of #1012: a loan's principal paid before the sale pays back the loan that funded the
-- price, so it is no holding cost; its interest is.
reset role;
insert into roi (label, id)
select 'f_principal', tests.fixture_line(pg_temp.id('co'), 'roi:f_principal', 1000000, p_project => pg_temp.id('flip'),
  p_category => c.id, p_doc_date => '2026-03-05', p_currency => 'USD')
from public.categories c where c.company_id = pg_temp.id('co') and c.loan_part = 'principal';
select tests.authenticate_as('roi_owner');
select is((pg_temp.ret('flip')->'deal'->>'holding_minor')::bigint, -200000::bigint, 'a principal payment is no holding cost');
select is((pg_temp.ret('flip')->'deal'->>'net_profit_minor')::bigint, 4800000::bigint, 'nor does it come off the net profit');
reset role;
insert into roi (label, id)
select 'f_interest', tests.fixture_line(pg_temp.id('co'), 'roi:f_interest', 50000, p_project => pg_temp.id('flip'),
  p_category => c.id, p_doc_date => '2026-03-05', p_currency => 'USD')
from public.categories c where c.company_id = pg_temp.id('co') and c.loan_part = 'interest';
select tests.authenticate_as('roi_owner');
select is((pg_temp.ret('flip')->'deal'->>'holding_minor')::bigint, -250000::bigint, 'the interest paid before the sale is a holding cost');
select is((pg_temp.ret('flip')->'deal'->>'net_profit_minor')::bigint, 4750000::bigint, 'and comes off the net profit');
-- FLOW-1071: the holding costs' own lines add up to the figure: the holding and the interest, not the principal.
select is((public.get_property_return_lines(pg_temp.id('flip'), 'deal_holding')->>'total_minor')::bigint, -250000::bigint,
  'deal_holding lines add up to deal.holding_minor');
select is((public.get_property_return_lines(pg_temp.id('flip'), 'deal_holding')->>'count')::integer, 2,
  'deal_holding lists the holding line and the interest');
select throws_ok($$ select public.get_property_return_lines(pg_temp.id('flip'), 'deal_holdings') $$, '22023', 'validation',
  'an unknown line is still refused');

-- FLOW-1070: a split loan payment before the sale: its interest and escrow are holding costs, its principal is
-- not. (A part sits only in a category of its own loan part, or of none, so the category and the part agree.)
reset role;
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor,
  escrow_minor, currency, project_id)
values (pg_temp.id('co'), 'Example flip loan', 11000000, 80000, 12, '2026-01-05', 100000, 0, 'USD', pg_temp.id('flip'));
-- One payment of 120.00: interest 10.00, escrow 100.00, principal 10.00, each in its own loan category.
insert into roi (label, id)
select 'f_escrow', tests.fixture_line(pg_temp.id('co'), 'roi:f_escrow', 12000, p_project => pg_temp.id('flip'),
  p_category => c.id, p_doc_date => '2026-03-06', p_currency => 'USD')
from public.categories c where c.company_id = pg_temp.id('co') and c.loan_part = 'interest';
select tests.loan_split(pg_temp.id('f_escrow'), (select id from public.loans where name = 'Example flip loan'), (
  select jsonb_agg(jsonb_build_object('part', v.part, 'amount_minor', v.amount, 'scheduled_minor', v.amount,
    'category_id', (select c.id from public.categories c where c.company_id = pg_temp.id('co') and c.loan_part = v.cat::public.loan_split_part),
    'needs_review', false) order by v.n)
  from (values (1, 'interest', 'interest', 1000), (2, 'escrow', 'escrow', 10000), (3, 'principal', 'principal', 1000)) as v(n, part, cat, amount)));
select tests.authenticate_as('roi_owner');
select is((pg_temp.ret('flip')->'deal'->>'holding_minor')::bigint, -261000::bigint,
  'a split payment''s interest and escrow are holding costs, its principal is not');
select is((public.get_property_return_lines(pg_temp.id('flip'), 'deal_holding')->>'total_minor')::bigint, -261000::bigint,
  'and deal_holding lists the same');

-- FLOW-1069: the IRR. A year's flows of -1,000.00 then +1,100.00 are 10%.
select is(round(private.xirr(array['2025-01-01', '2026-01-01']::date[], array[-1000, 1100]::numeric[]) * 10000)::integer, 1000,
  'xirr: -1,000 then +1,100 a year later is 10%');
select is(private.xirr(array['2025-01-01', '2026-01-01']::date[], array[1000, 1100]::numeric[]), null,
  'xirr: flows that never change sign have no rate');

-- The rental's new metrics. Income 12,000.00, operating expenses 2,000.00, no loan; the value is
-- 120,000.00 with no loan, so the equity today is 120,000.00. The first rent is 214 days back.
select public.set_project_investment(pg_temp.id('rental'), '{"value_minor": 12000000, "value_date": "2026-01-10"}'::jsonb);
select is((pg_temp.ret('rental')->'metrics'->>'break_even_occupancy_bp')::integer, 1667,
  'break-even occupancy = (operating expenses + loan payments) / income');
select is((pg_temp.ret('rental')->'metrics'->>'expense_ratio_bp')::integer, 1667, 'expense ratio = operating expenses / income');
select is((pg_temp.ret('rental')->'metrics'->>'grm_milli')::integer, 4886, 'GRM = purchase / the income for a year');
select is((pg_temp.ret('rental')->'metrics'->>'roi_since_purchase_bp')::integer, 3000,
  'ROI since purchase = (cash back + equity today - money in) / money in');
select is((pg_temp.ret('rental')->'metrics'->>'equity_multiple_milli')::integer, 1300,
  'equity multiplier = (cash back + equity today) / money in');

-- The rental's IRR: -100,000.00 on 2026-01-05, +12,000.00 rent on 06-01, -2,000.00 on 07-01, and the equity
-- of 120,000.00 at the period's end, 2026-12-31: 32.34% a year (worked out apart, by the same bisection).
select is((pg_temp.ret('rental')->'metrics'->>'irr_bp')::integer, 3234, 'IRR since the purchase, on the dated cash and today''s equity');
select is((pg_temp.ret('rental')->'deal'->>'irr_terminal_minor')::bigint, 12000000::bigint, 'the last flow is today''s equity');
select is((pg_temp.ret('rental')->'deal'->>'irr_out_minor')::bigint, -10200000::bigint, 'what went in');
select is((pg_temp.ret('rental')->'deal'->>'irr_in_minor')::bigint, 1200000::bigint, 'what came back before the end');
select is((pg_temp.ret('rental')->'deal'->>'irr_dates')::integer, 4, 'four dates of cash');
-- The IRR page's rows open lines that add up to them (the review of #1016). The default period ends today,
-- so these read from the purchase line to today.
select is((public.get_property_return_lines(pg_temp.id('rental'), 'irr_out')->>'total_minor')::bigint,
  (public.get_property_returns(pg_temp.id('rental'))->'deal'->>'irr_out_minor')::bigint, 'irr_out lines add up to what went in');
select is((public.get_property_return_lines(pg_temp.id('rental'), 'irr_in')->>'total_minor')::bigint,
  (public.get_property_returns(pg_temp.id('rental'))->'deal'->>'irr_in_minor')::bigint, 'irr_in lines add up to what came back');

select * from finish();
rollback;
