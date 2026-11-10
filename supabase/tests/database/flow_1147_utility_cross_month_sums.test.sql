-- FLOW-1147: exact sums across months. A part of a split payment refunds bills of one property and category
-- dated within 62 days of each other when they add up to it exactly; bills further apart do not group. The bills
-- the owner matched to a line count toward it, so its rest refunds the other bills. Invented names, ids and
-- @example.com emails only. Amounts are cents.

begin;

select plan(6);

select tests.create_supabase_user('ux_owner', 'ux-owner@example.com');

create temp table ux (label text primary key, id uuid);
grant all on ux to authenticated;
create function pg_temp.uxid(p_label text) returns uuid language sql as $$ select id from pg_temp.ux where label = p_label; $$;
grant execute on function pg_temp.uxid(text) to authenticated;

insert into ux (label, id) values ('co', tests.fixture_company('ux_owner', 'Example Cross Books'));
insert into ux (label, id) values
  ('bills', tests.fixture_category(pg_temp.uxid('co'), 'חשבונות')),
  ('water', tests.fixture_category(pg_temp.uxid('co'), 'מים וביוב')),
  ('rent', tests.fixture_category(pg_temp.uxid('co'), 'הכנסות שכירות', 'income')),
  ('oak', tests.fixture_project(pg_temp.uxid('co'), 'Example Oak House')),
  ('elm', tests.fixture_project(pg_temp.uxid('co'), 'Example Elm House')),
  ('ash', tests.fixture_project(pg_temp.uxid('co'), 'Example Ash House'));
update public.categories set parent_id = pg_temp.uxid('bills') where id = pg_temp.uxid('water');
with made as (
  insert into public.suppliers (company_id, name) values (pg_temp.uxid('co'), 'Example Water Co') returning id
)
insert into ux (label, id) select 'waterco', id from made;

-- label, direction, category, project, date, amount. As of 2026-11-10.
create temp table ux_lines (label text, direction text, category text, project text, doc_date date, amount bigint);
insert into ux_lines values
  -- Oak: two September bills and an October one, paid by the water part of the October rent.
  ('oa', 'expense', 'water', 'oak', '2026-09-04', 5000),
  ('ob', 'expense', 'water', 'oak', '2026-09-22', 6000),
  ('oc', 'expense', 'water', 'oak', '2026-10-06', 4000),
  ('orent', 'income', 'rent', 'oak', '2026-10-07', 165000),   -- split: 150000 rent + 15000 water
  -- Elm: the owner matched the September bill to the October payment; its rest pays the October bill.
  ('ea', 'expense', 'water', 'elm', '2026-09-05', 3000),
  ('eb', 'expense', 'water', 'elm', '2026-10-05', 2500),
  ('epay', 'income', 'water', 'elm', '2026-10-08', 5500),
  -- Ash: two bills three months apart do not group.
  ('aa', 'expense', 'water', 'ash', '2026-05-01', 1000),
  ('ab', 'expense', 'water', 'ash', '2026-08-01', 1100),
  ('apay', 'income', 'water', 'ash', '2026-08-10', 2100);
insert into ux (label, id)
select l.label, tests.fixture_line(pg_temp.uxid('co'), 'ux:' || l.label, l.amount, l.direction,
  pg_temp.uxid(l.project), pg_temp.uxid(l.category), l.doc_date)
from ux_lines l;
update public.transactions t set supplier_id = pg_temp.uxid('waterco')
from ux_lines l where t.id = pg_temp.uxid(l.label) and l.direction = 'expense';
select tests.line_split(pg_temp.uxid('orent'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.uxid('rent'), 'project_id', null, 'amount_minor', 150000, 'gross_up', false),
  jsonb_build_object('category_id', pg_temp.uxid('water'), 'project_id', null, 'amount_minor', 15000, 'gross_up', false)));

select tests.authenticate_as('ux_owner');
select public.answer_utility_refund(pg_temp.uxid('ea'), 'matched', pg_temp.uxid('epay'), '2026-11-10');

-- The private rows, read as the test's owner role (members reach them only through the public reads).
reset role;
create temp table ux_rows as
  select * from private.utility_refund_rows(pg_temp.uxid('co'), '2026-11-10');
grant select on ux_rows to authenticated;

select is(
  (select string_agg(state || ':' || coalesce(source, '-') || ':' || coalesce(rule::text, '-'), ' ' order by doc_date)
   from ux_rows where bill_id in (pg_temp.uxid('oa'), pg_temp.uxid('ob'), pg_temp.uxid('oc'))),
  'refunded:auto:2 refunded:auto:2 refunded:auto:2',
  'the water part refunds two September bills and an October one: an exact sum across months');
select is(
  (select count(distinct payment_id) from ux_rows where bill_id in (pg_temp.uxid('oa'), pg_temp.uxid('ob'), pg_temp.uxid('oc'))
     and payment_id = pg_temp.uxid('orent')),
  1::bigint, 'their payment is the split rent line');
select is((select state || ':' || source from ux_rows where bill_id = pg_temp.uxid('ea')), 'refunded:owner',
  'the bill the owner matched stays the owner''s');
select is((select state || ':' || source from ux_rows where bill_id = pg_temp.uxid('eb')), 'refunded:auto',
  'the rest of the line the owner matched refunds the next bill');
select is((select payment_id from ux_rows where bill_id = pg_temp.uxid('eb')), pg_temp.uxid('epay'),
  'by that same line');
select is(
  (select string_agg(state, ' ' order by doc_date) from ux_rows where bill_id in (pg_temp.uxid('aa'), pg_temp.uxid('ab'))),
  'not_refunded not_refunded', 'bills more than 62 days apart do not group');

select * from finish();
rollback;
