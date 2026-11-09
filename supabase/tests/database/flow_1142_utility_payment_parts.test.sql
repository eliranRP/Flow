-- FLOW-1142: each suggested payment on the utility refunds list names its project and, when the line is split
-- by category, lists its parts (category, project and amount, in part order); an unsplit payment has [].
-- Invented names, ids and @example.com emails only. Amounts are agorot.

begin;

select plan(4);

select tests.create_supabase_user('up_owner', 'up-owner@example.com');

create temp table up (label text primary key, id uuid);
grant all on up to authenticated;
create function pg_temp.upid(p_label text) returns uuid language sql as $$ select id from pg_temp.up where label = p_label; $$;
grant execute on function pg_temp.upid(text) to authenticated;

insert into up (label, id) values ('co', tests.fixture_company('up_owner', 'Example Payment Parts Books'));
insert into up (label, id) values
  ('bills', tests.fixture_category(pg_temp.upid('co'), 'חשבונות')),
  ('power', tests.fixture_category(pg_temp.upid('co'), 'חשמל ומים')),
  ('other_income', tests.fixture_category(pg_temp.upid('co'), 'Example other income', 'income')),
  ('maple', tests.fixture_project(pg_temp.upid('co'), 'Example Maple House'));
update public.categories set parent_id = pg_temp.upid('bills') where id = pg_temp.upid('power');
with made as (
  insert into public.suppliers (company_id, name) values (pg_temp.upid('co'), 'Example Power Works') returning id
)
insert into up (label, id) select 'electric', id from made;

-- An unsplit payment, and one split into two category parts; both filed as other income on Maple. Flow
-- suggests nothing (FLOW-1143), so the owner picks each as its bill's refund.
create temp table up_lines (label text, direction text, category text, doc_date date, amount bigint);
insert into up_lines values
  ('bill1', 'expense', 'power', '2026-03-05', 5000),
  ('pay1', 'income', 'other_income', '2026-03-20', 5000),
  ('bill2', 'expense', 'power', '2026-04-05', 6000),
  ('pay2', 'income', 'other_income', '2026-04-20', 6000);
insert into up (label, id)
select l.label, tests.fixture_line(pg_temp.upid('co'), 'up:' || l.label, l.amount, l.direction,
  pg_temp.upid('maple'), pg_temp.upid(l.category), l.doc_date)
from up_lines l;
update public.transactions set supplier_id = pg_temp.upid('electric') where id in (pg_temp.upid('bill1'), pg_temp.upid('bill2'));
select tests.line_split(pg_temp.upid('pay2'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.upid('power'), 'project_id', pg_temp.upid('maple'), 'amount_minor', 2000),
  jsonb_build_object('category_id', pg_temp.upid('other_income'), 'amount_minor', 4000)));

select tests.authenticate_as('up_owner');
select public.answer_utility_refund(pg_temp.upid('bill1'), 'matched', pg_temp.upid('pay1'));
select public.answer_utility_refund(pg_temp.upid('bill2'), 'matched', pg_temp.upid('pay2'));

create or replace function pg_temp.payment(p_label text)
returns jsonb
language sql
as $$
  select b->'payment' from jsonb_array_elements(public.list_utility_refunds(null, '2026-06-30', true)->'bills') b
  where (b->>'bill_transaction_id')::uuid = pg_temp.upid(p_label);
$$;
grant execute on function pg_temp.payment(text) to authenticated;

select is((pg_temp.payment('bill1')->>'transaction_id')::uuid, pg_temp.upid('pay1'), 'bill1''s picked payment is pay1');
select is(pg_temp.payment('bill1')->>'project_name', 'Example Maple House', 'the payment names its project');
select is(pg_temp.payment('bill1')->'parts', '[]'::jsonb, 'an unsplit payment has no parts');
select is(pg_temp.payment('bill2')->'parts', jsonb_build_array(
    jsonb_build_object('category_id', pg_temp.upid('power'), 'category_name', 'חשמל ומים',
      'project_id', pg_temp.upid('maple'), 'project_name', 'Example Maple House', 'amount_minor', 2000),
    jsonb_build_object('category_id', pg_temp.upid('other_income'), 'category_name', 'Example other income',
      'project_id', pg_temp.upid('maple'), 'project_name', 'Example Maple House', 'amount_minor', 4000)),
  'a split payment lists its two parts with their amounts, in part order');

select * from finish();
rollback;
