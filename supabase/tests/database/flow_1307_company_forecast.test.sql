-- FLOW-1307: public.company_forecast, the company forecast in one read (migration 20261123071023).
-- - On a fixture company (three projects, a finished one and an overhead office; recurring rent, power, cleaning and
--   accounting; one-off costs; loans of each kind with rate changes, split payments, a demand, a refused, a closed, a
--   dollar and a finished project's loan; the owner's edits, a matched added line and one-month skips) its answer equals
--   the app's own build: each expected answer below is companyNextMonthForecast over the app's reads of this fixture
--   (company_next_month_inputs, expected_months, the loans with loan_balances, list_categories), so the read's gathering
--   is checked, not only the core (vectors_company_forecast.test.sql runs the shared vectors). Every id the answer names
--   is fixed, so the answers are written out as they come.
-- - 'totals' is 'rows' without the parts, the skipped rows and the split keys; 12 months of totals in one call, rows
--   for one month only; the general part is always listed in rows; every amount an integer under 2^53; absent = null.
-- - The two inlined helpers set no configuration and their callers an empty search_path.
-- - Israel midnight: 31 October and 1 November are two forecasts; p_today null is today in Israel.
-- - A bad p_detail or month is refused (22023); another company's member reads only their own company; a user with no
--   company is refused; anon cannot execute it.
-- Invented data only, @example.com only. Amounts are agorot. "Today" is 2026-10-20 unless a case says otherwise.

begin;

select plan(32);

do $users$
begin
  perform tests.create_supabase_user('f1307_owner', 'owner1307@example.com');
  perform tests.create_supabase_user('f1307_other', 'other1307@example.com');
  perform tests.create_supabase_user('f1307_nobody', 'nobody1307@example.com');
end
$users$;

-- Every id the answer names is fixed, so the expected answers below can be written out (the rows come by key).
create temp table f1307 (label text primary key, id uuid);
grant all on f1307 to authenticated, service_role;
insert into f1307 (label, id) values
  ('house', '13070000-0000-4000-8000-000000000001'), ('flat', '13070000-0000-4000-8000-000000000002'),
  ('shop', '13070000-0000-4000-8000-000000000003'), ('sold', '13070000-0000-4000-8000-000000000004'),
  ('office', '13070000-0000-4000-8000-000000000005'), ('b_house', '13070000-0000-4000-8000-000000000006'),
  ('c_rent', '13070000-0000-4000-8000-000000000011'), ('c_rent_flat', '13070000-0000-4000-8000-000000000012'),
  ('c_extra', '13070000-0000-4000-8000-000000000013'), ('c_repairs', '13070000-0000-4000-8000-000000000014'),
  ('c_power', '13070000-0000-4000-8000-000000000015'), ('c_cleaning', '13070000-0000-4000-8000-000000000016'),
  ('c_accounting', '13070000-0000-4000-8000-000000000017'), ('c_interest', '13070000-0000-4000-8000-000000000018'),
  ('c_escrow', '13070000-0000-4000-8000-000000000019'), ('c_bridge', '13070000-0000-4000-8000-000000000020'),
  ('b_rent', '13070000-0000-4000-8000-000000000021'),
  ('tenant_a', '13070000-0000-4000-8000-000000000031'), ('tenant_b', '13070000-0000-4000-8000-000000000032'),
  ('power', '13070000-0000-4000-8000-000000000033'), ('cleaner', '13070000-0000-4000-8000-000000000034'),
  ('accountant', '13070000-0000-4000-8000-000000000035'), ('servicer', '13070000-0000-4000-8000-000000000036'),
  ('b_tenant', '13070000-0000-4000-8000-000000000037'),
  ('l_mortgage', '13070000-0000-4000-8000-000000000041'), ('l_bridge', '13070000-0000-4000-8000-000000000042'),
  ('l_balloon', '13070000-0000-4000-8000-000000000043'), ('l_demand', '13070000-0000-4000-8000-000000000044'),
  ('l_refused', '13070000-0000-4000-8000-000000000045'), ('l_closed', '13070000-0000-4000-8000-000000000046'),
  ('l_dollar', '13070000-0000-4000-8000-000000000047'), ('l_sold', '13070000-0000-4000-8000-000000000048'),
  ('l_general', '13070000-0000-4000-8000-000000000049'), ('l_b', '13070000-0000-4000-8000-000000000050'),
  ('e_repairs', '13070000-0000-4000-8000-000000000061'), ('e_power', '13070000-0000-4000-8000-000000000062'),
  ('e_extra', '13070000-0000-4000-8000-000000000063'), ('e_cleaner', '13070000-0000-4000-8000-000000000064'),
  ('e_shop', '13070000-0000-4000-8000-000000000065'), ('e_sold', '13070000-0000-4000-8000-000000000066'),
  ('e_interest', '13070000-0000-4000-8000-000000000067'), ('e_escrow', '13070000-0000-4000-8000-000000000068');

create function pg_temp.id(p_label text) returns uuid language sql stable set search_path = '' as $$
  select id from pg_temp.f1307 where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

do $setup$
declare
  a uuid;
  b uuid;
  principal_cat uuid;
begin
  a := tests.fixture_company('f1307_owner', 'Example Forecast Holdings 1307');
  b := tests.fixture_company('f1307_other', 'Sample Other Rentals 1307');
  insert into pg_temp.f1307 values ('a', a), ('b', b);

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
  create temp table f1307_lines (label text, co uuid, amount bigint, direction text, project text, cat text, doc_date date, party text, role text, kind text);
  insert into f1307_lines values
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
  insert into pg_temp.f1307 (label, id)
  select l.label, tests.fixture_line(l.co, 'f1307:' || l.label, l.amount, l.direction, pg_temp.id(l.project), pg_temp.id(l.cat), l.doc_date,
    p_pnl_role => l.role, p_doc_kind => l.kind)
  from f1307_lines l;
  update public.transactions t set supplier_id = pg_temp.id(l.party) from f1307_lines l where t.id = pg_temp.id(l.label) and l.direction = 'expense' and l.party is not null;
  update public.transactions t set customer_id = pg_temp.id(l.party) from f1307_lines l where t.id = pg_temp.id(l.label) and l.direction = 'income';

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
  create temp table f1307_pay (label text, doc_date date, principal bigint);
  insert into f1307_pay values ('pay8', '2026-08-01', 135000), ('pay9', '2026-09-01', 135000), ('pay10', '2026-10-01', 635000);
  insert into pg_temp.f1307 (label, id)
  select p.label, tests.fixture_line(a, 'f1307:' || p.label, 595000 + p.principal, 'expense', pg_temp.id('house'), null, p.doc_date)
  from f1307_pay p;
  update public.transactions t set supplier_id = pg_temp.id('servicer') from f1307_pay p where t.id = pg_temp.id(p.label);
  perform tests.loan_split(pg_temp.id(p.label), pg_temp.id('l_mortgage'), jsonb_build_array(
    jsonb_build_object('part', 'interest', 'amount_minor', 550000, 'scheduled_minor', 550000, 'category_id', pg_temp.id('c_interest')),
    jsonb_build_object('part', 'escrow', 'amount_minor', 45000, 'scheduled_minor', 45000, 'category_id', pg_temp.id('c_escrow')),
    jsonb_build_object('part', 'principal', 'amount_minor', p.principal, 'scheduled_minor', p.principal, 'category_id', principal_cat)))
  from f1307_pay p;

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

-- The TypeScript's answers for this fixture: the app's own reads of it (company_next_month_inputs, expected_months, the
-- loans with loan_balances, list_categories, the company currency) run through companyNextMonthForecast for each month,
-- as app/src/company-forecast-vectors.test.ts shapes them.
create temp table f1307_ts (tag text primary key, doc jsonb);
grant all on f1307_ts to authenticated, service_role;
insert into f1307_ts values
  ('nov', $ts${"months": [{"month": "2026-11", "income_minor": 880000, "expense_minor": 935852, "net_minor": -55852, "cash_only_minor": 439981, "projects": 3, "general": true, "income": {"rows": 3, "recurring": 2, "rent": 2}, "parts": [{"project_id": "13070000-0000-4000-8000-000000000001", "income_minor": 450000, "expense_minor": 628852, "cash_only_minor": 139148, "average_months": 5, "rows": [{"key": "avg:13070000-0000-4000-8000-000000000014", "kind": "average", "direction": "expense", "name": "תיקונים", "minor": -20000, "category_id": "13070000-0000-4000-8000-000000000014", "was_minor": -18469}, {"key": "avg:13070000-0000-4000-8000-000000000018", "kind": "loan", "direction": "expense", "name": "ריבית הלוואה", "minor": -545852, "category_id": "13070000-0000-4000-8000-000000000018"}, {"key": "avg:13070000-0000-4000-8000-000000000019", "kind": "loan", "direction": "expense", "name": "ארנונה וביטוח", "minor": -45000, "category_id": "13070000-0000-4000-8000-000000000019"}, {"key": "rec:expense:13070000-0000-4000-8000-000000000033", "kind": "recurring", "direction": "expense", "name": "Example Power", "date": "2026-11-12", "minor": -18000, "category_id": "13070000-0000-4000-8000-000000000015"}, {"key": "rec:income:13070000-0000-4000-8000-000000000031", "kind": "recurring", "direction": "income", "name": "Example Tenant A", "date": "2026-11-01", "minor": 450000, "category_id": "13070000-0000-4000-8000-000000000011"}], "removed": [], "arrived": [], "loan_cash": [{"loan_id": "13070000-0000-4000-8000-000000000041", "row_category_ids": ["13070000-0000-4000-8000-000000000018", "13070000-0000-4000-8000-000000000019"], "minor": 139148}]}, {"project_id": "13070000-0000-4000-8000-000000000002", "income_minor": 430000, "expense_minor": 2000, "cash_only_minor": 233333, "average_months": 4, "rows": [{"key": "avg:13070000-0000-4000-8000-000000000014", "kind": "average", "direction": "expense", "name": "תיקונים", "minor": -2000, "category_id": "13070000-0000-4000-8000-000000000014"}, {"key": "rec:income:13070000-0000-4000-8000-000000000032", "kind": "recurring", "direction": "income", "name": "Example Tenant B", "date": "2026-11-03", "minor": 380000, "category_id": "13070000-0000-4000-8000-000000000012"}, {"key": "add:13070000-0000-4000-8000-000000000063", "kind": "added", "direction": "income", "name": "הכנסה נוספת", "minor": 50000, "category_id": "13070000-0000-4000-8000-000000000013", "pace": "month"}], "removed": [], "arrived": [], "loan_cash": [{"loan_id": "13070000-0000-4000-8000-000000000042", "row_category_ids": [], "minor": 233333}]}, {"project_id": "13070000-0000-4000-8000-000000000003", "income_minor": 0, "expense_minor": 18500, "cash_only_minor": 0, "average_months": 2, "rows": [{"key": "avg:none", "kind": "average", "direction": "expense", "name": "אחר", "minor": -3500}, {"key": "add:13070000-0000-4000-8000-000000000065", "kind": "added", "direction": "expense", "name": "תיקונים", "minor": -15000, "category_id": "13070000-0000-4000-8000-000000000014", "pace": "quarter"}], "removed": [], "arrived": [], "loan_cash": []}, {"income_minor": 0, "expense_minor": 286500, "cash_only_minor": 67500, "average_months": 3, "rows": [{"key": "avg:13070000-0000-4000-8000-000000000018", "kind": "loan", "direction": "expense", "name": "ריבית הלוואה", "minor": -186500, "category_id": "13070000-0000-4000-8000-000000000018"}, {"key": "avg:13070000-0000-4000-8000-000000000019", "kind": "loan", "direction": "expense", "name": "ארנונה וביטוח", "minor": -10000, "category_id": "13070000-0000-4000-8000-000000000019"}, {"key": "avg:none", "kind": "average", "direction": "expense", "name": "אחר", "minor": -3000}, {"key": "rec:expense:13070000-0000-4000-8000-000000000034", "kind": "recurring", "direction": "expense", "name": "Example Cleaning", "date": "2026-11-15", "minor": -27000, "category_id": "13070000-0000-4000-8000-000000000016", "was_minor": -25000}, {"key": "rec:expense:13070000-0000-4000-8000-000000000035", "kind": "recurring", "direction": "expense", "name": "Example Accounting", "date": "2026-11-20", "minor": -60000, "category_id": "13070000-0000-4000-8000-000000000017"}], "removed": [], "arrived": [], "loan_cash": [{"loan_id": "13070000-0000-4000-8000-000000000043", "row_category_ids": ["13070000-0000-4000-8000-000000000018", "13070000-0000-4000-8000-000000000019"], "minor": 27500}, {"loan_id": "13070000-0000-4000-8000-000000000049", "row_category_ids": ["13070000-0000-4000-8000-000000000018"], "minor": 40000}]}], "skipped": []}], "income": {"rows": 3, "recurring": 2, "rent": 2}, "split_keys": []}$ts$),
  ('dec', $ts${"months": [{"month": "2026-12", "income_minor": 500000, "expense_minor": 250160, "net_minor": 249840, "cash_only_minor": 301142, "projects": 3, "general": true, "income": {"rows": 2, "recurring": 1, "rent": 1}, "parts": [{"project_id": "13070000-0000-4000-8000-000000000001", "income_minor": 450000, "expense_minor": 18469, "cash_only_minor": 0, "average_months": 5, "rows": [{"key": "avg:13070000-0000-4000-8000-000000000014", "kind": "average", "direction": "expense", "name": "תיקונים", "minor": -18469, "category_id": "13070000-0000-4000-8000-000000000014"}, {"key": "rec:income:13070000-0000-4000-8000-000000000031", "kind": "recurring", "direction": "income", "name": "Example Tenant A", "date": "2026-12-01", "minor": 450000, "category_id": "13070000-0000-4000-8000-000000000011"}], "removed": [{"key": "avg:13070000-0000-4000-8000-000000000018", "kind": "loan", "direction": "expense", "name": "ריבית הלוואה", "minor": -545214, "category_id": "13070000-0000-4000-8000-000000000018"}, {"key": "avg:13070000-0000-4000-8000-000000000019", "kind": "loan", "direction": "expense", "name": "ארנונה וביטוח", "minor": -45000, "category_id": "13070000-0000-4000-8000-000000000019"}, {"key": "rec:expense:13070000-0000-4000-8000-000000000033", "kind": "recurring", "direction": "expense", "name": "Example Power", "date": "2026-12-12", "minor": -18000, "category_id": "13070000-0000-4000-8000-000000000015"}], "arrived": [], "loan_cash": [{"loan_id": "13070000-0000-4000-8000-000000000041", "row_category_ids": ["13070000-0000-4000-8000-000000000018", "13070000-0000-4000-8000-000000000019"], "minor": 139786}]}, {"project_id": "13070000-0000-4000-8000-000000000002", "income_minor": 50000, "expense_minor": 2000, "cash_only_minor": 233333, "average_months": 4, "rows": [{"key": "avg:13070000-0000-4000-8000-000000000014", "kind": "average", "direction": "expense", "name": "תיקונים", "minor": -2000, "category_id": "13070000-0000-4000-8000-000000000014"}, {"key": "add:13070000-0000-4000-8000-000000000063", "kind": "added", "direction": "income", "name": "הכנסה נוספת", "minor": 50000, "category_id": "13070000-0000-4000-8000-000000000013", "pace": "month"}], "removed": [], "arrived": [], "loan_cash": [{"loan_id": "13070000-0000-4000-8000-000000000042", "row_category_ids": [], "minor": 233333}]}, {"project_id": "13070000-0000-4000-8000-000000000003", "income_minor": 0, "expense_minor": 3500, "cash_only_minor": 0, "average_months": 2, "rows": [{"key": "avg:none", "kind": "average", "direction": "expense", "name": "אחר", "minor": -3500}], "removed": [], "arrived": [], "loan_cash": []}, {"income_minor": 0, "expense_minor": 226191, "cash_only_minor": 67809, "average_months": 3, "rows": [{"key": "avg:13070000-0000-4000-8000-000000000018", "kind": "loan", "direction": "expense", "name": "ריבית הלוואה", "minor": -186191, "category_id": "13070000-0000-4000-8000-000000000018"}, {"key": "avg:13070000-0000-4000-8000-000000000019", "kind": "loan", "direction": "expense", "name": "ארנונה וביטוח", "minor": -10000, "category_id": "13070000-0000-4000-8000-000000000019"}, {"key": "avg:none", "kind": "average", "direction": "expense", "name": "אחר", "minor": -3000}, {"key": "rec:expense:13070000-0000-4000-8000-000000000034", "kind": "recurring", "direction": "expense", "name": "Example Cleaning", "date": "2026-12-15", "minor": -27000, "category_id": "13070000-0000-4000-8000-000000000016", "was_minor": -25000}], "removed": [], "arrived": [], "loan_cash": [{"loan_id": "13070000-0000-4000-8000-000000000043", "row_category_ids": ["13070000-0000-4000-8000-000000000018", "13070000-0000-4000-8000-000000000019"], "minor": 27649}, {"loan_id": "13070000-0000-4000-8000-000000000049", "row_category_ids": ["13070000-0000-4000-8000-000000000018"], "minor": 40160}]}], "skipped": [{"key": "rec:expense:13070000-0000-4000-8000-000000000035", "kind": "recurring", "direction": "expense", "name": "Example Accounting", "date": "2026-12-20", "minor": -60000, "category_id": "13070000-0000-4000-8000-000000000017"}, {"project_id": "13070000-0000-4000-8000-000000000002", "key": "rec:income:13070000-0000-4000-8000-000000000032", "kind": "recurring", "direction": "income", "name": "Example Tenant B", "date": "2026-12-03", "minor": 380000, "category_id": "13070000-0000-4000-8000-000000000012"}]}], "income": {"rows": 2, "recurring": 1, "rent": 1}, "split_keys": []}$ts$),
  ('totals12', $ts${"months": [{"month": "2026-11", "income_minor": 880000, "expense_minor": 935852, "net_minor": -55852, "cash_only_minor": 439981, "projects": 3, "general": true, "income": {"rows": 3, "recurring": 2, "rent": 2}}, {"month": "2026-12", "income_minor": 500000, "expense_minor": 250160, "net_minor": 249840, "cash_only_minor": 301142, "projects": 3, "general": true, "income": {"rows": 2, "recurring": 1, "rent": 1}}, {"month": "2027-01", "income_minor": 880000, "expense_minor": 899423, "net_minor": -19423, "cash_only_minor": 441879, "projects": 3, "general": true, "income": {"rows": 3, "recurring": 2, "rent": 2}}, {"month": "2027-02", "income_minor": 880000, "expense_minor": 947916, "net_minor": -67916, "cash_only_minor": 424236, "projects": 3, "general": true, "income": {"rows": 3, "recurring": 2, "rent": 2}}, {"month": "2027-03", "income_minor": 880000, "expense_minor": 948936, "net_minor": -68936, "cash_only_minor": 424233, "projects": 3, "general": true, "income": {"rows": 3, "recurring": 2, "rent": 2}}, {"month": "2027-04", "income_minor": 880000, "expense_minor": 947996, "net_minor": -67996, "cash_only_minor": 425173, "projects": 3, "general": true, "income": {"rows": 3, "recurring": 2, "rent": 2}}, {"month": "2027-05", "income_minor": 880000, "expense_minor": 962053, "net_minor": -82053, "cash_only_minor": 426116, "projects": 3, "general": true, "income": {"rows": 3, "recurring": 2, "rent": 2}}, {"month": "2027-06", "income_minor": 880000, "expense_minor": 946103, "net_minor": -66103, "cash_only_minor": 427067, "projects": 3, "general": true, "income": {"rows": 3, "recurring": 2, "rent": 2}}, {"month": "2027-07", "income_minor": 880000, "expense_minor": 945150, "net_minor": -65150, "cash_only_minor": 428020, "projects": 3, "general": true, "income": {"rows": 3, "recurring": 2, "rent": 2}}, {"month": "2027-08", "income_minor": 880000, "expense_minor": 959192, "net_minor": -79192, "cash_only_minor": 428978, "projects": 3, "general": true, "income": {"rows": 3, "recurring": 2, "rent": 2}}, {"month": "2027-09", "income_minor": 880000, "expense_minor": 943229, "net_minor": -63229, "cash_only_minor": 429941, "projects": 3, "general": true, "income": {"rows": 3, "recurring": 2, "rent": 2}}, {"month": "2027-10", "income_minor": 880000, "expense_minor": 942260, "net_minor": -62260, "cash_only_minor": 430910, "projects": 3, "general": true, "income": {"rows": 3, "recurring": 2, "rent": 2}}], "income": {"rows": 3, "recurring": 2, "rent": 2}}$ts$),
  ('nov1', $ts${"months": [{"month": "2026-12", "income_minor": 500000, "expense_minor": 244765, "net_minor": 255235, "cash_only_minor": 301142, "projects": 3, "general": true, "income": {"rows": 2, "recurring": 1, "rent": 1}}, {"month": "2027-01", "income_minor": 880000, "expense_minor": 894028, "net_minor": -14028, "cash_only_minor": 441879, "projects": 3, "general": true, "income": {"rows": 3, "recurring": 2, "rent": 2}}], "income": {"rows": 3, "recurring": 2, "rent": 2}}$ts$),
  ('b', $ts${"months": [{"month": "2026-11", "income_minor": 300000, "expense_minor": 208333, "net_minor": 91667, "cash_only_minor": 91667, "projects": 1, "general": false, "income": {"rows": 1, "recurring": 1, "rent": 1, "name": "Sample Tenant"}}, {"month": "2026-12", "income_minor": 300000, "expense_minor": 207951, "net_minor": 92049, "cash_only_minor": 92049, "projects": 1, "general": false, "income": {"rows": 1, "recurring": 1, "rent": 1, "name": "Sample Tenant"}}], "income": {"rows": 1, "recurring": 1, "rent": 1, "name": "Sample Tenant"}}$ts$);

create function pg_temp.ts(p_tag text) returns jsonb language sql stable set search_path = '' as $$
  select doc from pg_temp.f1307_ts where tag = p_tag;
$$;
create function pg_temp.year(p_from date) returns text[] language sql immutable set search_path = '' as $$
  select array(select to_char(d, 'YYYY-MM') from generate_series(p_from, p_from + interval '11 months', interval '1 month') d);
$$;
grant execute on function pg_temp.ts(text), pg_temp.year(date) to authenticated, service_role;

-- Israel's today, read as the database (authenticated cannot execute private.flow_today()).
create temp table f1307_clock (today date);
grant all on f1307_clock to authenticated, service_role;
insert into f1307_clock values (private.flow_today());

select is(
  (select b.balance_minor from public.loan_balances b where b.loan_id = pg_temp.id('l_mortgage')),
  119095000::bigint,
  'the mortgage''s balance in the books comes from its three split payments: 905,000 of principal'
);

select tests.authenticate_as('f1307_owner');

-- The same company, the TypeScript's answer for its reads.
select is(
  public.company_forecast(array['2026-11'], 'rows', '2026-10-20') - 'today' - 'currency',
  pg_temp.ts('nov'),
  'rows for November: equal to the app''s build over the same reads (loans of each kind, edits, an overhead project, a finished project)'
);
select is(
  public.company_forecast(array['2026-12'], 'rows', '2026-10-20') - 'today' - 'currency',
  pg_temp.ts('dec'),
  'rows for December: equal to the app''s build (a page removal, every row of the mortgage taken out, skips in a project and in the general costs)'
);
select is(
  (select jsonb_build_object('today', f ->> 'today', 'currency', f ->> 'currency')
   from public.company_forecast(array['2026-11'], 'totals', '2026-10-20') f),
  '{"today": "2026-10-20", "currency": "ILS"}'::jsonb,
  'the answer names the day it was built for and the company currency'
);
select is(
  public.company_forecast(pg_temp.year('2026-11-01'), 'totals', '2026-10-20') - 'today' - 'currency',
  pg_temp.ts('totals12'),
  'totals for all 12 months of the forecast: equal to the app''s build'
);
select is(
  public.company_forecast(array['2026-12'], 'totals', '2026-10-20') - 'today' - 'currency',
  (select jsonb_build_object(
     'months', (select jsonb_agg(m - 'parts' - 'skipped' order by n) from jsonb_array_elements(r -> 'months') with ordinality x(m, n)),
     'income', r -> 'income')
   from public.company_forecast(array['2026-12'], 'rows', '2026-10-20') r),
  'totals are the rows answer without the parts, the skipped rows and the split keys'
);
select is(
  (select jsonb_agg(m ->> 'month' order by n)
   from jsonb_array_elements(public.company_forecast(array['2027-03', '2026-11', '2027-10'], 'totals', '2026-10-20') -> 'months') with ordinality x(m, n)),
  '["2027-03", "2026-11", "2027-10"]'::jsonb,
  'the months come in the order asked'
);
select is(
  (select count(*)
   from (select jsonb_build_array(public.company_forecast(pg_temp.year('2026-11-01'), 'totals', '2026-10-20'),
           public.company_forecast(array['2026-11'], 'rows', '2026-10-20')) a) x
   cross join jsonb_path_query(x.a, 'strict $.**') v
   where jsonb_typeof(v) = 'number' and (v::numeric <> trunc(v::numeric) or abs(v::numeric) >= 9007199254740992)),
  0::bigint,
  'every amount of 12 months of totals and of a month of rows is an integer under 2^53'
);
select is(
  (select count(*)
   from (select jsonb_build_array(public.company_forecast(pg_temp.year('2026-11-01'), 'totals', '2026-10-20'),
           public.company_forecast(array['2026-11'], 'rows', '2026-10-20')) a) x
   cross join jsonb_path_query(x.a, 'strict $.**') v
   where v = 'null'::jsonb),
  0::bigint,
  'absent = null: no null in the answer'
);

-- Israel midnight: the evening of 31 October and the first minutes of 1 November are two forecasts, next month moving
-- from November to December. p_today null is today in Israel.
select lives_ok(
  $$select public.company_forecast(array['2026-11'], 'totals', '2026-10-31')$$,
  'on 31 October, November is next month'
);
select throws_ok(
  $$select public.company_forecast(array['2026-11'], 'totals', '2026-11-01')$$,
  '22023', 'validation',
  'on 1 November, November is no longer a month of the forecast'
);
select is(
  public.company_forecast(array['2026-12', '2027-01'], 'totals', '2026-11-01') - 'today' - 'currency',
  pg_temp.ts('nov1'),
  'on 1 November: equal to the app''s build of December and January for that day (the payment due that day counts)'
);
select is(
  public.company_forecast(array[to_char((select today from pg_temp.f1307_clock) + interval '1 month', 'YYYY-MM')], 'totals'),
  public.company_forecast(array[to_char((select today from pg_temp.f1307_clock) + interval '1 month', 'YYYY-MM')], 'totals', (select today from pg_temp.f1307_clock)),
  'p_today null is today in Israel'
);

-- Bad arguments.
select throws_ok($$select public.company_forecast(array['2026-11'], 'all', '2026-10-20')$$, '22023', 'validation', 'p_detail must be totals or rows');
select throws_ok($$select public.company_forecast(array['2026-11'], null, '2026-10-20')$$, '22023', 'validation', 'p_detail is required');
select throws_ok($$select public.company_forecast(array['2026-13'], 'totals', '2026-10-20')$$, '22023', 'validation', 'a month is yyyy-mm');
select throws_ok($$select public.company_forecast(array['2026-10'], 'totals', '2026-10-20')$$, '22023', 'validation', 'this month is not a month of the forecast');
select throws_ok($$select public.company_forecast(array['2027-11'], 'totals', '2026-10-20')$$, '22023', 'validation', 'nor 13 months ahead');
select throws_ok($$select public.company_forecast(array['2026-11', '2026-11'], 'totals', '2026-10-20')$$, '22023', 'validation', 'each month once');
select throws_ok($$select public.company_forecast(array[]::text[], 'totals', '2026-10-20')$$, '22023', 'validation', 'at least one month');
select throws_ok($$select public.company_forecast(array['2026-11', null], 'totals', '2026-10-20')$$, '22023', 'validation', 'no null month');
select throws_ok($$select public.company_forecast(null, 'totals', '2026-10-20')$$, '22023', 'validation', 'months are required');
select throws_ok($$select public.company_forecast(array['2026-11', '2026-12'], 'rows', '2026-10-20')$$, '22023', 'validation', 'rows take one month only');

-- RLS: another company's member gets only their own company; a user with no company is refused.
select tests.authenticate_as('f1307_other');
select is(
  public.company_forecast(array['2026-11', '2026-12'], 'totals', '2026-10-20') - 'today' - 'currency',
  pg_temp.ts('b'),
  'the other company''s member gets their own forecast, equal to the app''s build of their reads'
);
select is(
  (select count(*) from pg_temp.f1307 f
   where f.label not in ('b', 'b_house', 'b_rent', 'b_tenant', 'l_b')
     and (public.company_forecast(pg_temp.year('2026-11-01'), 'totals', '2026-10-20')::text
          || public.company_forecast(array['2026-11'], 'rows', '2026-10-20')::text) like '%' || f.id::text || '%'),
  0::bigint,
  'none of the first company''s projects, categories, parties, loans or edits is in it'
);
-- The general costs' part is listed even when nothing general is expected (the overhead project's page reads its
-- removed rows from it), and counts in no total.
select is(
  (select jsonb_build_object('general', x.m -> 'general', 'last', x.m -> 'parts' -> -1)
   from (select public.company_forecast(array['2026-11'], 'rows', '2026-10-20') -> 'months' -> 0 as m) x),
  jsonb_build_object('general', false, 'last', jsonb_build_object('income_minor', 0, 'expense_minor', 0, 'cash_only_minor', 0,
    'average_months', 1, 'rows', '[]'::jsonb, 'removed', '[]'::jsonb, 'arrived', '[]'::jsonb, 'loan_cash', '[]'::jsonb)),
  'a company with no general cost still gets the general part, with no row, and general is false'
);
select tests.authenticate_as('f1307_nobody');
select throws_ok($$select public.company_forecast(array['2026-11'], 'totals', '2026-10-20')$$, '42501', null, 'a user with no company is refused');

-- Grants: anon is refused; authenticated and service_role may execute it.
select tests.clear_authentication();
set local role anon;
select throws_ok($$select public.company_forecast(array['2026-11'], 'totals')$$, '42501', null, 'anon cannot execute company_forecast');
reset role;
select ok(
  has_function_privilege('authenticated', 'public.company_forecast(text[], text, date)', 'execute')
  and has_function_privilege('service_role', 'public.company_forecast(text[], text, date)', 'execute')
  and not has_function_privilege('anon', 'public.company_forecast(text[], text, date)', 'execute')
  and not has_function_privilege('anon', 'private.company_forecast_build(jsonb)', 'execute')
  and not has_function_privilege('anon', 'private.loan_payments_left(jsonb, bigint, date, date[])', 'execute'),
  'execute for authenticated and service_role, not anon'
);
select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.company_forecast(text[], text, date)'::regprocedure),
  false,
  'company_forecast is security invoker'
);

-- The two per-row helpers inline into the build: no configuration, not security definer, immutable; and every
-- function that calls them runs with an empty search_path (as main_screens_speed.test.sql holds for the ledger's).
select is(
  (select count(*) from pg_proc p
   where p.oid in ('private.forecast_month_index(text)'::regprocedure, 'private.forecast_pace_months(text)'::regprocedure)
     and p.proconfig is null and not p.prosecdef and p.provolatile = 'i'
     and has_function_privilege('authenticated', p.oid, 'execute')),
  2::bigint,
  'forecast_month_index and forecast_pace_months set no configuration, so they inline'
);
select is(
  (select case when count(*) = 0 then 'no callers found'
     else coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
       filter (where not coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']), 'every caller') end
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.prosrc ~ 'private\.(forecast_month_index|forecast_pace_months)\('),
  'every caller',
  'every function calling the inlined forecast helpers sets an empty search_path'
);

select * from finish();
rollback;
