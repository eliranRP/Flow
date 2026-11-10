-- FLOW-1144: list_utility_months gives a property's months, newest first, from its first utility bill or rent
-- line to the as-of month, with the rent in, the bills paid, the part not refunded, and the lines of each. A
-- company-paid utility is left out; another company's property is refused, and the owner reads their own.
-- Invented names, ids and @example.com emails only. Amounts are agorot.

begin;

select plan(10);

select tests.create_supabase_user('um_owner', 'um-owner@example.com');
select tests.create_supabase_user('um_outsider', 'um-outsider@example.com');

create temp table um (label text primary key, id uuid);
grant all on um to authenticated;
create function pg_temp.umid(p_label text) returns uuid language sql as $$ select id from pg_temp.um where label = p_label; $$;
grant execute on function pg_temp.umid(text) to authenticated;

insert into um (label, id) values
  ('co', tests.fixture_company('um_owner', 'Example Months Books')),
  ('other', tests.fixture_company('um_outsider', 'Example Other Months Books'));
insert into um (label, id) values
  ('bills', tests.fixture_category(pg_temp.umid('co'), 'חשבונות')),
  ('power', tests.fixture_category(pg_temp.umid('co'), 'חשמל ומים')),
  ('gas', tests.fixture_category(pg_temp.umid('co'), 'גז')),
  ('rent', tests.fixture_category(pg_temp.umid('co'), 'שכירות', 'income')),
  ('court', tests.fixture_project(pg_temp.umid('co'), 'Example Birch Court'));
update public.categories set parent_id = pg_temp.umid('bills') where id in (pg_temp.umid('power'), pg_temp.umid('gas'));
create temp table um_suppliers (label text, name text);
insert into um_suppliers values ('electric', 'Example Light Co'), ('gasco', 'Example Flame Co');
with made as (
  insert into public.suppliers (company_id, name) select pg_temp.umid('co'), v.name from um_suppliers v returning id, name
)
insert into um (label, id) select v.label, m.id from made m join um_suppliers v on v.name = m.name;

-- label, direction, category, supplier, date, amount. As of 2026-06-30.
create temp table um_lines (label text, direction text, category text, supplier text, doc_date date, amount bigint);
insert into um_lines values
  ('e3', 'expense', 'power', 'electric', '2026-03-05', 4000),   -- closed by the owner (seen)
  ('rent4', 'income', 'rent', null, '2026-04-01', 200000),
  ('e4', 'expense', 'power', 'electric', '2026-04-05', 5000),   -- refunded by pe4, exactly
  ('pe4', 'income', 'power', null, '2026-04-20', 5000),
  ('e5', 'expense', 'power', 'electric', '2026-05-05', 6000),   -- not refunded; May has no rent
  ('g5', 'expense', 'gas', 'gasco', '2026-05-08', 3000),        -- company-paid: left out
  ('rent6', 'income', 'rent', null, '2026-06-01', 200000),
  ('e6', 'expense', 'power', 'electric', '2026-06-10', 7000);   -- 20 days old: waiting
insert into um (label, id)
select l.label, tests.fixture_line(pg_temp.umid('co'), 'um:' || l.label, l.amount, l.direction,
  pg_temp.umid('court'), pg_temp.umid(l.category), l.doc_date)
from um_lines l;
update public.transactions t set supplier_id = pg_temp.umid(l.supplier)
from um_lines l where t.id = pg_temp.umid(l.label) and l.supplier is not null;

select tests.authenticate_as('um_owner');
select public.set_utility_payer(pg_temp.umid('court'), pg_temp.umid('gasco'), 'ILS', 'company');
select public.answer_utility_refund(pg_temp.umid('e3'), 'seen');

create temp table um_out as select public.list_utility_months(pg_temp.umid('court'), '2026-06-30') as r;

select is(
  (select string_agg(left(m->>'month', 7) || ':' || (m->>'rent_in') || ':' || (m->>'bills_paid') || ':' || (m->>'not_refunded'), ' '
     order by o)
   from um_out, jsonb_array_elements(r->'months') with ordinality e(m, o)),
  '2026-06:200000:7000:7000 2026-05:0:6000:6000 2026-04:200000:5000:0 2026-03:0:4000:0',
  'the months newest first, from the first bill: the rent in, the bills paid and the part not refunded (a waiting bill counts, a seen one does not)');
select is(
  (select string_agg((b->>'state') || ':' || (b->>'supplier_name'), ' ')
   from um_out, jsonb_array_elements(r->'months') m, jsonb_array_elements(m->'bills') b
   where m->>'month' = '2026-04-01'),
  'refunded:Example Light Co', 'each bill carries its state and supplier');
select is(
  (select jsonb_agg(l->'amount_minor') from um_out, jsonb_array_elements(r->'months') m, jsonb_array_elements(m->'rent_lines') l
   where m->>'month' = '2026-04-01'),
  '[200000]'::jsonb, 'each month lists its rent lines');
select ok(not exists (
    select 1 from um_out, jsonb_array_elements(r->'months') m, jsonb_array_elements(m->'bills') b
    where (b->>'bill_transaction_id')::uuid = pg_temp.umid('g5')),
  'a company-paid utility''s bill is left out');
select is((select r->'months'->1->'bills'->0->>'state' from um_out), 'not_refunded', 'May''s bill is not refunded');

-- Another company's property is refused; the owner reads their own.
select tests.authenticate_as('um_outsider');
select throws_ok(format('select public.list_utility_months(%L, %L)', pg_temp.umid('court'), '2026-06-30'),
  'P0001', 'project not found', 'another company''s property is refused');
select tests.authenticate_as('um_owner');
select is(jsonb_array_length(public.list_utility_months(pg_temp.umid('court'), '2026-06-30')->'months'), 4,
  'the owner reads their own property''s months');

-- FLOW-474: the as-of date is at most a year after today, and the months stop 600 back from it.
select throws_ok(format('select public.list_utility_months(%L, %L)', pg_temp.umid('court'),
    (current_date + interval '13 months')::date),
  'P0001', 'validation', 'an as-of date more than a year ahead is refused');
select lives_ok(format('select public.list_utility_months(%L, %L)', pg_temp.umid('court'),
    (current_date + interval '11 months')::date),
  'an as-of date within the year ahead reads');
select tests.clear_authentication();
select tests.fixture_line(pg_temp.umid('co'), 'um:rent-old', 200000, 'income',
  pg_temp.umid('court'), pg_temp.umid('rent'), '1950-01-01');
select tests.authenticate_as('um_owner');
select is(jsonb_array_length(public.list_utility_months(pg_temp.umid('court'), '2026-06-30')->'months'), 600,
  'a property''s months stop 600 months back from the as-of date');

select * from finish();
rollback;
