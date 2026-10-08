-- FLOW-110 (decision 0141). The owner deletes a loan (delete_loan) and puts it back
-- (restore_loan), MCP does the same with delete_loan and undo kind loan_delete, and the loans
-- list keeps a saved order (reorder_loans, MCP reorder_loans with undo kind loan_order).
-- Invented data only. Amounts are agorot.

begin;

select plan(42);

do $users$
begin
  perform tests.create_supabase_user('ldo_owner', 'ldo-owner@example.com');
  perform tests.create_supabase_user('ldo_viewer', 'ldo-viewer@example.com');
  perform tests.create_supabase_user('ldo_other', 'ldo-other@example.com');
end
$users$;

create temp table ldo (label text primary key, id uuid);
grant all on ldo to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.ldo where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into ldo (label, id) values ('co', tests.fixture_company('ldo_owner', 'Example Loan Delete LLC', true));
insert into ldo (label, id) values ('other_co', tests.fixture_company('ldo_other', 'Example Other Loans LLC'));
insert into ldo (label, id) values ('materials', tests.fixture_category(pg_temp.id('co'), 'Materials'));
insert into public.company_viewers (user_id, company_id)
values (tests.get_supabase_uid('ldo_viewer'), pg_temp.id('co'));

-- Three loans, named so the old order (by name) is A, B, C.
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
select pg_temp.id('co'), v.name, 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'ILS'
from (values ('A mortgage'), ('B mortgage'), ('C mortgage')) as v(name);
insert into ldo (label, id)
select lower(left(name, 1)), id from public.loans where company_id = pg_temp.id('co');
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values (pg_temp.id('other_co'), 'Other mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'ILS');
insert into ldo (label, id) select 'other_loan', id from public.loans where company_id = pg_temp.id('other_co');
insert into public.loan_rates (company_id, loan_id, effective_date, annual_rate_ppm)
values (pg_temp.id('co'), pg_temp.id('a'), '2026-07-01', 55000);

-- Two payments of 1000.00 on loan A and one plain line.
insert into ldo (label, id)
select 'txn_' || v.k, tests.fixture_line(pg_temp.id('co'), 'ldo:' || v.k, 100000,
  p_category => pg_temp.id('materials'), p_doc_date => v.d::date,
  p_doc_kind => 'expense', p_pnl_role => null)
from (values ('one', '2026-06-01'), ('two', '2026-07-01'), ('plain', '2026-06-05')) as v(k, d);

create or replace function pg_temp.attach(p_label text, p_loan text)
returns void
language sql
as $$
  insert into public.loan_splits (
    company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review
  )
  select pg_temp.id('co'), pg_temp.id(p_loan), pg_temp.id(p_label), v.part::public.loan_split_part, v.amount, v.amount,
    (select c.id from public.categories c where c.company_id = pg_temp.id('co') and c.loan_part = v.part::public.loan_split_part),
    false
  from (values ('interest', 70000), ('escrow', 20000), ('principal', 10000)) as v(part, amount);
$$;
grant execute on function pg_temp.attach(text, text) to authenticated, service_role;

create or replace function pg_temp.parts(p_label text)
returns text
language sql
as $$
  select coalesce(string_agg(s.part || ':' || s.amount_minor, ',' order by s.part), '')
  from public.loan_splits s where s.transaction_id = pg_temp.id(p_label);
$$;
grant execute on function pg_temp.parts(text) to authenticated, service_role;

create or replace function pg_temp.names()
returns text
language sql
as $$
  select string_agg(e->>'name', ',' order by o)
  from jsonb_array_elements((public.mcp_list_loans())) with ordinality as x(e, o);
$$;
grant execute on function pg_temp.names() to authenticated, service_role;

select pg_temp.attach('txn_one', 'a');
select pg_temp.attach('txn_two', 'a');

select public.store_mcp_credential(tests.get_supabase_uid('ldo_owner'), 'hash-ldo-write01', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into ldo (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-ldo-write01';
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('ldo_owner'), pg_temp.id('co'), 'hash-ldo-read001', 'pepper-1', array['read'], now() + interval '90 days');
insert into ldo (label, id) select 'read', id from private.mcp_credentials where token_hash = 'hash-ldo-read001';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('ldo_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id(p_label))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

create temp table ldo_out (label text primary key, body jsonb);
grant all on ldo_out to authenticated, service_role;

select tests.authenticate_as('ldo_owner');

-- The order starts by name.
select is(pg_temp.names(), 'A mortgage,B mortgage,C mortgage', 'loans list by name before any order is saved');

-- The delete policy is gone: a direct delete removes nothing.
delete from public.loans where id = pg_temp.id('c');
select ok(exists (select 1 from public.loans where id = pg_temp.id('c')), 'a direct delete removes nothing');

-- The app: delete_loan.
insert into ldo_out (label, body)
select 'expense_before', public.get_dashboard(null, null, 'cash');
insert into ldo_out (label, body) select 'delete', public.delete_loan(pg_temp.id('a'));
select is((select body->>'payments' from ldo_out where label = 'delete'), '2', 'delete_loan counts the payments it unmatches');
select is((select body->>'name' from ldo_out where label = 'delete'), 'A mortgage', 'and names the loan');
select ok(not exists (select 1 from public.loans where id = pg_temp.id('a')), 'the loan is gone');
select is(pg_temp.parts('txn_one') || pg_temp.parts('txn_two'), '', 'its parts are gone');
select ok(not exists (select 1 from public.loan_rates where loan_id = pg_temp.id('a')), 'and its rate rows');
select is((public.get_transaction(pg_temp.id('txn_one'))->>'in_pnl')::boolean, true, 'a payment counts whole again');
select is(
  (public.get_dashboard(null, null, 'cash')->>'excluded_expense_agorot')::bigint,
  (select (body->>'excluded_expense_agorot')::bigint - 20000 from ldo_out where label = 'expense_before'),
  'the principal it counted out of the P&L is back in');
select is(pg_temp.names(), 'B mortgage,C mortgage', 'the list no longer has it');

-- The app's undo.
insert into ldo_out (label, body) select 'restore', public.restore_loan(pg_temp.id('a'));
select is((select body->>'payments' from ldo_out where label = 'restore'), '2', 'restore_loan puts the payments back');
select is(pg_temp.parts('txn_one'), 'interest:70000,escrow:20000,principal:10000', 'with their parts');
select is((select count(*)::int from public.loan_rates where loan_id = pg_temp.id('a')), 1, 'and its rate row');
select is(
  (public.get_dashboard(null, null, 'cash')->>'excluded_expense_agorot')::bigint,
  (select (body->>'excluded_expense_agorot')::bigint from ldo_out where label = 'expense_before'),
  'the totals are as before the delete');
select is(pg_temp.names(), 'A mortgage,B mortgage,C mortgage', 'and the list too');
select throws_ok($$select public.restore_loan(pg_temp.id('a'))$$, 'P0001', 'loan not found',
  'a restored delete cannot be restored twice');

-- A payment matched to another loan since the delete: restore refuses.
select public.delete_loan(pg_temp.id('a'));
reset role;
select pg_temp.attach('txn_two', 'b');
select tests.authenticate_as('ldo_owner');
select throws_ok($$select public.restore_loan(pg_temp.id('a'))$$, '23514', 'loan cannot be restored',
  'restore refuses when a payment was matched again');
select ok(not exists (select 1 from public.loans where id = pg_temp.id('a')), 'and leaves nothing behind');
select is(pg_temp.parts('txn_one'), '', 'not even the parts that still fit');
reset role;
delete from public.loan_splits where transaction_id = pg_temp.id('txn_two');
select tests.authenticate_as('ldo_owner');
select lives_ok($$select public.restore_loan(pg_temp.id('a'))$$, 'once that line is free again, restore works');

-- Refusals.
select throws_ok($$select public.delete_loan(pg_temp.id('other_loan'))$$, 'P0001', 'loan not found',
  'another company''s loan is not found');
reset role;
select ok(exists (select 1 from public.loans where id = pg_temp.id('other_loan')), 'and stays');
select tests.authenticate_as('ldo_viewer');
select throws_ok($$select public.delete_loan(pg_temp.id('a'))$$, '42501', 'forbidden', 'a viewer cannot delete');
select throws_ok($$select public.reorder_loans(array[pg_temp.id('c'), pg_temp.id('b'), pg_temp.id('a')])$$,
  '42501', 'forbidden', 'or reorder');
select is((select count(*)::int from public.loans where company_id = pg_temp.id('co')), 3, 'a viewer still reads every loan');

-- Order.
select tests.authenticate_as('ldo_owner');
select lives_ok($$select public.reorder_loans(array[pg_temp.id('c'), pg_temp.id('a'), pg_temp.id('b')])$$,
  'the owner saves an order');
select is(pg_temp.names(), 'C mortgage,A mortgage,B mortgage', 'the list follows it');
select throws_ok($$select public.reorder_loans(array[pg_temp.id('c'), pg_temp.id('a')])$$, 'P0001', 'validation',
  'an order that leaves out a loan is validation');
select throws_ok($$select public.reorder_loans(array[pg_temp.id('c'), pg_temp.id('a'), pg_temp.id('a')])$$,
  'P0001', 'validation', 'one that names a loan twice');
select throws_ok($$select public.reorder_loans(array[pg_temp.id('c'), pg_temp.id('a'), pg_temp.id('other_loan')])$$,
  'P0001', 'validation', 'or another company''s loan');
reset role;
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values (pg_temp.id('co'), '0 newest', 1000000, 60000, 12, '2026-01-01', 90000, 0, 'ILS');
insert into ldo (label, id) select 'new', id from public.loans where name = '0 newest';
select tests.authenticate_as('ldo_owner');
select is(pg_temp.names(), 'C mortgage,A mortgage,B mortgage,0 newest', 'a new loan goes last');

-- MCP.
select pg_temp.as_mcp('write');
insert into ldo_out (label, body)
select 'mcp_order', public.mcp_reorder_loans('ldo-order-1',
  array[pg_temp.id('new'), pg_temp.id('b'), pg_temp.id('a'), pg_temp.id('c')]);
select is((select body->'data'->>'undo_kind' from ldo_out where label = 'mcp_order'), 'loan_order',
  'MCP reorder_loans returns its undo kind');
select is(pg_temp.names(), '0 newest,B mortgage,A mortgage,C mortgage', 'and saves the order');
select is(public.mcp_reorder_loans('ldo-order-1',
    array[pg_temp.id('new'), pg_temp.id('b'), pg_temp.id('a'), pg_temp.id('c')]),
  (select body from ldo_out where label = 'mcp_order'), 'a replay returns the same answer');
select is(public.mcp_reorder_loans('ldo-order-2', array[pg_temp.id('a')])->'error'->>'code', 'validation',
  'a partial order is validation');

insert into ldo_out (label, body) select 'mcp_delete', public.mcp_delete_loan('ldo-delete-1', pg_temp.id('a'));
select is((select body->'data'->>'payments' from ldo_out where label = 'mcp_delete'), '2',
  'MCP delete_loan unmatches the payments');
select is(public.mcp_undo('ldo-undo-order', 'loan_order', pg_temp.id('co'))->'error'->>'code', 'conflict',
  'undo of the order is a conflict once a loan is gone');
select is(public.mcp_undo('ldo-undo-delete', 'loan_delete', pg_temp.id('a'))->>'ok', 'true',
  'undo puts the loan back');
select is(pg_temp.parts('txn_two'), 'interest:70000,escrow:20000,principal:10000', 'with its parts');
select is(public.mcp_undo('ldo-undo-order-2', 'loan_order', pg_temp.id('co'))->>'ok', 'true',
  'with the loan back, undo of the order works');
select is(pg_temp.names(), 'C mortgage,A mortgage,B mortgage,0 newest', 'and restores the order before it');

select pg_temp.as_mcp('read');
select is(public.mcp_delete_loan('ldo-delete-2', pg_temp.id('a'))->'error'->>'code', 'forbidden',
  'a read token cannot delete');

select * from finish();
rollback;
