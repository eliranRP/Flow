-- FLOW-1159: list_utility_income gives a utility bill and the money in on its property within p_months months
-- before and after it (clamped to 1..6, default 2), newest first: each line with its parts on the property and
-- the bills it refunds. A line on another property counts when one of its parts is on this one, and shows only
-- that part. Another company's bill and a line that is not a bill are refused. Invented names, ids and
-- @example.com emails only. Amounts are cents.

begin;

select plan(11);

select tests.create_supabase_user('ui_owner', 'ui-owner@example.com');
select tests.create_supabase_user('ui_outsider', 'ui-outsider@example.com');

create temp table ui (label text primary key, id uuid);
grant all on ui to authenticated;
create function pg_temp.uiid(p_label text) returns uuid language sql as $$ select id from pg_temp.ui where label = p_label; $$;
grant execute on function pg_temp.uiid(text) to authenticated;
create function pg_temp.uilabel(p_id text) returns text language sql as $$ select label from pg_temp.ui where id::text = p_id; $$;
grant execute on function pg_temp.uilabel(text) to authenticated;

insert into ui (label, id) values
  ('co', tests.fixture_company('ui_owner', 'Example Income Books')),
  ('other', tests.fixture_company('ui_outsider', 'Example Other Income Books'));
insert into ui (label, id) values
  ('bills', tests.fixture_category(pg_temp.uiid('co'), 'חשבונות')),
  ('water', tests.fixture_category(pg_temp.uiid('co'), 'מים וביוב')),
  ('rent', tests.fixture_category(pg_temp.uiid('co'), 'הכנסות שכירות', 'income')),
  ('house', tests.fixture_project(pg_temp.uiid('co'), 'Example Hazel House')),
  ('flat', tests.fixture_project(pg_temp.uiid('co'), 'Example Rowan Flat'));
update public.categories set parent_id = pg_temp.uiid('bills') where id = pg_temp.uiid('water');
insert into public.suppliers (company_id, name) values (pg_temp.uiid('co'), 'Example Water Co');
insert into ui (label, id)
select 'waterco', s.id from public.suppliers s where s.company_id = pg_temp.uiid('co') and s.name = 'Example Water Co';

-- label, direction, category, project, supplier, date, amount. As of 2026-11-10; the bill read is w2 (2026-10-04).
create temp table ui_lines (label text, direction text, category text, project text, supplier text, doc_date date, amount bigint);
insert into ui_lines values
  ('old', 'income', 'rent', 'house', null, '2026-07-01', 200000),      -- 3 months before: only in a wider window
  ('w1', 'expense', 'water', 'house', 'waterco', '2026-09-04', 9850),  -- refunded by the water part of rent1
  ('rent1', 'income', 'rent', 'house', null, '2026-09-06', 159850),    -- split: 150000 rent + 9850 water
  ('w2', 'expense', 'water', 'house', 'waterco', '2026-10-04', 8000),  -- the bill read: nothing pays it
  ('rent2', 'income', 'rent', 'house', null, '2026-10-06', 200000),
  ('mixed', 'income', 'rent', 'flat', null, '2026-10-08', 30000),     -- the flat's line, its 5000 water part on the house
  ('elsewhere', 'income', 'rent', 'flat', null, '2026-10-09', 25000); -- the flat's only: not listed
insert into ui (label, id)
select l.label, tests.fixture_line(pg_temp.uiid('co'), 'ui:' || l.label, l.amount, l.direction,
  pg_temp.uiid(l.project), pg_temp.uiid(l.category), l.doc_date)
from ui_lines l;
update public.transactions t set supplier_id = pg_temp.uiid(l.supplier)
from ui_lines l where t.id = pg_temp.uiid(l.label) and l.supplier is not null;
select tests.line_split(pg_temp.uiid('rent1'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.uiid('rent'), 'project_id', null, 'amount_minor', 150000, 'gross_up', false),
  jsonb_build_object('category_id', pg_temp.uiid('water'), 'project_id', null, 'amount_minor', 9850, 'gross_up', false)));
select tests.line_split(pg_temp.uiid('mixed'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.uiid('rent'), 'project_id', null, 'amount_minor', 25000, 'gross_up', false),
  jsonb_build_object('category_id', pg_temp.uiid('water'), 'project_id', pg_temp.uiid('house'), 'amount_minor', 5000, 'gross_up', false)));

-- The private rows, read as the test's owner role before authenticating (members reach them only through the
-- public reads).
create temp table ui_rows as
  select * from private.utility_refund_rows(pg_temp.uiid('co'), '2026-11-10');
grant select on ui_rows to authenticated;

select tests.authenticate_as('ui_owner');

create temp table ui_out as select public.list_utility_income(pg_temp.uiid('w2'), null, '2026-11-10') as r;

select is(
  (select concat_ws(':', r->'bill'->>'state', r->'bill'->>'category_name', r->'bill'->>'supplier_name',
     r->'bill'->>'project_name', r->'bill'->>'amount_minor') from ui_out),
  'not_refunded:מים וביוב:Example Water Co:Example Hazel House:8000',
  'the bill with its category, supplier, property and amount');
select is((select r->'bill'->>'state' from ui_out), (select state from ui_rows where bill_id = pg_temp.uiid('w2')),
  'its state is the matching''s');
select is((select concat_ws(':', r->>'months', r->>'from', r->>'to') from ui_out), '2:2026-08-04:2026-12-04',
  'by default two months before and after the bill');
select is(
  (select string_agg(pg_temp.uilabel(l->>'transaction_id'), ' ' order by o)
   from ui_out, jsonb_array_elements(r->'lines') with ordinality e(l, o)),
  'mixed rent2 rent1',
  'the property''s money in within the window, newest first; a line elsewhere with a part here counts, one elsewhere only does not');
select is(
  (select jsonb_agg(jsonb_build_object('c', p->>'category_name', 'a', (p->>'amount_minor')::bigint) order by o)
   from ui_out, jsonb_array_elements(r->'lines') l, jsonb_array_elements(l->'parts') with ordinality e(p, o)
   where (l->>'transaction_id')::uuid = pg_temp.uiid('mixed')),
  '[{"c": "מים וביוב", "a": 5000}]'::jsonb,
  'a line on another property shows only its part on this one');
select is(
  (select jsonb_agg(jsonb_build_object('c', p->>'category_name', 'a', (p->>'amount_minor')::bigint) order by o)
   from ui_out, jsonb_array_elements(r->'lines') l, jsonb_array_elements(l->'parts') with ordinality e(p, o)
   where (l->>'transaction_id')::uuid = pg_temp.uiid('rent1')),
  '[{"c": "הכנסות שכירות", "a": 150000}, {"c": "מים וביוב", "a": 9850}]'::jsonb,
  'a split line on the property shows its parts in order');
select is(
  (select string_agg(pg_temp.uilabel(b->>'bill_transaction_id') || ':' || (b->>'doc_date') || ':' || (b->>'category_name'), ' ')
   from ui_out, jsonb_array_elements(r->'lines') l, jsonb_array_elements(l->'refunded_bills') b
   where (l->>'transaction_id')::uuid = pg_temp.uiid('rent1')),
  'w1:2026-09-04:מים וביוב', 'a line names the bills it is the refund of');

-- The window is clamped to 1..6 months.
select is(
  (select concat_ws(':', x->>'months', x->>'from') from (select public.list_utility_income(pg_temp.uiid('w2'), 0, '2026-11-10') as x) q),
  '1:2026-09-04', 'fewer than one month reads one');
select is(
  (select x->>'months' || ':' || string_agg(pg_temp.uilabel(l->>'transaction_id'), ' ' order by o)
   from (select public.list_utility_income(pg_temp.uiid('w2'), 10, '2026-11-10') as x) q,
     jsonb_array_elements(x->'lines') with ordinality e(l, o)
   group by x->>'months'),
  '6:mixed rent2 rent1 old', 'more than six months reads six, and the wider window takes the older line');

-- A line that is not a utility bill, and another company's bill, are refused.
select throws_ok(format('select public.list_utility_income(%L)', pg_temp.uiid('rent2')),
  'P0001', 'transaction not found', 'a money-in line is not a bill');
select tests.authenticate_as('ui_outsider');
select throws_ok(format('select public.list_utility_income(%L)', pg_temp.uiid('w2')),
  'P0001', 'transaction not found', 'another company''s bill is refused');

select * from finish();
rollback;
