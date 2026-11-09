-- FLOW-1141 (decision 0265): the utility refunds find the rent and the bills' categories by part of the
-- name. A chart with "הכנסות שכירות" (rent) and "12 חשבונות שוטפים" (the bills' parent, with "מים וביוב"
-- under it) finds its rent and its bills; "פיקדונות משוכרים" (deposits) is never rent. The exact names
-- (שכירות, חשבונות) are covered by flow_1134_utility_refunds.test.sql.
-- Invented names, ids and @example.com emails only. Amounts are agorot.

begin;

select plan(9);

select tests.create_supabase_user('uc_owner', 'uc-owner@example.com');

create temp table uc (label text primary key, id uuid);
grant all on uc to authenticated;
create function pg_temp.ucid(p_label text) returns uuid language sql as $$ select id from pg_temp.uc where label = p_label; $$;
grant execute on function pg_temp.ucid(text) to authenticated;

insert into uc (label, id) values ('co', tests.fixture_company('uc_owner', 'Example Category Names Books'));
insert into uc (label, id) values
  ('rent', tests.fixture_category(pg_temp.ucid('co'), 'הכנסות שכירות', 'income')),
  ('deposits', tests.fixture_category(pg_temp.ucid('co'), 'פיקדונות משוכרים', 'income')),
  ('bills', tests.fixture_category(pg_temp.ucid('co'), '12 חשבונות שוטפים')),
  ('water_cat', tests.fixture_category(pg_temp.ucid('co'), 'מים וביוב')),
  ('cedar', tests.fixture_project(pg_temp.ucid('co'), 'Example Cedar House')),
  ('pine', tests.fixture_project(pg_temp.ucid('co'), 'Example Pine House')),
  ('lane', tests.fixture_project(pg_temp.ucid('co'), 'Example Oak Lane')),
  -- Names that only contain the word: not roots (the review of #1105).
  ('reversal', tests.fixture_category(pg_temp.ucid('co'), 'ביטול שכירות', 'income')),
  ('storage', tests.fixture_category(pg_temp.ucid('co'), 'הכנסה משכירות מחסן', 'income')),
  ('accounting', tests.fixture_category(pg_temp.ucid('co'), 'שירותי הנהלת חשבונות'));
update public.categories set parent_id = pg_temp.ucid('bills') where id = pg_temp.ucid('water_cat');
create temp table uc_suppliers (label text, name text);
insert into uc_suppliers values ('water', 'Example Water Works'), ('power', 'Example Power Works'),
  ('accountant', 'Example Book Keepers');
with made as (
  insert into public.suppliers (company_id, name) select pg_temp.ucid('co'), v.name from uc_suppliers v returning id, name
)
insert into uc (label, id) select v.label, m.id from made m join uc_suppliers v on v.name = m.name;

-- label, direction, project, category, date, amount.
create temp table uc_lines (label text, direction text, project text, category text, doc_date date, amount bigint);
insert into uc_lines values
  -- Cedar: rent under "הכנסות שכירות", a water bill under "מים וביוב", and the rent plus the bill in one payment.
  ('rent3', 'income', 'cedar', 'rent', '2026-03-01', 100000),
  ('rent4', 'income', 'cedar', 'rent', '2026-04-01', 100000),
  ('rent5', 'income', 'cedar', 'rent', '2026-05-01', 100000),
  ('cedar_bill', 'expense', 'cedar', 'water_cat', '2026-05-05', 3000),
  ('cedar_pay', 'income', 'cedar', 'rent', '2026-05-20', 103000),
  -- Pine: only deposits come in, and a deposit plus the bill in one payment.
  ('dep4', 'income', 'pine', 'deposits', '2026-04-01', 50000),
  ('dep5', 'income', 'pine', 'deposits', '2026-05-01', 50000),
  ('pine_bill', 'expense', 'pine', 'water_cat', '2026-05-06', 3000),
  ('pine_pay', 'income', 'pine', 'deposits', '2026-05-25', 53000),
  -- Pine: a bill filed straight under the parent "12 חשבונות שוטפים".
  ('parent_bill', 'expense', 'pine', 'bills', '2026-05-09', 2000),
  -- Cedar: the accountant under "שירותי הנהלת חשבונות" is not a utility.
  ('acct_bill', 'expense', 'cedar', 'accounting', '2026-05-08', 4000),
  -- Oak Lane: a rent reversal and storage rent in May are not rent.
  ('reversal5', 'income', 'lane', 'reversal', '2026-05-02', 40000),
  ('storage5', 'income', 'lane', 'storage', '2026-05-03', 30000),
  ('lane_bill', 'expense', 'lane', 'water_cat', '2026-05-07', 3000);
insert into uc (label, id)
select l.label, tests.fixture_line(pg_temp.ucid('co'), 'uc:' || l.label, l.amount, l.direction,
  pg_temp.ucid(l.project), pg_temp.ucid(l.category), l.doc_date)
from uc_lines l;
update public.transactions set supplier_id = pg_temp.ucid('water')
where id in (pg_temp.ucid('cedar_bill'), pg_temp.ucid('pine_bill'), pg_temp.ucid('lane_bill'));
update public.transactions set supplier_id = pg_temp.ucid('power') where id = pg_temp.ucid('parent_bill');
update public.transactions set supplier_id = pg_temp.ucid('accountant') where id = pg_temp.ucid('acct_bill');

select tests.authenticate_as('uc_owner');

create or replace function pg_temp.bill(p_label text)
returns jsonb
language sql
as $$
  select b from jsonb_array_elements(public.list_utility_refunds(null, '2026-06-30', true)->'bills') b
  where (b->>'bill_transaction_id')::uuid = pg_temp.ucid(p_label);
$$;
grant execute on function pg_temp.bill(text) to authenticated;

select isnt(pg_temp.bill('cedar_bill'), null,
  'a bill under "מים וביוב", a child of "12 חשבונות שוטפים", is a utility''s bill');
select is(pg_temp.bill('cedar_bill')->>'no_rent', 'false',
  'rent under "הכנסות שכירות" in the bill''s month: not a month with no rent');
select is(pg_temp.bill('cedar_bill')->>'state', 'not_refunded',
  'the rent plus the bill is not counted (FLOW-1143: only exact matches in the bill''s category)');
select is(pg_temp.bill('cedar_bill')->'payment', 'null'::jsonb, 'and no payment is suggested');
select is(pg_temp.bill('pine_bill')->>'no_rent', 'true', '"פיקדונות משוכרים" is not rent: a month with only deposits has no rent');
select is(pg_temp.bill('pine_bill')->>'state', 'not_refunded', 'a deposit plus the bill is not counted either');

select isnt(pg_temp.bill('parent_bill'), null, 'a bill filed straight under "12 חשבונות שוטפים" is a utility''s bill');
select is(pg_temp.bill('acct_bill'), null, '"שירותי הנהלת חשבונות" is not the bills'' tree: the accountant is no utility');
select is(pg_temp.bill('lane_bill')->>'no_rent', 'true',
  '"ביטול שכירות" and "הכנסה משכירות מחסן" are not rent: the month has no rent');

select * from finish();
rollback;
