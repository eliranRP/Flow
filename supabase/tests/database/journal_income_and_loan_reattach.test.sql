-- FLOW-151 (decision 0231). A journal entry that books income counts in the P&L on both bases; a
-- leg that would land on Suspense is refused, and set_category_account binds a kept-out category to a
-- balance-sheet account (its legs move, no P&L figure does; it undoes). A loan payment detached and
-- attached again goes through and undoes. Fixed dates. @example.com only.

begin;

select plan(45);

do $users$
begin
  perform tests.create_supabase_user('f151_owner', 'owner151@example.com');
  perform tests.create_supabase_user('f151_other', 'other151@example.com');
end
$users$;

create temp table f151 (label text primary key, id uuid);
grant all on f151 to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
set search_path = ''
as $$
  select id from pg_temp.f151 where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
begin
  uid := tests.get_supabase_uid('f151_owner');
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id('write'))::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

-- An account id by its system name, or by its category's name, in a company.
create or replace function pg_temp.acct(p_name text, p_company text default 'company')
returns uuid
language sql
set search_path = ''
as $$
  select a.id from public.accounts a
  left join public.categories c on c.id = a.category_id
  where a.company_id = pg_temp.id(p_company) and coalesce(c.name, a.name) = p_name
  order by a.category_id nulls first
  limit 1;
$$;
grant execute on function pg_temp.acct(text, text) to authenticated, service_role;

create or replace function pg_temp.leg(p_account text, p_amount bigint)
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_build_object('account_id', pg_temp.acct(p_account), 'amount_minor', p_amount, 'project_id', pg_temp.id('maple'));
$$;
grant execute on function pg_temp.leg(text, bigint) to authenticated, service_role;

-- The tenant's deposit applied as rent: debit the deposits, credit the rent.
create or replace function pg_temp.forfeit(p_key text, p_deposits text default 'Example tenant deposits')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_create_journal_entry(p_key, '2025-12-15', 'ILS', 'Example deposit applied as rent',
    'Example JE 151', jsonb_build_array(pg_temp.leg(p_deposits, 190000), pg_temp.leg('Example rent', -190000)));
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.forfeit(text, text) to authenticated, service_role;

create or replace function pg_temp.bind(p_key text, p_category uuid, p_account uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_set_category_account(p_key, p_category, p_account);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.bind(text, uuid, uuid) to authenticated, service_role;

create or replace function pg_temp.undo(p_key text, p_kind text, p_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_undo(p_key, p_kind, p_id);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.undo(text, text, uuid) to authenticated, service_role;

-- The house's income for December 2025 on a basis, as list_projects reads it.
create or replace function pg_temp.income(p_basis text)
returns bigint
language sql
set search_path = ''
as $$
  select (p->>'income_agorot')::bigint
  from jsonb_array_elements(public.company_pnl(pg_temp.id('company'), '2025-12-01', '2025-12-31', p_basis)->'projects') p
  where p->>'id' = pg_temp.id('maple')::text;
$$;
grant execute on function pg_temp.income(text) to authenticated, service_role;

-- A balance-sheet balance of the house as of the end of 2025.
create or replace function pg_temp.balance(p_account text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  result bigint;
begin
  perform pg_temp.as_mcp();
  select coalesce(sum((b->>'balance_minor')::bigint), 0)::bigint into result
  from jsonb_array_elements(public.mcp_account_balances('2025-12-31')->'balances') b
  where b->>'account_name' = p_account and b->>'project_id' = pg_temp.id('maple')::text;
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.balance(text) to authenticated, service_role;

select tests.authenticate_as('f151_owner');
select public.create_company('Example Rentals 151', true);
reset role;
insert into f151 (label, id) select 'company', id from public.companies where name = 'Example Rentals 151';
select tests.authenticate_as('f151_other');
select public.create_company('Example Other 151', true);
reset role;
insert into f151 (label, id) select 'other_company', id from public.companies where name = 'Example Other 151';

insert into public.projects (company_id, name, status) values (pg_temp.id('company'), 'Example Maple House', 'active');
insert into f151 (label, id) select 'maple', id from public.projects where name = 'Example Maple House';

-- Rent in the P&L; tenants' deposits kept out, under a name no binding knows; depreciation.
insert into public.categories (company_id, name, kind, sort_order)
values
  (pg_temp.id('company'), 'Example rent', 'income', 900),
  (pg_temp.id('company'), 'Example tenant deposits', 'income', 901),
  (pg_temp.id('company'), 'Example depreciation', 'expense', 902);
update public.categories set excluded_from_pnl = true
where company_id = pg_temp.id('company') and name = 'Example tenant deposits';
insert into f151 (label, id)
select v.label, c.id from public.categories c
join (values ('rent', 'Example rent'), ('deposits', 'Example tenant deposits')) v(label, name) on v.name = c.name
where c.company_id = pg_temp.id('company');

select public.store_mcp_credential(
  tests.get_supabase_uid('f151_owner'), 'hash-f151-write-1', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into f151 (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-f151-write-1';

-- The tenant paid a deposit of 1,900.00 in November, and rent of 1,700.00 in December.
insert into public.transactions (
  company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original, vat_amount,
  vat_status, doc_date, cash_date, currency, source, idempotency_key, description, category_id, project_id,
  pnl_role, user_assigned
)
values
  (pg_temp.id('company'), 'income', 'receipt', 'posted', 190000, 190000, 190000, 0, 'unknown',
   '2025-11-01', '2025-11-01', 'ILS', 'manual', 'f151:deposit', 'Example deposit', pg_temp.id('deposits'),
   pg_temp.id('maple'), 'project', true),
  (pg_temp.id('company'), 'income', 'invoice_receipt', 'posted', 170000, 170000, 170000, 0, 'unknown',
   '2025-12-01', '2025-12-01', 'ILS', 'manual', 'f151:rent', 'Example rent', pg_temp.id('rent'),
   pg_temp.id('maple'), 'project', true);
insert into f151 (label, id) select 'deposit_line', id from public.transactions where idempotency_key = 'f151:deposit';

-- book_line, before any journal entry in the session (flow.journal_entry never set), books income
-- as a receipt, as it always has.
create or replace function pg_temp.book_rent()
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_book_line('f151-book', '2025-10-01', 'income', 'ILS', 'Example rent booked', jsonb_build_array(
    jsonb_build_object('account_id', (select a.id from public.accounts a where a.company_id = pg_temp.id('company') and a.is_bank), 'amount_minor', 1000),
    jsonb_build_object('account_id', pg_temp.acct('Example rent'), 'amount_minor', -1000, 'project_id', pg_temp.id('maple'))));
  reset role;
  return (result->'data'->>'id')::uuid;
end;
$$;
grant execute on function pg_temp.book_rent() to authenticated, service_role;
insert into f151 (label, id) select 'booked', pg_temp.book_rent();
select is(
  (select t.doc_kind::text from public.transactions t where t.id = pg_temp.id('booked')),
  'receipt',
  'a book_line income line is still a receipt'
);

-- Bug A2: the deposits category has no binding, so its leg would land on Suspense.
select is(pg_temp.balance('Suspense'), -190000::bigint, 'the unbound deposit sits on Suspense');
select is(
  pg_temp.forfeit('f151-je-1')->'error'->>'message',
  'the category posts to Suspense',
  'an entry with a leg that would land on Suspense is refused in words'
);
select is(pg_temp.balance('Suspense'), -190000::bigint, 'and Suspense does not move');

-- set_category_account binds the deposits to Security deposit held: the deposit's legs move there.
create temp table f151_pnl as
select public.company_pnl(pg_temp.id('company'), null, null, 'cash') as cash,
       public.company_pnl(pg_temp.id('company'), null, null, 'invoiced') as invoiced;
select is(
  pg_temp.bind('f151-bind-1', pg_temp.id('deposits'), pg_temp.acct('Security deposit held'))->'data'->>'posts_to_name',
  'Security deposit held',
  'set_category_account binds a kept-out category to a balance-sheet account'
);
select is(
  (select c.ledger_account_id from public.categories c where c.id = pg_temp.id('deposits')),
  pg_temp.acct('Security deposit held'),
  'the binding is stored'
);
select is(pg_temp.balance('Security deposit held'), -190000::bigint, 'the deposit now sits on Security deposit held');
select is(pg_temp.balance('Suspense'), 0::bigint, 'and no longer on Suspense');
select is(
  (select public.company_pnl(pg_temp.id('company'), null, null, 'cash') = cash
      and public.company_pnl(pg_temp.id('company'), null, null, 'invoiced') = invoiced from f151_pnl),
  true,
  'no P&L figure moves on either basis'
);
select is((select count(*)::integer from private.ledger_pnl_diff(pg_temp.id('company'))), 0, 'and the ledger agrees with the posting rules');
select is(
  (select count(*)::integer from private.mcp_writes w
   where w.kind = 'category_account' and w.category_id = pg_temp.id('deposits') and w.undone_at is null),
  1,
  'the binding is a write the assistant can undo'
);

-- Bug A1: the entry books the income, on both bases, in its month.
select is(pg_temp.income('cash'), 170000::bigint, 'the house earned 1,700.00 in December on the cash basis');
select is(pg_temp.income('invoiced'), 170000::bigint, 'and on the invoiced basis');
insert into f151 (label, id) select 'je', (pg_temp.forfeit('f151-je-2')->'data'->>'id')::uuid;
select isnt(pg_temp.id('je'), null, 'the deposit applied as rent books as a journal entry');
select is(pg_temp.income('cash'), 360000::bigint, 'its income counts on the cash basis');
select is(pg_temp.income('invoiced'), 360000::bigint, 'and on the invoiced basis');
select is(
  (select (public.company_pnl(pg_temp.id('company'), '2025-11-01', '2025-11-30', 'cash')->>'income_agorot')::bigint),
  0::bigint,
  'in the month of its date, not another'
);
select tests.authenticate_as('f151_owner');
select is(
  (select (p->>'income_agorot')::bigint
   from jsonb_array_elements(public.get_dashboard('2025-12-01', '2025-12-31', 'invoiced')->'projects') p
   where p->>'id' = pg_temp.id('maple')::text),
  360000::bigint,
  'list_projects (get_dashboard) counts it'
);
select is(
  (public.get_project(pg_temp.id('maple'), 'cash', '2025-12-01', '2025-12-31')->'by_currency'->0->>'income_minor')::bigint,
  360000::bigint,
  'get_project counts it'
);
reset role;
select is(
  (select t.doc_kind::text from public.transactions t where t.id = pg_temp.id('je')),
  'invoice_receipt',
  'an income entry''s line is invoice_receipt, the kind income counts by on both bases'
);
select is(
  (select count(*)::integer from private.cash_parts(pg_temp.id('company'), 'cash', '2025-01-01', '2025-12-31') p
   where p.transaction_id = pg_temp.id('je') and p.in_cash),
  0,
  'it stays out of every cash figure'
);
select is(pg_temp.balance('Security deposit held'), 0::bigint, 'the deposit held goes down by 1,900.00');
select is(pg_temp.balance('Suspense'), 0::bigint, 'and nothing lands on Suspense');

-- An expense entry is as it was.
create or replace function pg_temp.depreciate()
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_create_journal_entry('f151-dep', '2025-12-31', 'ILS', 'Example depreciation', null,
    jsonb_build_array(pg_temp.leg('Example depreciation', 50000), pg_temp.leg('Accumulated depreciation', -50000)));
  reset role;
  return (result->'data'->>'id')::uuid;
end;
$$;
grant execute on function pg_temp.depreciate() to authenticated, service_role;
insert into f151 (label, id) select 'dep', pg_temp.depreciate();
select is(
  (select t.doc_kind::text from public.transactions t where t.id = pg_temp.id('dep')),
  'other',
  'an expense entry''s line stays other'
);
select is(
  (select (p->>'direct_agorot')::bigint
   from jsonb_array_elements(public.company_pnl(pg_temp.id('company'), '2025-12-01', '2025-12-31', 'cash')->'projects') p
   where p->>'id' = pg_temp.id('maple')::text),
  50000::bigint,
  'and counts as before'
);

-- Undo of the income entry restores every balance and the income.
select is(pg_temp.undo('f151-undo-je', 'journal_entry', pg_temp.id('je'))->>'ok', 'true', 'the income entry undoes');
select is(pg_temp.income('cash'), 170000::bigint, 'the income is back to the rent alone');
select is(pg_temp.balance('Security deposit held'), -190000::bigint, 'and the deposit is held again');

-- set_category_account refuses what cannot carry a binding.
select is(
  pg_temp.bind('f151-bind-pnl', pg_temp.id('rent'), pg_temp.acct('Security deposit held'))->'error'->>'message',
  'the category is counted in the P&L',
  'a category counted in the P&L is refused'
);
select is(
  pg_temp.bind('f151-bind-loan', (select c.id from public.categories c where c.company_id = pg_temp.id('company') and c.loan_part = 'principal'), pg_temp.acct('Property'))->'error'->>'message',
  'a loan part category posts by its part',
  'a loan part category is refused'
);
select is(
  pg_temp.bind('f151-bind-susp', pg_temp.id('deposits'), pg_temp.acct('Suspense'))->'error'->>'message',
  'a category posts only to a balance-sheet account',
  'Suspense is refused'
);
select is(
  pg_temp.bind('f151-bind-bank', pg_temp.id('deposits'), (select a.id from public.accounts a where a.company_id = pg_temp.id('company') and a.is_bank))->'error'->>'message',
  'a category posts only to a balance-sheet account',
  'the bank is refused'
);
select is(
  pg_temp.bind('f151-bind-other', pg_temp.id('deposits'), pg_temp.acct('Property', 'other_company'))->'error'->>'message',
  'The write was refused.',
  'another company''s account says nothing about it'
);

-- Undo of the binding puts the deposit back on Suspense; a binding changed since is a conflict.
select is(pg_temp.undo('f151-undo-bind', 'category_account', pg_temp.id('deposits'))->>'ok', 'true', 'the binding undoes');
select is(
  (select c.ledger_account_id from public.categories c where c.id = pg_temp.id('deposits')),
  null,
  'the category has no binding again'
);
select is(pg_temp.balance('Suspense'), -190000::bigint, 'and the deposit is back on Suspense');
select is(pg_temp.bind('f151-bind-2', pg_temp.id('deposits'), pg_temp.acct('Owner capital'))->>'ok', 'true', 'it binds again');
update public.categories set ledger_account_id = pg_temp.acct('Security deposit held') where id = pg_temp.id('deposits');
select is(
  pg_temp.undo('f151-undo-bind-2', 'category_account', pg_temp.id('deposits'))->'error'->>'code',
  'conflict',
  'a binding changed since is not undone'
);

-- Bug B: a payment detached and attached again.
select pg_temp.as_mcp();
insert into f151 (label, id)
select 'loan', (public.mcp_add_loan('f151-loan', 'Example Loan 151', 10000000, 60000, 360, '2025-01-01', 100000, 0, 'ILS')->'data'->>'id')::uuid;
reset role;
insert into public.transactions (
  company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original, vat_amount,
  vat_status, doc_date, currency, source, idempotency_key, description
)
select pg_temp.id('company'), 'expense', 'expense', 'posted', -100000, -100000, 100000, 0, 'unknown',
  d, 'ILS', 'manual', 'f151:loan:' || d::text, 'Example loan payment'
from unnest(array['2025-02-01', '2025-03-01']::date[]) d;
insert into f151 (label, id) select 'pay_' || to_char(doc_date, 'MM'), id from public.transactions where idempotency_key like 'f151:loan:%';
insert into f151 (label, id)
select 'interest_cat', c.id from public.categories c where c.company_id = pg_temp.id('company') and c.loan_part = 'interest';

create or replace function pg_temp.attach(p_key text, p_line text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_attach_loan_payment(p_key, pg_temp.id(p_line), pg_temp.id('loan'), jsonb_build_array(
    jsonb_build_object('part', 'interest', 'amount_minor', 100000, 'scheduled_minor', 50000, 'category_id', pg_temp.id('interest_cat')),
    jsonb_build_object('part', 'escrow', 'amount_minor', 0, 'scheduled_minor', 0),
    jsonb_build_object('part', 'principal', 'amount_minor', 0, 'scheduled_minor', 50000)));
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.attach(text, text) to authenticated, service_role;

select is(pg_temp.attach('f151-att-feb', 'pay_02')->>'ok', 'true', 'the February payment attaches');
select is(pg_temp.attach('f151-att-mar', 'pay_03')->>'ok', 'true', 'and the March one');
select pg_temp.as_mcp();
select public.mcp_detach_loan_payment('f151-det-feb', pg_temp.id('pay_02'));
select public.mcp_assign_expense('f151-file-feb', pg_temp.id('pay_02'), pg_temp.id('maple'), pg_temp.id('interest_cat'));
reset role;
select is(
  pg_temp.attach('f151-att-feb-2', 'pay_02')->>'ok',
  'true',
  'the detached February payment attaches again, before the March one already attached'
);
select is(
  (select jsonb_agg(jsonb_build_object('part', s.part, 'amount', s.amount_minor, 'cat', s.category_id = pg_temp.id('interest_cat')) order by s.part)
   from public.loan_splits s where s.transaction_id = pg_temp.id('pay_02')),
  '[{"cat": true, "part": "interest", "amount": 100000}, {"cat": false, "part": "escrow", "amount": 0}, {"cat": false, "part": "principal", "amount": 0}]'::jsonb,
  'with its exact parts and the interest category it names'
);
create or replace function pg_temp.payments()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  result integer;
begin
  perform pg_temp.as_mcp();
  result := jsonb_array_length(public.mcp_loan_payments(pg_temp.id('loan')));
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.payments() to authenticated, service_role;
select is(
  pg_temp.payments(),
  2,
  'the loan''s payments count it again'
);
select is(pg_temp.undo('f151-undo-att', 'loan_split', pg_temp.id('pay_02'))->>'ok', 'true', 'the re-attach undoes');
select is(
  (select count(*)::integer from public.loan_splits s where s.transaction_id = pg_temp.id('pay_02')),
  0,
  'and the line is whole again, as before it'
);

select * from finish();
rollback;
