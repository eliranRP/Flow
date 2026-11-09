-- FLOW-1141 (decision 0265): the utility refunds find the rent and the bills' categories by part of the
-- name. A chart with "הכנסות שכירות" (rent) and "12 חשבונות שוטפים" (the bills' parent, with "מים וביוב"
-- under it) finds its rent and its bills; "פיקדונות משוכרים" (deposits) is never rent. The exact names
-- (שכירות, חשבונות) are covered by flow_1134_utility_refunds.test.sql.
-- Invented names, ids and @example.com emails only. Amounts are agorot.

begin;

select plan(6);

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
  ('pine', tests.fixture_project(pg_temp.ucid('co'), 'Example Pine House'));
update public.categories set parent_id = pg_temp.ucid('bills') where id = pg_temp.ucid('water_cat');
with made as (
  insert into public.suppliers (company_id, name) values (pg_temp.ucid('co'), 'Example Water Works') returning id
)
insert into uc (label, id) select 'water', id from made;

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
  ('pine_pay', 'income', 'pine', 'deposits', '2026-05-25', 53000);
insert into uc (label, id)
select l.label, tests.fixture_line(pg_temp.ucid('co'), 'uc:' || l.label, l.amount, l.direction,
  pg_temp.ucid(l.project), pg_temp.ucid(l.category), l.doc_date)
from uc_lines l;
update public.transactions set supplier_id = pg_temp.ucid('water')
where id in (pg_temp.ucid('cedar_bill'), pg_temp.ucid('pine_bill'));

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
select is((pg_temp.bill('cedar_bill')->>'state') || '/' || (pg_temp.bill('cedar_bill')->>'rule'), 'suggested/rent_and_bills',
  'the usual rent from "הכנסות שכירות" plus the bill matches (rule 3)');
select is((pg_temp.bill('cedar_bill')->'payment'->>'transaction_id')::uuid, pg_temp.ucid('cedar_pay'), 'with the rent payment');
select is(pg_temp.bill('pine_bill')->>'no_rent', 'true', '"פיקדונות משוכרים" is not rent: a month with only deposits has no rent');
select is(pg_temp.bill('pine_bill')->>'state', 'not_refunded', 'a deposit plus the bill is not the usual rent plus the bill');

select * from finish();
rollback;
