-- FLOW-1146: a split payment counts by its parts. A rent line of 1,836.60 split into 1,700 rent and 136.60 water
-- refunds the 136.60 water bill (its exact amount, its category, its project); the line's whole amount does not
-- match. list_utility_months shows the line's parts. Invented names, ids and @example.com emails only.

begin;

select plan(7);

select tests.create_supabase_user('us_owner', 'us-owner@example.com');

create temp table us (label text primary key, id uuid);
grant all on us to authenticated;
create function pg_temp.usid(p_label text) returns uuid language sql as $$ select id from pg_temp.us where label = p_label; $$;
grant execute on function pg_temp.usid(text) to authenticated;

insert into us (label, id) values ('co', tests.fixture_company('us_owner', 'Example Split Books'));
insert into us (label, id) values
  ('bills', tests.fixture_category(pg_temp.usid('co'), 'חשבונות')),
  ('water', tests.fixture_category(pg_temp.usid('co'), 'מים וביוב')),
  ('power', tests.fixture_category(pg_temp.usid('co'), 'חשמל')),
  ('rent', tests.fixture_category(pg_temp.usid('co'), 'הכנסות שכירות', 'income')),
  ('house', tests.fixture_project(pg_temp.usid('co'), 'Example Hazel House'));
update public.categories set parent_id = pg_temp.usid('bills') where id in (pg_temp.usid('water'), pg_temp.usid('power'));
create temp table us_suppliers (label text, name text);
insert into us_suppliers values ('waterco', 'Example Water Co'), ('lightco', 'Example Light Co');
with made as (
  insert into public.suppliers (company_id, name) select pg_temp.usid('co'), v.name from us_suppliers v returning id, name
)
insert into us (label, id) select v.label, m.id from made m join us_suppliers v on v.name = m.name;

-- label, direction, category, supplier, date, amount. As of 2026-11-10.
create temp table us_lines (label text, direction text, category text, supplier text, doc_date date, amount bigint);
insert into us_lines values
  ('w1', 'expense', 'water', 'waterco', '2026-11-04', 13660),   -- refunded by the water part of rent1
  ('e1', 'expense', 'power', 'lightco', '2026-11-04', 10318),   -- nothing pays it: waiting
  ('rent1', 'income', 'rent', null, '2026-11-06', 183660),       -- split: 170000 rent + 13660 water
  ('w2', 'expense', 'water', 'waterco', '2026-10-04', 183660);   -- the split line's whole amount does not match it
insert into us (label, id)
select l.label, tests.fixture_line(pg_temp.usid('co'), 'us:' || l.label, l.amount, l.direction,
  pg_temp.usid('house'), pg_temp.usid(l.category), l.doc_date)
from us_lines l;
update public.transactions t set supplier_id = pg_temp.usid(l.supplier)
from us_lines l where t.id = pg_temp.usid(l.label) and l.supplier is not null;
select tests.line_split(pg_temp.usid('rent1'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.usid('rent'), 'project_id', null, 'amount_minor', 170000, 'gross_up', false),
  jsonb_build_object('category_id', pg_temp.usid('water'), 'project_id', null, 'amount_minor', 13660, 'gross_up', false)));

-- The private rows, read as the test's owner role (members reach them only through the public reads).
create temp table us_rows as
  select * from private.utility_refund_rows(pg_temp.usid('co'), '2026-11-10');
grant select on us_rows to authenticated;

select tests.authenticate_as('us_owner');

select is((select state || ':' || source || ':' || rule from us_rows where bill_id = pg_temp.usid('w1')), 'refunded:auto:1',
  'the water part of a split rent line refunds the water bill, by itself');
select is((select payment_id from us_rows where bill_id = pg_temp.usid('w1')), pg_temp.usid('rent1'),
  'its payment is the split line');
select is((select state from us_rows where bill_id = pg_temp.usid('e1')), 'waiting', 'a bill no part pays is still waiting');
select is((select state from us_rows where bill_id = pg_temp.usid('w2')), 'not_refunded',
  'a split line''s whole amount matches no bill');
select is(
  (select (b->>'wrong_category')::boolean
   from jsonb_array_elements(public.list_utility_refunds(null, '2026-11-10', true)->'bills') b
   where (b->>'bill_transaction_id')::uuid = pg_temp.usid('w1')),
  false, 'the refund is filed right: no fix card');

create temp table us_months as select public.list_utility_months(pg_temp.usid('house'), '2026-11-10') as r;
select is(
  (select l->'parts' from us_months, jsonb_array_elements(r->'months') m, jsonb_array_elements(m->'rent_lines') l
   where m->>'month' = '2026-11-01'),
  '[{"category_name": "הכנסות שכירות", "amount_minor": 170000}, {"category_name": "מים וביוב", "amount_minor": 13660}]'::jsonb,
  'the month''s rent line carries its parts, in order');
select is(
  (select (m->>'rent_in') || ':' || (m->>'not_refunded') from us_months, jsonb_array_elements(r->'months') m
   where m->>'month' = '2026-11-01'),
  '183660:10318', 'the rent in is the whole line; only the power bill is not refunded yet');

select * from finish();
rollback;
