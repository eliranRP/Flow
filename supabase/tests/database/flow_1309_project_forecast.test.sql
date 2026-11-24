-- FLOW-1309: public.project_forecast, a project's forecast for a month in one read (migration 20261123084637).
-- - On the fixture company of flow_1307_company_forecast.test.sql (three projects, a finished one and an overhead
--   office; recurring rent, power, cleaning and accounting; one-off costs; loans of each kind with rate changes, split
--   payments, a demand, a refused, a closed, a dollar and a finished project's loan; the owner's edits, a matched added
--   line and one-month skips) its answer for each project equals the app's own build: each expected answer below is what
--   the project page builds from the separate reads it makes today (expected_months for the project, project_category_
--   months, project_forecast_edits_for, forecast_overrides_for, get_project's loans, list_categories; the company's
--   inputs and loans for the overhead office), run through nextMonthForecast, applyForecastEdits, skipEdits and
--   cashForecast (companyGeneralForecast for the office), as app/src/project-forecast-vectors.test.ts shapes them. So
--   the gathering is checked, not only the core (vectors_project_forecast.test.sql runs the shared vectors). Every id
--   the answer names is fixed, so the answers are written out as they come.
-- - The edit page's history equals project_category_months' months and categories, and its charges the project's
--   expected_months charges; every amount is an integer under 2^53; absent = null (no null in an answer).
-- - Israel midnight: 31 October and 1 November are two forecasts; p_today null is today in Israel.
-- - A bad project, month or currency is refused (22023); another company's member, and a user with no company, get
--   nothing (null, as get_project does) for a project that is not theirs; anon cannot execute it.
-- Invented data only, @example.com only. Amounts are agorot. "Today" is 2026-10-20 unless a case says otherwise.

begin;

select plan(42);


do $users$
begin
  perform tests.create_supabase_user('f1309_owner', 'owner1309@example.com');
  perform tests.create_supabase_user('f1309_other', 'other1309@example.com');
  perform tests.create_supabase_user('f1309_nobody', 'nobody1309@example.com');
end
$users$;

-- Every id the answer names is fixed, so the expected answers below can be written out (the rows come by key).
create temp table f1309 (label text primary key, id uuid);
grant all on f1309 to authenticated, service_role;
insert into f1309 (label, id) values
  ('house', '13090000-0000-4000-8000-000000000001'), ('flat', '13090000-0000-4000-8000-000000000002'),
  ('shop', '13090000-0000-4000-8000-000000000003'), ('sold', '13090000-0000-4000-8000-000000000004'),
  ('office', '13090000-0000-4000-8000-000000000005'), ('b_house', '13090000-0000-4000-8000-000000000006'),
  ('c_rent', '13090000-0000-4000-8000-000000000011'), ('c_rent_flat', '13090000-0000-4000-8000-000000000012'),
  ('c_extra', '13090000-0000-4000-8000-000000000013'), ('c_repairs', '13090000-0000-4000-8000-000000000014'),
  ('c_power', '13090000-0000-4000-8000-000000000015'), ('c_cleaning', '13090000-0000-4000-8000-000000000016'),
  ('c_accounting', '13090000-0000-4000-8000-000000000017'), ('c_interest', '13090000-0000-4000-8000-000000000018'),
  ('c_escrow', '13090000-0000-4000-8000-000000000019'), ('c_bridge', '13090000-0000-4000-8000-000000000020'),
  ('b_rent', '13090000-0000-4000-8000-000000000021'),
  ('tenant_a', '13090000-0000-4000-8000-000000000031'), ('tenant_b', '13090000-0000-4000-8000-000000000032'),
  ('power', '13090000-0000-4000-8000-000000000033'), ('cleaner', '13090000-0000-4000-8000-000000000034'),
  ('accountant', '13090000-0000-4000-8000-000000000035'), ('servicer', '13090000-0000-4000-8000-000000000036'),
  ('b_tenant', '13090000-0000-4000-8000-000000000037'),
  ('l_mortgage', '13090000-0000-4000-8000-000000000041'), ('l_bridge', '13090000-0000-4000-8000-000000000042'),
  ('l_balloon', '13090000-0000-4000-8000-000000000043'), ('l_demand', '13090000-0000-4000-8000-000000000044'),
  ('l_refused', '13090000-0000-4000-8000-000000000045'), ('l_closed', '13090000-0000-4000-8000-000000000046'),
  ('l_dollar', '13090000-0000-4000-8000-000000000047'), ('l_sold', '13090000-0000-4000-8000-000000000048'),
  ('l_general', '13090000-0000-4000-8000-000000000049'), ('l_b', '13090000-0000-4000-8000-000000000050'),
  ('e_repairs', '13090000-0000-4000-8000-000000000061'), ('e_power', '13090000-0000-4000-8000-000000000062'),
  ('e_extra', '13090000-0000-4000-8000-000000000063'), ('e_cleaner', '13090000-0000-4000-8000-000000000064'),
  ('e_shop', '13090000-0000-4000-8000-000000000065'), ('e_sold', '13090000-0000-4000-8000-000000000066'),
  ('e_interest', '13090000-0000-4000-8000-000000000067'), ('e_escrow', '13090000-0000-4000-8000-000000000068');

create function pg_temp.id(p_label text) returns uuid language sql stable set search_path = '' as $$
  select id from pg_temp.f1309 where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

do $setup$
declare
  a uuid;
  b uuid;
  principal_cat uuid;
begin
  a := tests.fixture_company('f1309_owner', 'Example Forecast Holdings 1309');
  b := tests.fixture_company('f1309_other', 'Sample Other Rentals 1309');
  insert into pg_temp.f1309 values ('a', a), ('b', b);

  -- Three active projects, a finished one and the overhead office; the other company's house.
  insert into public.projects (id, company_id, name, status) values
    (pg_temp.id('house'), a, 'Example House', 'active'),
    (pg_temp.id('flat'), a, 'Example Flat', 'active'),
    (pg_temp.id('shop'), a, 'Example Shop', 'active'),
    (pg_temp.id('sold'), a, 'Example Sold', 'finished'),
    (pg_temp.id('office'), a, 'Example Office', 'active'),
    (pg_temp.id('b_house'), b, 'Other House', 'active');
  update public.companies set overhead_project_id = pg_temp.id('office') where id = a;

  -- Rent (by name and as a sub-category), other income, costs, the loans' parts, and a bridge loan's interest kept out
  -- of the profit (decision 0166).
  insert into public.categories (id, company_id, name, kind, sort_order, is_default, excluded_from_pnl, parent_id) values
    (pg_temp.id('c_rent'), a, 'שכירות דירות', 'income', 101, false, false, null),
    (pg_temp.id('c_rent_flat'), a, 'דירה ב', 'income', 102, false, false, pg_temp.id('c_rent')),
    (pg_temp.id('c_extra'), a, 'הכנסה נוספת', 'income', 103, false, false, null),
    (pg_temp.id('c_repairs'), a, 'תיקונים', 'expense', 104, false, false, null),
    (pg_temp.id('c_power'), a, 'חשמל ומים', 'expense', 105, false, false, null),
    (pg_temp.id('c_cleaning'), a, 'ניקיון', 'expense', 106, false, false, null),
    (pg_temp.id('c_accounting'), a, 'הנהלת חשבונות', 'expense', 107, false, false, null),
    (pg_temp.id('c_interest'), a, 'ריבית הלוואה', 'expense', 108, false, false, null),
    (pg_temp.id('c_escrow'), a, 'ארנונה וביטוח', 'expense', 109, false, false, null),
    (pg_temp.id('c_bridge'), a, 'ריבית גישור', 'expense', 110, false, true, null),
    (pg_temp.id('b_rent'), b, 'שכירות דירות', 'income', 101, false, false, null);

  insert into public.customers (id, company_id, name) values
    (pg_temp.id('tenant_a'), a, 'Example Tenant A'), (pg_temp.id('tenant_b'), a, 'Example Tenant B'),
    (pg_temp.id('b_tenant'), b, 'Sample Tenant');
  insert into public.suppliers (id, company_id, name) values
    (pg_temp.id('power'), a, 'Example Power'), (pg_temp.id('cleaner'), a, 'Example Cleaning'),
    (pg_temp.id('accountant'), a, 'Example Accounting'), (pg_temp.id('servicer'), a, 'Example Mortgage Servicing');

  -- The lines: label, company, amount, direction, project, category, day, party, pnl role, kind.
  create temp table f1309_lines (label text, co uuid, amount bigint, direction text, project text, cat text, doc_date date, party text, role text, kind text);
  insert into f1309_lines values
    ('rent_a7', a, 450000, 'income', 'house', 'c_rent', '2026-07-01', 'tenant_a', 'project', 'invoice'),
    ('rent_a8', a, 450000, 'income', 'house', 'c_rent', '2026-08-01', 'tenant_a', 'project', 'invoice'),
    ('rent_a9', a, 450000, 'income', 'house', 'c_rent', '2026-09-01', 'tenant_a', 'project', 'invoice'),
    ('rent_a10', a, 450000, 'income', 'house', 'c_rent', '2026-10-01', 'tenant_a', 'project', 'invoice'),
    ('rent_b7', a, 380000, 'income', 'flat', 'c_rent_flat', '2026-07-03', 'tenant_b', 'project', 'invoice'),
    ('rent_b8', a, 380000, 'income', 'flat', 'c_rent_flat', '2026-08-03', 'tenant_b', 'project', 'invoice'),
    ('rent_b9', a, 380000, 'income', 'flat', 'c_rent_flat', '2026-09-03', 'tenant_b', 'project', 'invoice'),
    ('pow7', a, 18000, 'expense', 'house', 'c_power', '2026-07-12', 'power', 'project', 'receipt'),
    ('pow8', a, 18000, 'expense', 'house', 'c_power', '2026-08-12', 'power', 'project', 'receipt'),
    ('pow9', a, 18000, 'expense', 'house', 'c_power', '2026-09-12', 'power', 'project', 'receipt'),
    ('clean7', a, 25000, 'expense', 'office', 'c_cleaning', '2026-07-15', 'cleaner', 'overhead', 'receipt'),
    ('clean8', a, 25000, 'expense', 'office', 'c_cleaning', '2026-08-15', 'cleaner', 'overhead', 'receipt'),
    ('clean9', a, 25000, 'expense', 'office', 'c_cleaning', '2026-09-15', 'cleaner', 'overhead', 'receipt'),
    ('acct7', a, 60000, 'expense', null, 'c_accounting', '2026-07-20', 'accountant', null, 'receipt'),
    ('acct8', a, 60000, 'expense', null, 'c_accounting', '2026-08-20', 'accountant', null, 'receipt'),
    ('acct9', a, 60000, 'expense', null, 'c_accounting', '2026-09-20', 'accountant', null, 'receipt'),
    -- One-off costs: the averages.
    ('fix5', a, 50000, 'expense', 'house', 'c_repairs', '2026-05-10', null, 'project', 'receipt'),
    ('fix7', a, 30000, 'expense', 'house', 'c_repairs', '2026-07-14', null, 'project', 'receipt'),
    ('fix9', a, 12345, 'expense', 'house', 'c_repairs', '2026-09-09', null, 'project', 'receipt'),
    ('flatfix6', a, 8000, 'expense', 'flat', 'c_repairs', '2026-06-02', null, 'project', 'receipt'),
    ('shopmisc8', a, 7000, 'expense', 'shop', null, '2026-08-25', null, 'project', 'receipt'),
    ('genmisc9', a, 9001, 'expense', null, null, '2026-09-26', null, null, 'receipt'),
    -- The other company's rent.
    ('b_rent7', b, 300000, 'income', 'b_house', 'b_rent', '2026-07-05', 'b_tenant', 'project', 'invoice'),
    ('b_rent8', b, 300000, 'income', 'b_house', 'b_rent', '2026-08-05', 'b_tenant', 'project', 'invoice'),
    ('b_rent9', b, 300000, 'income', 'b_house', 'b_rent', '2026-09-05', 'b_tenant', 'project', 'invoice');
  insert into pg_temp.f1309 (label, id)
  select l.label, tests.fixture_line(l.co, 'f1309:' || l.label, l.amount, l.direction, pg_temp.id(l.project), pg_temp.id(l.cat), l.doc_date,
    p_pnl_role => l.role, p_doc_kind => l.kind)
  from f1309_lines l;
  update public.transactions t set supplier_id = pg_temp.id(l.party) from f1309_lines l where t.id = pg_temp.id(l.label) and l.direction = 'expense' and l.party is not null;
  update public.transactions t set customer_id = pg_temp.id(l.party) from f1309_lines l where t.id = pg_temp.id(l.label) and l.direction = 'income';

  -- The loans: id, company, project, name, currency, principal, rate ppm, term, start, payment, escrow, kind, interest only
  -- months, amortization months, interest and escrow categories.
  insert into public.loans (id, company_id, project_id, name, currency, principal_minor, annual_rate_ppm, term_months, start_date,
    payment_minor, escrow_minor, kind, interest_only_months, amortization_months, interest_category_id, escrow_category_id)
  select pg_temp.id(v.label), v.co, pg_temp.id(v.project), v.label, v.currency, v.principal, v.rate, v.term, v.start::date,
    v.payment, v.escrow, v.kind::public.loan_kind, v.io, v.am, pg_temp.id(v.icat), pg_temp.id(v.ecat)
  from (values
    ('l_mortgage', a, 'house', 'ILS', 120000000, 55000, 360, '2026-08-01', 730000, 45000, 'amortizing', null::integer, null::integer, 'c_interest', 'c_escrow'),
    ('l_bridge', a, 'flat', 'ILS', 40000000, 70000, 24, '2026-06-15', 233334, 0, 'interest_only', 12, null, 'c_bridge', null),
    ('l_balloon', a, 'office', 'ILS', 30000000, 65000, 60, '2026-03-01', 200000, 10000, 'balloon', null, 360, 'c_interest', 'c_escrow'),
    ('l_general', a, null, 'ILS', 6000000, 48000, 120, '2025-11-10', 64000, 0, 'amortizing', null, null, 'c_interest', null),
    ('l_closed', a, 'house', 'ILS', 10000000, 50000, 120, '2025-01-01', 110000, 0, 'amortizing', null, null, 'c_interest', null),
    ('l_dollar', a, 'shop', 'USD', 10000000, 50000, 120, '2025-01-01', 110000, 0, 'amortizing', null, null, 'c_interest', null),
    ('l_sold', a, 'sold', 'ILS', 10000000, 50000, 120, '2025-01-01', 110000, 0, 'amortizing', null, null, 'c_interest', null),
    ('l_b', b, 'b_house', 'ILS', 50000000, 50000, 360, '2026-01-01', 300000, 0, 'amortizing', null, null, null, null)
  ) v(label, co, project, currency, principal, rate, term, start, payment, escrow, kind, io, am, icat, ecat);
  insert into public.loans (id, company_id, project_id, name, currency, principal_minor, annual_rate_ppm, start_date, escrow_minor, kind)
  values (pg_temp.id('l_demand'), a, pg_temp.id('shop'), 'l_demand', 'ILS', 5000000, 60000, '2025-11-01', 0, 'demand');
  -- A payment below the interest: the schedule refuses it (the payment check is off for this insert, as in
  -- flow_1310_loan_outlooks.test.sql).
  alter table public.loans disable trigger loans_payment_covers_interest;
  insert into public.loans (id, company_id, project_id, name, currency, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, kind)
  values (pg_temp.id('l_refused'), a, pg_temp.id('shop'), 'l_refused', 'ILS', 24000000, 62500, 360, '2025-01-01', 100000, 0, 'amortizing');
  alter table public.loans enable trigger loans_payment_covers_interest;
  update public.loans set status = 'closed', closed_on = '2026-06-30' where id = pg_temp.id('l_closed');
  -- Rate changes (a recast) on the mortgage and the general loan.
  insert into public.loan_rates (company_id, loan_id, effective_date, annual_rate_ppm) values
    (a, pg_temp.id('l_mortgage'), '2027-02-01', 60000),
    (a, pg_temp.id('l_general'), '2027-03-10', 52000);

  -- The mortgage's payments in August to October, split, with 500,000 of extra principal in October: the balance in the
  -- books is below the schedule's.
  select c.id into principal_cat from public.categories c where c.company_id = a and c.loan_part = 'principal' limit 1;
  create temp table f1309_pay (label text, doc_date date, principal bigint);
  insert into f1309_pay values ('pay8', '2026-08-01', 135000), ('pay9', '2026-09-01', 135000), ('pay10', '2026-10-01', 635000);
  insert into pg_temp.f1309 (label, id)
  select p.label, tests.fixture_line(a, 'f1309:' || p.label, 595000 + p.principal, 'expense', pg_temp.id('house'), null, p.doc_date)
  from f1309_pay p;
  update public.transactions t set supplier_id = pg_temp.id('servicer') from f1309_pay p where t.id = pg_temp.id(p.label);
  perform tests.loan_split(pg_temp.id(p.label), pg_temp.id('l_mortgage'), jsonb_build_array(
    jsonb_build_object('part', 'interest', 'amount_minor', 550000, 'scheduled_minor', 550000, 'category_id', pg_temp.id('c_interest')),
    jsonb_build_object('part', 'escrow', 'amount_minor', 45000, 'scheduled_minor', 45000, 'category_id', pg_temp.id('c_escrow')),
    jsonb_build_object('part', 'principal', 'amount_minor', p.principal, 'scheduled_minor', p.principal, 'category_id', principal_cat)))
  from f1309_pay p;

  -- The owner's edits, written straight into the table: repairs set for November; power taken out from December; other
  -- income added on the flat; the office's cleaning changed (a general cost); a quarterly cost added on the shop, its
  -- February line already in; the mortgage's two rows taken out of December (none of its payment is cash then); and an
  -- edit of the finished project, which adds nothing.
  insert into public.project_forecast_edits (id, company_id, project_id, kind, row_key, category_id, direction, amount_minor, pace, start_month) values
    (pg_temp.id('e_repairs'), a, pg_temp.id('house'), 'change', 'avg:' || pg_temp.id('c_repairs'), null, null, 20000, 'once', '2026-11'),
    (pg_temp.id('e_power'), a, pg_temp.id('house'), 'remove', 'rec:expense:' || pg_temp.id('power'), null, null, null, 'month', '2026-12'),
    (pg_temp.id('e_extra'), a, pg_temp.id('flat'), 'add', null, pg_temp.id('c_extra'), 'income', 50000, 'month', '2026-11'),
    (pg_temp.id('e_cleaner'), a, pg_temp.id('office'), 'change', 'rec:expense:' || pg_temp.id('cleaner'), null, null, 27000, 'month', '2026-11'),
    (pg_temp.id('e_shop'), a, pg_temp.id('shop'), 'add', null, pg_temp.id('c_repairs'), 'expense', 15000, 'quarter', '2026-11'),
    (pg_temp.id('e_sold'), a, pg_temp.id('sold'), 'add', null, pg_temp.id('c_extra'), 'income', 99000, 'month', '2026-11'),
    (pg_temp.id('e_interest'), a, pg_temp.id('house'), 'remove', 'avg:' || pg_temp.id('c_interest'), null, null, null, 'once', '2026-12'),
    (pg_temp.id('e_escrow'), a, pg_temp.id('house'), 'remove', 'avg:' || pg_temp.id('c_escrow'), null, null, null, 'once', '2026-12');
  insert into public.forecast_line_matches (company_id, edit_id, month, transaction_id, expected_minor)
  values (a, pg_temp.id('e_shop'), '2027-02', pg_temp.id('shopmisc8'), 15000);

  -- Taken out for one month only (FLOW-1079): the accountant from December's general costs, the flat's rent from
  -- December, and the house's power from January.
  insert into public.forecast_overrides (company_id, month, item_key, amount_minor, due_on, moved_out) values
    (a, '2026-12', 'party:expense:' || pg_temp.id('accountant') || ':ILS:none', null, null, true),
    (a, '2026-12', 'party:income:' || pg_temp.id('tenant_b') || ':ILS', null, null, true),
    (a, '2027-01', 'party:expense:' || pg_temp.id('power') || ':ILS:' || pg_temp.id('house'), null, null, true);
end
$setup$;


-- The app's answers for this fixture: the separate reads the project page makes today (expected_months for the project,
-- project_category_months, project_forecast_edits_for, forecast_overrides_for, get_project's loans, list_categories; for
-- the overhead office the company's inputs and loans) run through the app's builders for each case, as
-- app/src/project-forecast-vectors.test.ts shapes them.
create temp table f1309_ts (tag text primary key, doc jsonb);
grant all on f1309_ts to authenticated, service_role;
insert into f1309_ts values
  ('flat_dec', $ts${"today":"2026-10-20","month":"2026-12","currency":"ILS","general":false,"income_minor":50000,"expense_minor":2000,"net_minor":48000,"cash_only_minor":233333,"cash_expense_minor":235333,"cash_net_minor":-185333,"loan_count":0,"average_months":4,"income":{"rows":1,"recurring":0,"rent":0,"name":"הכנסה נוספת"},"rows":[{"key":"avg:13090000-0000-4000-8000-000000000014","kind":"average","direction":"expense","name":"תיקונים","minor":-2000,"category_id":"13090000-0000-4000-8000-000000000014"},{"key":"add:13090000-0000-4000-8000-000000000063","kind":"added","direction":"income","name":"הכנסה נוספת","minor":50000,"category_id":"13090000-0000-4000-8000-000000000013","pace":"month"}],"removed":[],"skipped":[{"key":"rec:income:13090000-0000-4000-8000-000000000032","kind":"recurring","direction":"income","name":"Example Tenant B","date":"2026-12-03","minor":380000,"category_id":"13090000-0000-4000-8000-000000000012"}],"edited":false,"overrides":[{"item_key":"party:expense:13090000-0000-4000-8000-000000000035:ILS:none","moved_out":true},{"item_key":"party:income:13090000-0000-4000-8000-000000000032:ILS","moved_out":true}],"history":{"months":["2026-04-01","2026-05-01","2026-06-01","2026-07-01","2026-08-01","2026-09-01"],"categories":[{"id":"13090000-0000-4000-8000-000000000014","currency":"ILS","months_minor":[0,0,8000,0,0,0]}]},"charges":[{"category_id":"13090000-0000-4000-8000-000000000012","amount_minor":380000,"pace":"month"}]}$ts$),
  ('flat_nov', $ts${"today":"2026-10-20","month":"2026-11","currency":"ILS","general":false,"income_minor":430000,"expense_minor":2000,"net_minor":428000,"cash_only_minor":233333,"cash_expense_minor":235333,"cash_net_minor":194667,"loan_count":0,"average_months":4,"income":{"rows":2,"recurring":1,"rent":1},"rows":[{"key":"rec:income:13090000-0000-4000-8000-000000000032","kind":"recurring","direction":"income","name":"Example Tenant B","date":"2026-11-03","minor":380000,"category_id":"13090000-0000-4000-8000-000000000012"},{"key":"avg:13090000-0000-4000-8000-000000000014","kind":"average","direction":"expense","name":"תיקונים","minor":-2000,"category_id":"13090000-0000-4000-8000-000000000014"},{"key":"add:13090000-0000-4000-8000-000000000063","kind":"added","direction":"income","name":"הכנסה נוספת","minor":50000,"category_id":"13090000-0000-4000-8000-000000000013","pace":"month"}],"removed":[],"skipped":[],"edited":true,"overrides":[],"history":{"months":["2026-04-01","2026-05-01","2026-06-01","2026-07-01","2026-08-01","2026-09-01"],"categories":[{"id":"13090000-0000-4000-8000-000000000014","currency":"ILS","months_minor":[0,0,8000,0,0,0]}]},"charges":[{"category_id":"13090000-0000-4000-8000-000000000012","amount_minor":380000,"pace":"month"}]}$ts$),
  ('shop_feb', $ts${"today":"2026-10-20","month":"2027-02","currency":"ILS","general":false,"income_minor":0,"expense_minor":3500,"net_minor":-3500,"cash_only_minor":0,"cash_expense_minor":3500,"cash_net_minor":-3500,"loan_count":0,"average_months":2,"income":{"rows":0,"recurring":0,"rent":0},"rows":[{"key":"avg:none","kind":"average","direction":"expense","name":"אחר","minor":-3500}],"removed":[],"skipped":[],"edited":false,"overrides":[],"history":{"months":["2026-04-01","2026-05-01","2026-06-01","2026-07-01","2026-08-01","2026-09-01"],"categories":[{"currency":"ILS","months_minor":[0,0,0,0,7000,0]}]},"charges":[]}$ts$),
  ('shop_nov', $ts${"today":"2026-10-20","month":"2026-11","currency":"ILS","general":false,"income_minor":0,"expense_minor":18500,"net_minor":-18500,"cash_only_minor":0,"cash_expense_minor":18500,"cash_net_minor":-18500,"loan_count":0,"average_months":2,"income":{"rows":0,"recurring":0,"rent":0},"rows":[{"key":"avg:none","kind":"average","direction":"expense","name":"אחר","minor":-3500},{"key":"add:13090000-0000-4000-8000-000000000065","kind":"added","direction":"expense","name":"תיקונים","minor":-15000,"category_id":"13090000-0000-4000-8000-000000000014","pace":"quarter"}],"removed":[],"skipped":[],"edited":true,"overrides":[],"history":{"months":["2026-04-01","2026-05-01","2026-06-01","2026-07-01","2026-08-01","2026-09-01"],"categories":[{"currency":"ILS","months_minor":[0,0,0,0,7000,0]}]},"charges":[]}$ts$),
  ('sold_nov', $ts${"today":"2026-10-20","month":"2026-11","currency":"ILS","general":false,"income_minor":99000,"expense_minor":41667,"net_minor":57333,"cash_only_minor":68333,"cash_expense_minor":110000,"cash_net_minor":-11000,"loan_count":1,"average_months":1,"income":{"rows":1,"recurring":0,"rent":0,"name":"הכנסה נוספת"},"rows":[{"key":"avg:13090000-0000-4000-8000-000000000018","kind":"loan","direction":"expense","name":"ריבית הלוואה","minor":-41667,"category_id":"13090000-0000-4000-8000-000000000018"},{"key":"add:13090000-0000-4000-8000-000000000066","kind":"added","direction":"income","name":"הכנסה נוספת","minor":99000,"category_id":"13090000-0000-4000-8000-000000000013","pace":"month"}],"removed":[],"skipped":[],"edited":true,"overrides":[],"history":{"months":["2026-04-01","2026-05-01","2026-06-01","2026-07-01","2026-08-01","2026-09-01"],"categories":[]},"charges":[]}$ts$),
  ('house_dec', $ts${"today":"2026-10-20","month":"2026-12","currency":"ILS","general":false,"income_minor":450000,"expense_minor":18469,"net_minor":431531,"cash_only_minor":0,"cash_expense_minor":18469,"cash_net_minor":431531,"loan_count":0,"average_months":5,"income":{"rows":1,"recurring":1,"rent":1,"name":"Example Tenant A"},"rows":[{"key":"rec:income:13090000-0000-4000-8000-000000000031","kind":"recurring","direction":"income","name":"Example Tenant A","date":"2026-12-01","minor":450000,"category_id":"13090000-0000-4000-8000-000000000011"},{"key":"avg:13090000-0000-4000-8000-000000000014","kind":"average","direction":"expense","name":"תיקונים","minor":-18469,"category_id":"13090000-0000-4000-8000-000000000014"}],"removed":[{"key":"rec:expense:13090000-0000-4000-8000-000000000033","kind":"recurring","direction":"expense","name":"Example Power","date":"2026-12-12","minor":-18000,"category_id":"13090000-0000-4000-8000-000000000015"},{"key":"avg:13090000-0000-4000-8000-000000000018","kind":"loan","direction":"expense","name":"ריבית הלוואה","minor":-545214,"category_id":"13090000-0000-4000-8000-000000000018"},{"key":"avg:13090000-0000-4000-8000-000000000019","kind":"loan","direction":"expense","name":"ארנונה וביטוח","minor":-45000,"category_id":"13090000-0000-4000-8000-000000000019"}],"skipped":[],"edited":true,"overrides":[{"item_key":"party:expense:13090000-0000-4000-8000-000000000035:ILS:none","moved_out":true},{"item_key":"party:income:13090000-0000-4000-8000-000000000032:ILS","moved_out":true}],"history":{"months":["2026-04-01","2026-05-01","2026-06-01","2026-07-01","2026-08-01","2026-09-01"],"categories":[{"id":"13090000-0000-4000-8000-000000000018","currency":"ILS","months_minor":[0,0,0,0,550000,550000]},{"id":"13090000-0000-4000-8000-000000000019","currency":"ILS","months_minor":[0,0,0,0,45000,45000]},{"id":"13090000-0000-4000-8000-000000000015","currency":"ILS","months_minor":[0,0,0,18000,18000,18000]},{"id":"13090000-0000-4000-8000-000000000014","currency":"ILS","months_minor":[0,50000,0,30000,0,12345]}]},"charges":[{"category_id":"13090000-0000-4000-8000-000000000011","amount_minor":450000,"pace":"month"},{"category_id":"13090000-0000-4000-8000-000000000015","amount_minor":18000,"pace":"month"}]}$ts$),
  ('house_jan', $ts${"today":"2026-10-20","month":"2027-01","currency":"ILS","general":false,"income_minor":450000,"expense_minor":608043,"net_minor":-158043,"cash_only_minor":140426,"cash_expense_minor":748469,"cash_net_minor":-298469,"loan_count":2,"average_months":5,"income":{"rows":1,"recurring":1,"rent":1,"name":"Example Tenant A"},"rows":[{"key":"rec:income:13090000-0000-4000-8000-000000000031","kind":"recurring","direction":"income","name":"Example Tenant A","date":"2027-01-01","minor":450000,"category_id":"13090000-0000-4000-8000-000000000011"},{"key":"avg:13090000-0000-4000-8000-000000000018","kind":"loan","direction":"expense","name":"ריבית הלוואה","minor":-544574,"category_id":"13090000-0000-4000-8000-000000000018"},{"key":"avg:13090000-0000-4000-8000-000000000019","kind":"loan","direction":"expense","name":"ארנונה וביטוח","minor":-45000,"category_id":"13090000-0000-4000-8000-000000000019"},{"key":"avg:13090000-0000-4000-8000-000000000014","kind":"average","direction":"expense","name":"תיקונים","minor":-18469,"category_id":"13090000-0000-4000-8000-000000000014"}],"removed":[{"key":"rec:expense:13090000-0000-4000-8000-000000000033","kind":"recurring","direction":"expense","name":"Example Power","date":"2027-01-12","minor":-18000,"category_id":"13090000-0000-4000-8000-000000000015"}],"skipped":[],"edited":false,"overrides":[{"item_key":"party:expense:13090000-0000-4000-8000-000000000033:ILS:13090000-0000-4000-8000-000000000001","moved_out":true}],"history":{"months":["2026-04-01","2026-05-01","2026-06-01","2026-07-01","2026-08-01","2026-09-01"],"categories":[{"id":"13090000-0000-4000-8000-000000000018","currency":"ILS","months_minor":[0,0,0,0,550000,550000]},{"id":"13090000-0000-4000-8000-000000000019","currency":"ILS","months_minor":[0,0,0,0,45000,45000]},{"id":"13090000-0000-4000-8000-000000000015","currency":"ILS","months_minor":[0,0,0,18000,18000,18000]},{"id":"13090000-0000-4000-8000-000000000014","currency":"ILS","months_minor":[0,50000,0,30000,0,12345]}]},"charges":[{"category_id":"13090000-0000-4000-8000-000000000011","amount_minor":450000,"pace":"month"},{"category_id":"13090000-0000-4000-8000-000000000015","amount_minor":18000,"pace":"month"}]}$ts$),
  ('house_nov', $ts${"today":"2026-10-20","month":"2026-11","currency":"ILS","general":false,"income_minor":450000,"expense_minor":628852,"net_minor":-178852,"cash_only_minor":139148,"cash_expense_minor":768000,"cash_net_minor":-318000,"loan_count":2,"average_months":5,"income":{"rows":1,"recurring":1,"rent":1,"name":"Example Tenant A"},"rows":[{"key":"rec:income:13090000-0000-4000-8000-000000000031","kind":"recurring","direction":"income","name":"Example Tenant A","date":"2026-11-01","minor":450000,"category_id":"13090000-0000-4000-8000-000000000011"},{"key":"rec:expense:13090000-0000-4000-8000-000000000033","kind":"recurring","direction":"expense","name":"Example Power","date":"2026-11-12","minor":-18000,"category_id":"13090000-0000-4000-8000-000000000015"},{"key":"avg:13090000-0000-4000-8000-000000000018","kind":"loan","direction":"expense","name":"ריבית הלוואה","minor":-545852,"category_id":"13090000-0000-4000-8000-000000000018"},{"key":"avg:13090000-0000-4000-8000-000000000019","kind":"loan","direction":"expense","name":"ארנונה וביטוח","minor":-45000,"category_id":"13090000-0000-4000-8000-000000000019"},{"key":"avg:13090000-0000-4000-8000-000000000014","kind":"average","direction":"expense","name":"תיקונים","minor":-20000,"category_id":"13090000-0000-4000-8000-000000000014","was_minor":-18469}],"removed":[],"skipped":[],"edited":true,"overrides":[],"history":{"months":["2026-04-01","2026-05-01","2026-06-01","2026-07-01","2026-08-01","2026-09-01"],"categories":[{"id":"13090000-0000-4000-8000-000000000018","currency":"ILS","months_minor":[0,0,0,0,550000,550000]},{"id":"13090000-0000-4000-8000-000000000019","currency":"ILS","months_minor":[0,0,0,0,45000,45000]},{"id":"13090000-0000-4000-8000-000000000015","currency":"ILS","months_minor":[0,0,0,18000,18000,18000]},{"id":"13090000-0000-4000-8000-000000000014","currency":"ILS","months_minor":[0,50000,0,30000,0,12345]}]},"charges":[{"category_id":"13090000-0000-4000-8000-000000000011","amount_minor":450000,"pace":"month"},{"category_id":"13090000-0000-4000-8000-000000000015","amount_minor":18000,"pace":"month"}]}$ts$),
  ('office_dec', $ts${"today":"2026-10-20","month":"2026-12","currency":"ILS","general":true,"income_minor":0,"expense_minor":226191,"net_minor":-226191,"cash_only_minor":67809,"cash_expense_minor":294000,"cash_net_minor":-294000,"loan_count":2,"average_months":3,"income":{"rows":0,"recurring":0,"rent":0},"rows":[{"key":"rec:expense:13090000-0000-4000-8000-000000000034","kind":"recurring","direction":"expense","name":"Example Cleaning","date":"2026-12-15","minor":-27000,"category_id":"13090000-0000-4000-8000-000000000016","was_minor":-25000},{"key":"avg:13090000-0000-4000-8000-000000000018","kind":"loan","direction":"expense","name":"ריבית הלוואה","minor":-186191,"category_id":"13090000-0000-4000-8000-000000000018"},{"key":"avg:13090000-0000-4000-8000-000000000019","kind":"loan","direction":"expense","name":"ארנונה וביטוח","minor":-10000,"category_id":"13090000-0000-4000-8000-000000000019"},{"key":"avg:none","kind":"average","direction":"expense","name":"אחר","minor":-3000}],"removed":[],"skipped":[{"key":"rec:expense:13090000-0000-4000-8000-000000000035","kind":"recurring","direction":"expense","name":"Example Accounting","date":"2026-12-20","minor":-60000,"category_id":"13090000-0000-4000-8000-000000000017"}],"edited":false,"overrides":[{"item_key":"party:expense:13090000-0000-4000-8000-000000000035:ILS:none","moved_out":true},{"item_key":"party:income:13090000-0000-4000-8000-000000000032:ILS","moved_out":true}],"history":{"months":["2026-04-01","2026-05-01","2026-06-01","2026-07-01","2026-08-01","2026-09-01"],"categories":[{"id":"13090000-0000-4000-8000-000000000017","currency":"ILS","months_minor":[0,0,0,60000,60000,60000]},{"id":"13090000-0000-4000-8000-000000000016","currency":"ILS","months_minor":[0,0,0,25000,25000,25000]},{"currency":"ILS","months_minor":[0,0,0,0,0,9001]}]},"charges":[{"category_id":"13090000-0000-4000-8000-000000000017","amount_minor":60000,"pace":"month"},{"category_id":"13090000-0000-4000-8000-000000000016","amount_minor":25000,"pace":"month"}]}$ts$),
  ('office_nov', $ts${"today":"2026-10-20","month":"2026-11","currency":"ILS","general":true,"income_minor":0,"expense_minor":286500,"net_minor":-286500,"cash_only_minor":67500,"cash_expense_minor":354000,"cash_net_minor":-354000,"loan_count":2,"average_months":3,"income":{"rows":0,"recurring":0,"rent":0},"rows":[{"key":"rec:expense:13090000-0000-4000-8000-000000000034","kind":"recurring","direction":"expense","name":"Example Cleaning","date":"2026-11-15","minor":-27000,"category_id":"13090000-0000-4000-8000-000000000016","was_minor":-25000},{"key":"rec:expense:13090000-0000-4000-8000-000000000035","kind":"recurring","direction":"expense","name":"Example Accounting","date":"2026-11-20","minor":-60000,"category_id":"13090000-0000-4000-8000-000000000017"},{"key":"avg:13090000-0000-4000-8000-000000000018","kind":"loan","direction":"expense","name":"ריבית הלוואה","minor":-186500,"category_id":"13090000-0000-4000-8000-000000000018"},{"key":"avg:13090000-0000-4000-8000-000000000019","kind":"loan","direction":"expense","name":"ארנונה וביטוח","minor":-10000,"category_id":"13090000-0000-4000-8000-000000000019"},{"key":"avg:none","kind":"average","direction":"expense","name":"אחר","minor":-3000}],"removed":[],"skipped":[],"edited":true,"overrides":[],"history":{"months":["2026-04-01","2026-05-01","2026-06-01","2026-07-01","2026-08-01","2026-09-01"],"categories":[{"id":"13090000-0000-4000-8000-000000000017","currency":"ILS","months_minor":[0,0,0,60000,60000,60000]},{"id":"13090000-0000-4000-8000-000000000016","currency":"ILS","months_minor":[0,0,0,25000,25000,25000]},{"currency":"ILS","months_minor":[0,0,0,0,0,9001]}]},"charges":[{"category_id":"13090000-0000-4000-8000-000000000017","amount_minor":60000,"pace":"month"},{"category_id":"13090000-0000-4000-8000-000000000016","amount_minor":25000,"pace":"month"}]}$ts$),
  ('b_house_nov', $ts${"today":"2026-10-20","month":"2026-11","currency":"ILS","general":false,"income_minor":300000,"expense_minor":208333,"net_minor":91667,"cash_only_minor":91667,"cash_expense_minor":300000,"cash_net_minor":0,"loan_count":1,"average_months":1,"income":{"rows":1,"recurring":1,"rent":1,"name":"Sample Tenant"},"rows":[{"key":"rec:income:13090000-0000-4000-8000-000000000037","kind":"recurring","direction":"income","name":"Sample Tenant","date":"2026-11-05","minor":300000,"category_id":"13090000-0000-4000-8000-000000000021"},{"key":"avg:RANDOM-ID","kind":"loan","direction":"expense","name":"ריבית משכנתא","minor":-208333,"category_id":"RANDOM-ID"}],"removed":[],"skipped":[],"edited":false,"overrides":[],"history":{"months":["2026-04-01","2026-05-01","2026-06-01","2026-07-01","2026-08-01","2026-09-01"],"categories":[]},"charges":[{"category_id":"13090000-0000-4000-8000-000000000021","amount_minor":300000,"pace":"month"}]}$ts$),
  ('shop_usd_nov', $ts${"today":"2026-10-20","month":"2026-11","currency":"USD","general":false,"income_minor":0,"expense_minor":56667,"net_minor":-56667,"cash_only_minor":68333,"cash_expense_minor":125000,"cash_net_minor":-125000,"loan_count":1,"average_months":2,"income":{"rows":0,"recurring":0,"rent":0},"rows":[{"key":"avg:13090000-0000-4000-8000-000000000018","kind":"loan","direction":"expense","name":"ריבית הלוואה","minor":-41667,"category_id":"13090000-0000-4000-8000-000000000018"},{"key":"add:13090000-0000-4000-8000-000000000065","kind":"added","direction":"expense","name":"תיקונים","minor":-15000,"category_id":"13090000-0000-4000-8000-000000000014","pace":"quarter"}],"removed":[],"skipped":[],"edited":true,"overrides":[],"history":{"months":["2026-04-01","2026-05-01","2026-06-01","2026-07-01","2026-08-01","2026-09-01"],"categories":[]},"charges":[]}$ts$),
  ('house_dec_from_nov1', $ts${"today":"2026-11-01","month":"2026-12","currency":"ILS","general":false,"income_minor":450000,"expense_minor":15391,"net_minor":434609,"cash_only_minor":0,"cash_expense_minor":15391,"cash_net_minor":434609,"loan_count":0,"average_months":6,"income":{"rows":1,"recurring":1,"rent":1,"name":"Example Tenant A"},"rows":[{"key":"rec:income:13090000-0000-4000-8000-000000000031","kind":"recurring","direction":"income","name":"Example Tenant A","date":"2026-12-01","minor":450000,"category_id":"13090000-0000-4000-8000-000000000011"},{"key":"avg:13090000-0000-4000-8000-000000000014","kind":"average","direction":"expense","name":"תיקונים","minor":-15391,"category_id":"13090000-0000-4000-8000-000000000014"}],"removed":[{"key":"rec:expense:13090000-0000-4000-8000-000000000033","kind":"recurring","direction":"expense","name":"Example Power","date":"2026-12-12","minor":-18000,"category_id":"13090000-0000-4000-8000-000000000015"},{"key":"avg:13090000-0000-4000-8000-000000000018","kind":"loan","direction":"expense","name":"ריבית הלוואה","minor":-545214,"category_id":"13090000-0000-4000-8000-000000000018"},{"key":"avg:13090000-0000-4000-8000-000000000019","kind":"loan","direction":"expense","name":"ארנונה וביטוח","minor":-45000,"category_id":"13090000-0000-4000-8000-000000000019"}],"skipped":[],"edited":true,"overrides":[{"item_key":"party:expense:13090000-0000-4000-8000-000000000035:ILS:none","moved_out":true},{"item_key":"party:income:13090000-0000-4000-8000-000000000032:ILS","moved_out":true}],"history":{"months":["2026-05-01","2026-06-01","2026-07-01","2026-08-01","2026-09-01","2026-10-01"],"categories":[{"id":"13090000-0000-4000-8000-000000000019","currency":"ILS","months_minor":[0,0,0,45000,45000,45000]},{"id":"13090000-0000-4000-8000-000000000015","currency":"ILS","months_minor":[0,0,18000,18000,18000,0]},{"id":"13090000-0000-4000-8000-000000000018","currency":"ILS","months_minor":[0,0,0,550000,550000,550000]},{"id":"13090000-0000-4000-8000-000000000014","currency":"ILS","months_minor":[50000,0,30000,0,12345,0]}]},"charges":[{"category_id":"13090000-0000-4000-8000-000000000011","amount_minor":450000,"pace":"month"},{"category_id":"13090000-0000-4000-8000-000000000015","amount_minor":18000,"pace":"month"}]}$ts$);

create function pg_temp.ts(p_tag text) returns jsonb language sql stable set search_path = '' as $$
  select doc from pg_temp.f1309_ts where tag = p_tag;
$$;
-- The other company's category ids are made when its fixture is, so they are masked on both sides.
create function pg_temp.mask(p_doc jsonb) returns jsonb language sql immutable set search_path = '' as $$
  select regexp_replace(p_doc::text, '(?!1309)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'RANDOM-ID', 'g')::jsonb;
$$;
grant execute on function pg_temp.ts(text), pg_temp.mask(jsonb) to authenticated, service_role;

-- Israel's today, read as the database (authenticated cannot execute private.flow_today()).
create temp table f1309_clock (today date);
grant all on f1309_clock to authenticated, service_role;
insert into f1309_clock values (private.flow_today());

select is(
  (select b.balance_minor from public.loan_balances b where b.loan_id = pg_temp.id('l_mortgage')),
  119095000::bigint,
  'the mortgage''s balance in the books comes from its three split payments: 905,000 of principal'
);

select tests.authenticate_as('f1309_owner');

-- The same company: each project's answer equals the app's build over the reads the project page makes today.
select is(public.project_forecast(pg_temp.id('house'), '2026-11', '2026-10-20'), pg_temp.ts('house_nov'),
  'the house in November: equal to the app''s build (loan rows from the books'' balance, a change, the principal as cash only)');
select is(public.project_forecast(pg_temp.id('house'), '2026-12', '2026-10-20'), pg_temp.ts('house_dec'),
  'the house in December: both mortgage rows and the power charge taken out by the owner, so none of the payment is cash');
select is(public.project_forecast(pg_temp.id('house'), '2027-01', '2026-10-20'), pg_temp.ts('house_jan'),
  'the house in January: the power charge taken out of that month only (a skip, listed apart), the mortgage after its rate change');
select is(public.project_forecast(pg_temp.id('house'), '2026-12', '2026-11-01'), pg_temp.ts('house_dec_from_nov1'),
  'the house in December as of 1 November: the payment due that day counts');
select is(public.project_forecast(pg_temp.id('flat'), '2026-11', '2026-10-20'), pg_temp.ts('flat_nov'),
  'the flat in November: the bridge loan''s interest is kept out of the profit, so all of it is cash only; an added income line');
select is(public.project_forecast(pg_temp.id('flat'), '2026-12', '2026-10-20'), pg_temp.ts('flat_dec'),
  'the flat in December: the rent skipped for that month only');
select is(public.project_forecast(pg_temp.id('shop'), '2026-11', '2026-10-20'), pg_temp.ts('shop_nov'),
  'the shop in November: a demand, a refused and a dollar loan give no row; an uncategorized average; a quarterly added line');
select is(public.project_forecast(pg_temp.id('shop'), '2027-02', '2026-10-20'), pg_temp.ts('shop_feb'),
  'the shop in February: the quarterly line''s bank line came, so it is arrived and out of the totals');
select is(public.project_forecast(pg_temp.id('shop'), '2026-11', '2026-10-20', 'USD'), pg_temp.ts('shop_usd_nov'),
  'the shop in dollars (p_currency): its dollar loan counts and the shekel rows do not');
select is(public.project_forecast(pg_temp.id('sold'), '2026-11', '2026-10-20'), pg_temp.ts('sold_nov'),
  'a finished project''s page is built as the app builds it');
select is(public.project_forecast(pg_temp.id('office'), '2026-11', '2026-10-20'), pg_temp.ts('office_nov'),
  'the overhead office in November is the general costs: no-project charges and months, its loans, its edits');
select is(public.project_forecast(pg_temp.id('office'), '2026-12', '2026-10-20'), pg_temp.ts('office_dec'),
  'the overhead office in December: the accountant skipped for that month only (general key), listed apart');
select is(public.project_forecast(pg_temp.id('office'), '2026-11', '2026-10-20', 'USD'), pg_temp.ts('office_nov'),
  'the general costs are always in the company''s currency: p_currency does not change them');

-- Today: p_today null is today in Israel.
select is(
  public.project_forecast(pg_temp.id('house'), to_char((select today from pg_temp.f1309_clock) + interval '1 month', 'YYYY-MM')),
  public.project_forecast(pg_temp.id('house'), to_char((select today from pg_temp.f1309_clock) + interval '1 month', 'YYYY-MM'), (select today from pg_temp.f1309_clock)),
  'p_today null is today in Israel'
);
-- Israel midnight: the evening of 31 October and the first minutes of 1 November are two forecasts, next month moving
-- from November to December.
select lives_ok($$select public.project_forecast(pg_temp.id('house'), '2026-11', '2026-10-31')$$, 'on 31 October, November is next month');
select throws_ok($$select public.project_forecast(pg_temp.id('house'), '2026-11', '2026-11-01')$$, '22023', 'validation',
  'on 1 November, November is no longer a month of the forecast');

-- The edit page's history and charges are what it reads today.
select is(
  public.project_forecast(pg_temp.id('house'), '2026-11', '2026-10-20') -> 'history',
  (select jsonb_build_object(
     'months', c -> 'months',
     'categories', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', x ->> 'id', 'currency', x ->> 'currency', 'months_minor', x -> 'months_minor')) order by n)
                             from jsonb_array_elements(c -> 'categories') with ordinality t(x, n) where x ->> 'currency' = 'ILS'), '[]'::jsonb))
   from (select public.project_category_months(pg_temp.id('house'), 6, '2026-10-20') c) s),
  'history: the six months and the house''s expense months by category, as project_category_months gives them'
);
select is(
  public.project_forecast(pg_temp.id('house'), '2026-11', '2026-10-20') -> 'charges',
  (select coalesce(jsonb_agg(jsonb_build_object('category_id', r ->> 'category_id', 'amount_minor', abs((r ->> 'typical_amount_minor')::bigint), 'pace', r ->> 'pace') order by n), '[]'::jsonb)
   from jsonb_array_elements(public.expected_months(0, pg_temp.id('house'), '2026-10-20') -> 'recurring') with ordinality t(r, n)
   where (r ->> 'pays_loan')::boolean is not true and r ->> 'currency' = 'ILS' and r ->> 'category_id' is not null),
  'charges: the house''s expected_months charges that file to a category, a loan payment aside'
);
select is(
  (select count(*) from (select jsonb_build_array(
      public.project_forecast(pg_temp.id('house'), '2026-11', '2026-10-20'), public.project_forecast(pg_temp.id('flat'), '2026-11', '2026-10-20'),
      public.project_forecast(pg_temp.id('shop'), '2026-11', '2026-10-20'), public.project_forecast(pg_temp.id('office'), '2026-12', '2026-10-20')) a) x
   cross join jsonb_path_query(x.a, 'strict $.**') v
   where jsonb_typeof(v) = 'number' and (v::numeric <> trunc(v::numeric) or abs(v::numeric) >= 9007199254740992)),
  0::bigint,
  'every amount is an integer under 2^53'
);
select is(
  (select count(*) from (select jsonb_build_array(
      public.project_forecast(pg_temp.id('house'), '2026-11', '2026-10-20'), public.project_forecast(pg_temp.id('flat'), '2026-11', '2026-10-20'),
      public.project_forecast(pg_temp.id('shop'), '2026-11', '2026-10-20'), public.project_forecast(pg_temp.id('office'), '2026-12', '2026-10-20')) a) x
   cross join jsonb_path_query(x.a, 'strict $.**') v
   where v = 'null'::jsonb),
  0::bigint,
  'absent = null: no null in the answer'
);
select is(
  (select jsonb_agg(f ->> 'general' order by n) from (values
     (1, public.project_forecast(pg_temp.id('house'), '2026-11', '2026-10-20')),
     (2, public.project_forecast(pg_temp.id('office'), '2026-11', '2026-10-20'))) t(n, f)),
  '["false", "true"]'::jsonb,
  'only the overhead project''s answer is the general costs'
);
select is(
  (select count(*) from (values ('house'), ('flat'), ('shop'), ('sold'), ('office')) t(p)
   where (public.project_forecast(pg_temp.id(t.p), '2026-12', '2026-10-20') ->> 'cash_expense_minor')::bigint
         <> (public.project_forecast(pg_temp.id(t.p), '2026-12', '2026-10-20') ->> 'expense_minor')::bigint
            + (public.project_forecast(pg_temp.id(t.p), '2026-12', '2026-10-20') ->> 'cash_only_minor')::bigint),
  0::bigint,
  'cash terms: the expense is the profit expense plus what the profit leaves out'
);

-- Bad arguments.
select throws_ok($$select public.project_forecast(null, '2026-11', '2026-10-20')$$, '22023', 'validation', 'a project is required');
select throws_ok($$select public.project_forecast(pg_temp.id('house'), null, '2026-10-20')$$, '22023', 'validation', 'a month is required');
select throws_ok($$select public.project_forecast(pg_temp.id('house'), '2026-13', '2026-10-20')$$, '22023', 'validation', 'a month is yyyy-mm');
select throws_ok($$select public.project_forecast(pg_temp.id('house'), '2026-10', '2026-10-20')$$, '22023', 'validation', 'this month is not a month of the forecast');
select throws_ok($$select public.project_forecast(pg_temp.id('house'), '2027-11', '2026-10-20')$$, '22023', 'validation', 'nor 13 months ahead');
select throws_ok($$select public.project_forecast(pg_temp.id('house'), '2026-11', '2026-10-20', 'usd')$$, '22023', 'validation', 'a currency is three capital letters');
select throws_ok($$select public.project_forecast(pg_temp.id('house'), '2026-11', '2026-10-20', 'ILSX')$$, '22023', 'validation', 'not four');
select is(public.project_forecast(gen_random_uuid(), '2026-11', '2026-10-20'), null::jsonb, 'a project that does not exist gives nothing');

-- RLS: another company's member gets their own project, and nothing for the first company's.
select tests.authenticate_as('f1309_other');
select is(pg_temp.mask(public.project_forecast(pg_temp.id('b_house'), '2026-11', '2026-10-20')), pg_temp.mask(pg_temp.ts('b_house_nov')),
  'the other company''s member gets their own project, equal to the app''s build of their reads');
select is(public.project_forecast(pg_temp.id('house'), '2026-11', '2026-10-20'), null::jsonb, 'another company''s project gives nothing');
select is(public.project_forecast(pg_temp.id('office'), '2026-11', '2026-10-20'), null::jsonb, 'nor does another company''s overhead project');
select is(
  (select count(*) from pg_temp.f1309 f
   where f.label not in ('b', 'b_house', 'b_rent', 'b_tenant', 'l_b')
     and (public.project_forecast(pg_temp.id('b_house'), '2026-11', '2026-10-20')::text) like '%' || f.id::text || '%'),
  0::bigint,
  'none of the first company''s projects, categories, parties, loans or edits is in the other company''s answer'
);
select tests.authenticate_as('f1309_nobody');
select is(public.project_forecast(pg_temp.id('house'), '2026-11', '2026-10-20'), null::jsonb, 'a user with no company gets nothing');

-- Grants: anon is refused; authenticated and service_role may execute it.
select tests.clear_authentication();
set local role anon;
select throws_ok($$select public.project_forecast(gen_random_uuid(), '2026-11')$$, '42501', null, 'anon cannot execute project_forecast');
reset role;
select ok(
  has_function_privilege('authenticated', 'public.project_forecast(uuid, text, date, text)', 'execute')
  and has_function_privilege('service_role', 'public.project_forecast(uuid, text, date, text)', 'execute')
  and not has_function_privilege('anon', 'public.project_forecast(uuid, text, date, text)', 'execute')
  and not has_function_privilege('anon', 'private.project_forecast_build(jsonb)', 'execute')
  and not has_function_privilege('anon', 'private.project_forecast_order_rows(jsonb)', 'execute')
  and has_function_privilege('authenticated', 'private.project_forecast_build(jsonb)', 'execute'),
  'execute for authenticated and service_role, not anon; the pure core is callable by the invoker'
);
select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.project_forecast(uuid, text, date, text)'::regprocedure),
  false,
  'project_forecast is security invoker'
);
select is(
  (select count(*) from pg_proc p
   where p.oid in ('private.project_forecast_build(jsonb)'::regprocedure, 'private.project_forecast_order_rows(jsonb)'::regprocedure)
     and not p.prosecdef and p.provolatile = 'i' and p.proconfig = array['search_path=""']),
  2::bigint,
  'the pure build and the row order are immutable, not security definer, with an empty search_path'
);
-- The company's read is the same answer: the only change to its core is the optional allParts key.
select is(
  jsonb_array_length(private.company_forecast_build('{"currency":"USD","today":"2026-10-11","months":["2026-11"],"recurring":[],"loans":[],"categories":[],"inputs":{"month":"2026-11","overhead_project_id":null,"projects":[{"project_id":"p1","categories":[]}],"general":[],"edits":[{"id":"e1","project_id":"p1","kind":"remove","row_key":"avg:x","category_id":null,"direction":null,"amount_minor":null,"pace":"once","start_month":"2026-11"}]}}'::jsonb) -> 'months' -> 0 -> 'parts'),
  1,
  'the company core still lists only the general part when a project has no row left'
);
select is(
  jsonb_array_length(private.company_forecast_build('{"allParts":true,"currency":"USD","today":"2026-10-11","months":["2026-11"],"recurring":[],"loans":[],"categories":[],"inputs":{"month":"2026-11","overhead_project_id":null,"projects":[{"project_id":"p1","categories":[]}],"general":[],"edits":[{"id":"e1","project_id":"p1","kind":"remove","row_key":"avg:x","category_id":null,"direction":null,"amount_minor":null,"pace":"once","start_month":"2026-11"}]}}'::jsonb) -> 'months' -> 0 -> 'parts'),
  2,
  'and with allParts it lists the project''s part too'
);

select * from finish();
rollback;
