-- FLOW-404 (decision 0143). A project's purchase, ARV and value (set_project_investment, MCP
-- set_project_investment with undo kind project_investment), the rehab switch per category
-- (set_category_rehab, MCP set_category_rehab with undo kind category_rehab), and the
-- investment block get_project returns. Invented data only. Amounts are agorot.

begin;

select plan(57);

do $users$
begin
  perform tests.create_supabase_user('pin_owner', 'pin-owner@example.com');
  perform tests.create_supabase_user('pin_viewer', 'pin-viewer@example.com');
  perform tests.create_supabase_user('pin_other', 'pin-other@example.com');
end
$users$;

create temp table pin (label text primary key, id uuid);
grant all on pin to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.pin where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into pin (label, id) values ('co', tests.fixture_company('pin_owner', 'Example Investment LLC', true));
insert into pin (label, id) values ('other_co', tests.fixture_company('pin_other', 'Example Other Investment LLC'));
insert into pin (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example House')),
  ('barn', tests.fixture_project(pg_temp.id('co'), 'Example Barn')),
  ('other_house', tests.fixture_project(pg_temp.id('other_co'), 'Other House')),
  ('materials', tests.fixture_category(pg_temp.id('co'), 'Materials')),
  ('purchase', tests.fixture_category(pg_temp.id('co'), 'Purchase', 'expense', true)),
  ('sales', tests.fixture_category(pg_temp.id('co'), 'Sales', 'income'));
insert into pin (label, id)
select 'interest', c.id from public.categories c
where c.company_id = pg_temp.id('co') and c.loan_part = 'interest';
insert into public.company_viewers (user_id, company_id)
values (tests.get_supabase_uid('pin_viewer'), pg_temp.id('co'));

-- Lines on the house. Rehab by default: materials 1000.00 + no category 200.00 + the house's
-- 100.00 of a shared 400.00 line = 1300.00.
insert into pin (label, id) values
  ('m1', tests.fixture_line(pg_temp.id('co'), 'pin:m1', 100000, p_project => pg_temp.id('house'), p_category => pg_temp.id('materials'))),
  ('k1', tests.fixture_line(pg_temp.id('co'), 'pin:k1', 50000000, p_project => pg_temp.id('house'), p_category => pg_temp.id('purchase'))),
  ('i1', tests.fixture_line(pg_temp.id('co'), 'pin:i1', 30000, p_project => pg_temp.id('house'), p_category => pg_temp.id('interest'))),
  ('n1', tests.fixture_line(pg_temp.id('co'), 'pin:n1', 20000, p_project => pg_temp.id('house'))),
  ('u1', tests.fixture_line(pg_temp.id('co'), 'pin:u1', 7000, p_project => pg_temp.id('house'), p_category => pg_temp.id('materials'), p_doc_kind => 'invoice')),
  ('usd', tests.fixture_line(pg_temp.id('co'), 'pin:usd', 5000, p_project => pg_temp.id('barn'), p_category => pg_temp.id('materials'), p_currency => 'USD')),
  ('inc', tests.fixture_line(pg_temp.id('co'), 'pin:inc', 99900, 'income', pg_temp.id('house'), pg_temp.id('sales'))),
  ('pend', tests.fixture_line(pg_temp.id('co'), 'pin:pend', 3000, p_project => pg_temp.id('house'), p_category => pg_temp.id('materials'), p_line_status => 'pending')),
  ('s1', tests.fixture_line(pg_temp.id('co'), 'pin:s1', 40000, p_category => pg_temp.id('materials'), p_pnl_role => 'shared'));
update public.transactions set cash_date = null where id = pg_temp.id('u1');
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net) values
  (pg_temp.id('co'), pg_temp.id('s1'), pg_temp.id('house'), 2500, -10000),
  (pg_temp.id('co'), pg_temp.id('s1'), pg_temp.id('barn'), 7500, -30000);

-- Loans: on the house an open one in shekels and one paid off; on the barn one in dollars.
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency, project_id
)
values
  (pg_temp.id('co'), 'House mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 0, 'ILS', pg_temp.id('house')),
  (pg_temp.id('co'), 'Barn dollar loan', 500000, 60000, 360, '2026-01-01', 5000, 0, 'USD', pg_temp.id('barn'));
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency, project_id, status, closed_on
)
values (pg_temp.id('co'), 'Old bridge loan', 900000, 60000, 12, '2025-01-01', 80000, 0, 'ILS', pg_temp.id('house'), 'paid_off', '2025-12-31');

-- A loan payment on the house in four parts. Its fees part sits in Materials, which counts
-- as rehab, but a loan part stays out of rehab unless that category is switched on. The
-- principal part lowers the mortgage balance to 119800.00.
insert into pin (label, id) values
  ('pay', tests.fixture_line(pg_temp.id('co'), 'pin:pay', 100000, p_project => pg_temp.id('house'), p_category => pg_temp.id('interest')));
insert into public.loan_splits (
  company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review
)
select pg_temp.id('co'), (select id from public.loans where name = 'House mortgage'), pg_temp.id('pay'),
  v.part::public.loan_split_part, v.amount, v.amount,
  coalesce(
    (select c.id from public.categories c where c.company_id = pg_temp.id('co') and c.loan_part = v.part::public.loan_split_part),
    pg_temp.id('materials')),
  false
from (values ('interest', 60000), ('escrow', 10000), ('principal', 20000), ('fees', 10000)) as v(part, amount);

select public.store_mcp_credential(tests.get_supabase_uid('pin_owner'), 'hash-pin-write01', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into pin (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-pin-write01';
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('pin_owner'), pg_temp.id('co'), 'hash-pin-read001', 'pepper-1', array['read'], now() + interval '90 days');
insert into pin (label, id) select 'read', id from private.mcp_credentials where token_hash = 'hash-pin-read001';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('pin_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id(p_label))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

create or replace function pg_temp.inv(p_project text default 'house')
returns jsonb
language sql
as $$ select public.get_project(pg_temp.id(p_project), 'cash')->'investment'; $$;
grant execute on function pg_temp.inv(text) to authenticated, service_role;

create temp table pin_out (label text primary key, body jsonb);
grant all on pin_out to authenticated, service_role;

select tests.authenticate_as('pin_owner');

-- Nothing set yet.
select is(pg_temp.inv()->>'purchase_agorot', null, 'no purchase price until one is set');
select is((pg_temp.inv()->>'rehab_agorot')::bigint, 130000::bigint,
  'rehab: posted paid shekel costs, direct and shared, but not kept-out, loan-part, unpaid, pending or income lines');
select is((pg_temp.inv()->>'loan_balance_agorot')::bigint, 11980000::bigint,
  'loan balance: the open shekel loan less the principal paid, not the paid-off one');
select is(pg_temp.inv()->'loan_balance_other_currencies', '[]'::jsonb, 'no loan in another currency on the house');
select is(pg_temp.inv('barn')->'loan_balance_other_currencies', '[{"currency": "USD", "balance_minor": 500000}]'::jsonb,
  'an open loan in another currency is listed apart');
select is(pg_temp.inv('barn')->'rehab_other_currencies', '[{"currency": "USD", "amount_minor": 5000}]'::jsonb,
  'and so is a cost in another currency');
select is(pg_temp.inv()->>'forced_equity_agorot', null, 'forced equity waits for ARV and purchase');
select is(pg_temp.inv()->>'current_equity_agorot', null, 'current equity waits for the value');
select is((pg_temp.inv('barn')->>'rehab_agorot')::bigint, 30000::bigint, 'the other project gets its share of the shared line');

-- The owner sets the figures.
insert into pin_out (label, body)
select 'set', public.set_project_investment(pg_temp.id('house'),
  '{"purchase_agorot": 100000000, "arv_agorot": 150000000, "value_agorot": 140000000, "value_date": "2026-09-30"}');
select is(pin_out.body->'before'->>'arv_agorot', null, 'the reply has the figures before') from pin_out where label = 'set';
select is((pin_out.body->'after'->>'arv_agorot')::bigint, 150000000::bigint, 'and after') from pin_out where label = 'set';
select is((pg_temp.inv()->>'forced_equity_agorot')::bigint, 150000000::bigint - 100000000 - 130000,
  'forced equity = ARV - purchase - rehab');
select is((pg_temp.inv()->>'current_equity_agorot')::bigint, 140000000::bigint - 11980000,
  'current equity = value - loan balance');
select public.set_project_investment(pg_temp.id('barn'),
  '{"purchase_agorot": 1000000, "arv_agorot": 2000000, "value_agorot": 1800000}');
select is(pg_temp.inv('barn')->>'forced_equity_agorot', null, 'forced equity is null when rehab has another currency');
select is(pg_temp.inv('barn')->>'current_equity_agorot', null, 'current equity is null when a loan is in another currency');
select is(pg_temp.inv()->>'value_date', '2026-09-30', 'the value date');

-- A key left out keeps its figure; a null clears it.
select public.set_project_investment(pg_temp.id('house'), '{"value_agorot": 145000000}');
select is((pg_temp.inv()->>'arv_agorot')::bigint, 150000000::bigint, 'a key left out keeps its figure');
select is((pg_temp.inv()->>'current_equity_agorot')::bigint, 145000000::bigint - 11980000, 'the new value counts');
select public.set_project_investment(pg_temp.id('house'), '{"purchase_agorot": null}');
select is(pg_temp.inv()->>'purchase_agorot', null, 'a null clears a figure');
select is(pg_temp.inv()->>'forced_equity_agorot', null, 'and forced equity waits again');
select public.set_project_investment(pg_temp.id('house'), '{"purchase_agorot": 100000000}');

-- Refusals.
select throws_ok($$select public.set_project_investment(pg_temp.id('house'), '{"arv_agorot": -1}')$$,
  'P0001', 'validation', 'a negative amount is validation');
select throws_ok($$select public.set_project_investment(pg_temp.id('house'), '{"arv_agorot": 12.5}')$$,
  'P0001', 'validation', 'a fraction of an agora');
select throws_ok($$select public.set_project_investment(pg_temp.id('house'), '{"arv_agorot": "100"}')$$,
  'P0001', 'validation', 'an amount as text');
select throws_ok($$select public.set_project_investment(pg_temp.id('house'), '{"value_date": "2026-02-30"}')$$,
  'P0001', 'validation', 'a date that does not exist');
select throws_ok($$select public.set_project_investment(pg_temp.id('house'), '{"budget_agorot": 1}')$$,
  'P0001', 'validation', 'a key it does not set');
select throws_ok($$select public.set_project_investment(pg_temp.id('house'), '{}')$$,
  'P0001', 'validation', 'an empty patch');
select throws_ok($$select public.set_project_investment(pg_temp.id('other_house'), '{"arv_agorot": 1}')$$,
  'P0001', 'project not found', 'another company''s project is not found');
reset role;
select is((select arv_agorot from public.projects where id = pg_temp.id('other_house')), null, 'and stays as it was');
select throws_ok($$update public.projects set value_agorot = -5 where id = pg_temp.id('house')$$,
  '23514', null, 'the table refuses a negative figure');
insert into pin (label, id)
select 'other_cat', c.id from public.categories c where c.company_id = pg_temp.id('other_co') limit 1;
select tests.authenticate_as('pin_owner');

-- The rehab switch.
select is(
  (select e->>'in_rehab' from jsonb_array_elements(public.list_categories()) e where e->>'id' = pg_temp.id('interest')::text),
  'false', 'list_categories: a loan part is out of rehab by default');
select is(
  (select e->'rehab' from jsonb_array_elements(public.list_categories()) e where e->>'id' = pg_temp.id('materials')::text),
  'null'::jsonb, 'and a category with no switch shows null');
select is(public.set_category_rehab(pg_temp.id('interest'), true), '{"before": null, "after": true}'::jsonb,
  'set_category_rehab returns the setting before and after');
select is((pg_temp.inv()->>'rehab_agorot')::bigint, 220000::bigint,
  'a loan part switched on counts, the interest part of the payment too');
select public.set_category_rehab(pg_temp.id('purchase'), true);
select is((pg_temp.inv()->>'rehab_agorot')::bigint, 50220000::bigint, 'so does a kept-out category');
select public.set_category_rehab(pg_temp.id('purchase'), null);
select public.set_category_rehab(pg_temp.id('materials'), false);
select is((pg_temp.inv()->>'rehab_agorot')::bigint, 110000::bigint,
  'a category switched off leaves rehab, direct and shared');
select is(
  (select e->>'in_rehab' from jsonb_array_elements(public.list_categories()) e where e->>'id' = pg_temp.id('materials')::text),
  'false', 'list_categories shows it');
select public.set_category_rehab(pg_temp.id('interest'), null);
select public.set_category_rehab(pg_temp.id('materials'), true);
select is((pg_temp.inv()->>'rehab_agorot')::bigint, 140000::bigint,
  'switched on, a category also takes the fees part filed in it');
select public.set_category_rehab(pg_temp.id('materials'), null);
select is((pg_temp.inv()->>'rehab_agorot')::bigint, 130000::bigint, 'null goes back to the default');
select throws_ok($$select public.set_category_rehab(pg_temp.id('other_cat'), true)$$,
  'P0001', 'category not found', 'another company''s category is not found');

-- A viewer reads but does not write.
select tests.authenticate_as('pin_viewer');
select is((pg_temp.inv()->>'arv_agorot')::bigint, 150000000::bigint, 'a viewer reads the investment');
select throws_ok($$select public.set_project_investment(pg_temp.id('house'), '{"arv_agorot": 1}')$$,
  '42501', 'forbidden', 'a viewer cannot set the figures');
select throws_ok($$select public.set_category_rehab(pg_temp.id('materials'), false)$$,
  '42501', 'forbidden', 'or the rehab switch');

-- MCP.
select pg_temp.as_mcp('write');
insert into pin_out (label, body)
select 'mcp_set', public.mcp_set_project_investment('pin-set-1', pg_temp.id('house'), '{"arv_agorot": 160000000}');
select is((select body->'data'->>'undo_kind' from pin_out where label = 'mcp_set'), 'project_investment',
  'MCP set_project_investment returns its undo kind');
select is((select (body->'data'->>'arv_agorot')::bigint from pin_out where label = 'mcp_set'), 160000000::bigint,
  'and the figures after');
select is(public.mcp_set_project_investment('pin-set-1', pg_temp.id('house'), '{"arv_agorot": 160000000}'),
  (select body from pin_out where label = 'mcp_set'), 'a replay returns the same answer');
select is(public.mcp_set_project_investment('pin-set-2', pg_temp.id('house'), '{"arv_agorot": -1}')->'error'->>'code',
  'validation', 'a negative amount is validation');
select is(public.mcp_set_project_investment('pin-set-3', pg_temp.id('other_house'), '{"arv_agorot": 1}')->'error'->>'message',
  'project not found', 'another company''s project is refused as not found');
select is(public.mcp_undo('pin-undo-1', 'project_investment', pg_temp.id('house'))->>'ok', 'true', 'undo works');
select is((pg_temp.inv()->>'arv_agorot')::bigint, 150000000::bigint, 'and puts the ARV back');

-- Undo after the owner changed the figures again is a conflict.
select public.mcp_set_project_investment('pin-set-4', pg_temp.id('house'), '{"value_date": "2026-10-01"}');
select tests.authenticate_as('pin_owner');
select public.set_project_investment(pg_temp.id('house'), '{"value_date": "2026-10-02"}');
select pg_temp.as_mcp('write');
select is(public.mcp_undo('pin-undo-2', 'project_investment', pg_temp.id('house'))->'error'->>'code', 'conflict',
  'undo after a later change is a conflict');

insert into pin_out (label, body)
select 'mcp_rehab', public.mcp_set_category_rehab('pin-rehab-1', pg_temp.id('interest'), true);
select is((select body->'data'->>'in_rehab' from pin_out where label = 'mcp_rehab'), 'true',
  'MCP set_category_rehab returns what the switch comes to');
select is((pg_temp.inv()->>'rehab_agorot')::bigint, 220000::bigint, 'and rehab follows');
select is(public.mcp_undo('pin-undo-3', 'category_rehab', pg_temp.id('interest'))->>'ok', 'true', 'undo works');
select is((select rehab from public.categories where id = pg_temp.id('interest')), null, 'and puts the default back');
select is(public.mcp_undo('pin-undo-4', 'category_rehab', pg_temp.id('interest'))->'error'->>'code', 'not_found',
  'a second undo finds nothing to undo');
select public.mcp_set_category_rehab('pin-rehab-2', pg_temp.id('materials'), false);
select tests.authenticate_as('pin_owner');
select public.set_category_rehab(pg_temp.id('materials'), true);
select pg_temp.as_mcp('write');
select is(public.mcp_undo('pin-undo-5', 'category_rehab', pg_temp.id('materials'))->'error'->>'code', 'conflict',
  'undo after a later change is a conflict');

select pg_temp.as_mcp('read');
select is(public.mcp_set_category_rehab('pin-rehab-3', pg_temp.id('materials'), null)->'error'->>'code', 'forbidden',
  'a read token cannot write');

select * from finish();
rollback;
