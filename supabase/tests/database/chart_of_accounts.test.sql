-- FLOW-152. The chart of accounts: the company adds, renames, archives and merges its own
-- balance-sheet accounts through the MCP (create_account, update_account, archive_account,
-- restore_account, merge_account), each with an undo; list_accounts says what each holds;
-- get_balance_sheet balances. Owner capital is equity. Invented data only; amounts are cents.

begin;

select plan(164);

do $users$
begin
  perform tests.create_supabase_user('p152_owner', 'owner152@example.com');
  perform tests.create_supabase_user('p152_other', 'other152@example.com');
end
$users$;

create temp table p152 (label text primary key, id uuid);
grant all on p152 to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
set search_path = ''
as $$ select id from pg_temp.p152 where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- Act as a user holding one of the credentials: a = company A's owner (write), r = A's owner, read only,
-- b = company B's owner (write).
create or replace function pg_temp.as_mcp(p_who text default 'a')
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid(case when p_who = 'b' then 'p152_other' else 'p152_owner' end);
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1',
    'mcp_tid', pg_temp.id(case p_who when 'b' then 'bwrite' when 'r' then 'read' else 'write' end))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

create or replace function pg_temp.create_acct(p_key text, p_name text, p_type text, p_descr text default null, p_who text default 'a')
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_mcp(p_who);
  r := public.mcp_create_account(p_key, p_name, p_type, p_descr);
  reset role;
  return r;
end; $$;
grant execute on function pg_temp.create_acct(text, text, text, text, text) to authenticated, service_role;

create or replace function pg_temp.update_acct(p_key text, p_id uuid, p_name text default null, p_descr text default null,
  p_type text default null, p_who text default 'a')
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_mcp(p_who);
  r := public.mcp_update_account(p_key, p_id, p_name, p_descr, p_type);
  reset role;
  return r;
end; $$;
grant execute on function pg_temp.update_acct(text, uuid, text, text, text, text) to authenticated, service_role;

create or replace function pg_temp.archive_acct(p_key text, p_id uuid, p_who text default 'a')
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_mcp(p_who);
  r := public.mcp_archive_account(p_key, p_id);
  reset role;
  return r;
end; $$;
grant execute on function pg_temp.archive_acct(text, uuid, text) to authenticated, service_role;

create or replace function pg_temp.restore_acct(p_key text, p_id uuid, p_who text default 'a')
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_mcp(p_who);
  r := public.mcp_restore_account(p_key, p_id);
  reset role;
  return r;
end; $$;
grant execute on function pg_temp.restore_acct(text, uuid, text) to authenticated, service_role;

create or replace function pg_temp.merge_acct(p_key text, p_from uuid, p_into uuid, p_who text default 'a')
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_mcp(p_who);
  r := public.mcp_merge_account(p_key, p_from, p_into);
  reset role;
  return r;
end; $$;
grant execute on function pg_temp.merge_acct(text, uuid, uuid, text) to authenticated, service_role;

create or replace function pg_temp.undo(p_key text, p_kind text, p_id uuid, p_who text default 'a')
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_mcp(p_who);
  r := public.mcp_undo(p_key, p_kind, p_id);
  reset role;
  return r;
end; $$;
grant execute on function pg_temp.undo(text, text, uuid, text) to authenticated, service_role;

create or replace function pg_temp.bind(p_key text, p_category uuid, p_account uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_mcp('a');
  r := public.mcp_set_category_account(p_key, p_category, p_account);
  reset role;
  return r;
end; $$;
grant execute on function pg_temp.bind(text, uuid, uuid) to authenticated, service_role;

-- An account id in company A: a system or company account by name, else a category's account.
create or replace function pg_temp.acct(p_name text)
returns uuid language sql set search_path = '' as $$
  select a.id from public.accounts a
  left join public.categories c on c.id = a.category_id
  where a.company_id = pg_temp.id('co') and coalesce(c.name, a.name) = p_name
  order by a.category_id nulls first limit 1;
$$;
grant execute on function pg_temp.acct(text) to authenticated, service_role;

create or replace function pg_temp.leg(p_account uuid, p_amount bigint)
returns jsonb language sql set search_path = '' as $$
  select jsonb_build_object('account_id', p_account, 'amount_minor', p_amount, 'project_id', pg_temp.id('maple'));
$$;
grant execute on function pg_temp.leg(uuid, bigint) to authenticated, service_role;

-- What an account holds on the books (not draft legs), all projects, all dates.
create or replace function pg_temp.bal(p_id uuid)
returns bigint language sql set search_path = '' as $$
  select coalesce(sum(l.amount_minor), 0)::bigint from public.legs l where l.account_id = p_id and not l.draft;
$$;
grant execute on function pg_temp.bal(uuid) to authenticated, service_role;

-- The company's P&L as the P&L rows say it: income less expense, in the P&L.
create or replace function pg_temp.pnl()
returns bigint language sql set search_path = '' as $$
  select coalesce(sum(p.amount_net), 0)::bigint from private.pnl_lines p
  where p.company_id = pg_temp.id('co') and p.in_pnl;
$$;
grant execute on function pg_temp.pnl() to authenticated, service_role;

-- The ILS balance sheet of A as of a date (and project).
create or replace function pg_temp.sheet(p_as_of date default null, p_project uuid default null, p_who text default 'a')
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_mcp(p_who);
  r := public.mcp_balance_sheet(p_as_of, p_project);
  reset role;
  return r;
end; $$;
grant execute on function pg_temp.sheet(date, uuid, text) to authenticated, service_role;

create or replace function pg_temp.listed(p_include_archived boolean default false)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_mcp('a');
  r := public.mcp_accounts(p_include_archived);
  reset role;
  return r->'accounts';
end; $$;
grant execute on function pg_temp.listed(boolean) to authenticated, service_role;

create or replace function pg_temp.row_of(p_id uuid, p_include_archived boolean default true)
returns jsonb language sql set search_path = '' as $$
  select a from jsonb_array_elements(pg_temp.listed(p_include_archived)) a where a->>'id' = p_id::text;
$$;
grant execute on function pg_temp.row_of(uuid, boolean) to authenticated, service_role;

-- Company A (owner) and B (other), a project, categories, a line of each kind.
insert into p152 (label, id) values
  ('co', tests.fixture_company('p152_owner', 'Example Accounts 152')),
  ('co_b', tests.fixture_company('p152_other', 'Example Other 152'));
insert into p152 (label, id) values ('maple', tests.fixture_project(pg_temp.id('co'), 'Example Maple House'));
insert into p152 (label, id) values
  ('rent', tests.fixture_category(pg_temp.id('co'), 'Example rent', 'income')),
  ('repairs', tests.fixture_category(pg_temp.id('co'), 'Example repairs', 'expense')),
  ('utilities', tests.fixture_category(pg_temp.id('co'), 'Example utilities', 'expense')),
  ('depr', tests.fixture_category(pg_temp.id('co'), 'Example depreciation', 'expense')),
  ('deposits', tests.fixture_category(pg_temp.id('co'), 'Example deposits paid out', 'expense', true)),
  ('accrual', tests.fixture_category(pg_temp.id('co'), 'Example accrual', 'expense', true));

select public.store_mcp_credential(tests.get_supabase_uid('p152_owner'), 'hash-p152-write-1', array['read','write'],
  now() + interval '90 days', 'pepper-1');
select public.store_mcp_credential(tests.get_supabase_uid('p152_owner'), 'hash-p152-read-1', array['read'],
  now() + interval '90 days', 'pepper-1');
select public.store_mcp_credential(tests.get_supabase_uid('p152_other'), 'hash-p152-bwrite-1', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into p152 (label, id)
select v.label, c.id from private.mcp_credentials c
join (values ('write', 'hash-p152-write-1'), ('read', 'hash-p152-read-1'), ('bwrite', 'hash-p152-bwrite-1')) v(label, h)
  on c.token_hash = v.h;

-- A rent receipt, a repair, a split repair (repairs + utilities), a loan payment, a deposit paid out (kept out).
insert into p152 (label, id) values
  ('l_rent', tests.fixture_line(pg_temp.id('co'), 'p152:rent', 100000, 'income', pg_temp.id('maple'), pg_temp.id('rent'), '2026-03-05')),
  ('l_repair', tests.fixture_line(pg_temp.id('co'), 'p152:repair', 30000, 'expense', pg_temp.id('maple'), pg_temp.id('repairs'), '2026-03-10')),
  ('l_split', tests.fixture_line(pg_temp.id('co'), 'p152:split', 60000, 'expense', pg_temp.id('maple'), pg_temp.id('repairs'), '2026-03-12')),
  ('l_loan', tests.fixture_line(pg_temp.id('co'), 'p152:loan', 150000, 'expense', pg_temp.id('maple'),
    (select c.id from public.categories c where c.company_id = pg_temp.id('co') and c.name = 'אחר' and c.kind = 'expense'),
    '2026-03-15', p_pnl_role => null, p_doc_kind => 'expense')),
  ('l_deposit', tests.fixture_line(pg_temp.id('co'), 'p152:deposit', 190000, 'expense', pg_temp.id('maple'), pg_temp.id('deposits'), '2026-03-20'));

select tests.line_split(pg_temp.id('l_split'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.id('repairs'), 'project_id', null, 'amount_minor', 40000, 'gross_up', false),
  jsonb_build_object('category_id', pg_temp.id('utilities'), 'project_id', null, 'amount_minor', 20000, 'gross_up', false)));

insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor,
  escrow_minor, currency)
values (pg_temp.id('co'), 'Example mortgage', 12000000, 60000, 360, '2026-01-01', 150000, 10000, 'ILS');
select tests.loan_split(pg_temp.id('l_loan'), l.id, (
  select jsonb_agg(jsonb_build_object('part', v.part, 'amount_minor', v.amount, 'scheduled_minor', v.amount,
    'category_id', (select c.id from public.categories c where c.company_id = pg_temp.id('co') and c.name = v.cat and c.kind = 'expense'),
    'needs_review', false) order by v.n)
  from (values (1, 'principal', 90000, 'תשלומי הלוואה'), (2, 'interest', 50000, 'ריבית משכנתא'), (3, 'escrow', 10000, 'מסים וביטוח'))
    as v(n, part, amount, cat)))
from public.loans l where l.company_id = pg_temp.id('co');

-- 1. The system accounts.
select is((select count(*)::integer from public.accounts a where a.company_id = pg_temp.id('co') and a.is_system), 12,
  'a company has the 12 system accounts, flagged');
select is((select a.type from public.accounts a where a.company_id = pg_temp.id('co') and a.name = 'Owner capital'),
  'equity', 'Owner capital is equity');
select is((select count(*)::integer from public.accounts a where a.category_id is not null and a.is_system), 0,
  'a category''s account is no system account');

-- 2. create_account.
create temp table r152 (label text primary key, r jsonb);
grant all on r152 to authenticated, service_role;
insert into r152 values ('c1', pg_temp.create_acct('p152-c1', 'Deposits paid', 'asset', 'Deposits we paid out'));
select is((select r->>'ok' from r152 where label = 'c1'), 'true', 'create_account creates an asset account');
insert into p152 (label, id) select 'deposits_acct', (r->'data'->>'id')::uuid from r152 where label = 'c1';
select is((select r->'data'->>'undo_kind' from r152 where label = 'c1'), 'account_create', 'and says how to undo it');
select results_eq(
  $$select a.type, a.is_system, a.archived_at is null, a.description, a.excluded_from_pnl, a.category_id is null
    from public.accounts a where a.id = (select id from p152 where label = 'deposits_acct')$$,
  $$values ('asset'::text, false, true, 'Deposits we paid out'::text, true, true)$$,
  'it is a company account: asset, open, with its description');
select is(pg_temp.create_acct('p152-c1', 'Deposits paid', 'asset', 'Deposits we paid out'), (select r from r152 where label = 'c1'),
  'a replay of the same key returns the same answer');
select is((select count(*)::integer from public.accounts a where a.company_id = pg_temp.id('co') and a.name = 'Deposits paid'), 1,
  'and creates nothing more');
select is(pg_temp.create_acct('p152-c1', 'Deposits paid', 'liability')->'error'->>'code', 'conflict',
  'the same key with other arguments is a conflict');
select is(pg_temp.create_acct('p152-c2', 'Suspense', 'asset')->'error'->>'message', 'that name belongs to a system account',
  'a system name is refused');
select is(pg_temp.create_acct('p152-c3', 'property', 'asset')->'error'->>'message', 'that name belongs to a system account',
  'whatever its case');
select is(pg_temp.create_acct('p152-c4', 'DEPOSITS PAID', 'asset')->'error'->>'message', 'account already exists',
  'an existing name is refused, whatever its case');
select is(pg_temp.create_acct('p152-c5', '   ', 'asset')->'error'->>'message', 'account name is too short', 'an empty name is refused');
select is(pg_temp.create_acct('p152-c6', repeat('x', 61), 'asset')->'error'->>'message', 'account name is too long', 'a 61-letter name is refused');
select is(pg_temp.create_acct('p152-c7', 'Long text', 'asset', repeat('d', 201))->'error'->>'message', 'description is too long',
  'a 201-letter description is refused');
select is(pg_temp.create_acct('p152-c8', 'Bad type', 'income')->'error'->>'code', 'validation', 'an income account is not a company account');
select is(pg_temp.create_acct('p152-c9', 'Read only', 'asset', null, 'r')->'error'->>'code', 'forbidden', 'a read-only token cannot write');
select is((select count(*)::integer from public.accounts a where a.company_id = pg_temp.id('co') and not a.is_system and a.category_id is null),
  1, 'and none of the refusals created an account');

-- 3. update_account.
select is(pg_temp.update_acct('p152-u1', pg_temp.id('deposits_acct'), 'Deposits paid out', 'Held by others')->'data'->>'name',
  'Deposits paid out', 'update_account renames');
select is(pg_temp.row_of(pg_temp.id('deposits_acct'))->>'description', 'Held by others', 'and describes');
select is(pg_temp.update_acct('p152-u2', pg_temp.id('deposits_acct'), null, '')->'data'->>'description', null, 'an empty description clears it');
select is(pg_temp.update_acct('p152-u3', pg_temp.id('deposits_acct'), 'Deposits paid out')->'error'->>'message', 'nothing to change',
  'a change to nothing is refused');
select is(pg_temp.update_acct('p152-u4', pg_temp.id('deposits_acct'), 'Escrow')->'error'->>'message', 'that name belongs to a system account',
  'a rename into a system name is refused');
select is(pg_temp.update_acct('p152-u5', pg_temp.acct('Suspense'), 'Parked')->'error'->>'message', 'system account can''t be changed',
  'a system account can''t be renamed');
select is(pg_temp.update_acct('p152-u6', pg_temp.acct('Owner capital'), null, 'x')->'error'->>'message', 'system account can''t be changed',
  'nor described');
select is(pg_temp.update_acct('p152-u7', pg_temp.acct('Example rent'), 'Rent')->'error'->>'message', 'category account can''t be changed',
  'a category''s account is changed by the category');
select is(pg_temp.update_acct('p152-u8', pg_temp.id('deposits_acct'), null, null, null)->'error'->>'code', 'validation',
  'an update that names nothing is validation');
select is(pg_temp.update_acct('p152-u9', pg_temp.id('deposits_acct'), null, null, 'liability')->'data'->>'type', 'liability',
  'the type changes while the account has no postings');
select is(pg_temp.update_acct('p152-u10', pg_temp.id('deposits_acct'), null, null, 'asset')->'data'->>'type', 'asset', 'and back');
insert into r152 values ('c_acc', pg_temp.create_acct('p152-c10', 'Accrued costs', 'liability'));
insert into p152 (label, id) select 'accrued', (r->'data'->>'id')::uuid from r152 where label = 'c_acc';
insert into r152 values ('c_pay', pg_temp.create_acct('p152-c11', 'Other payables', 'liability', 'Where merged accruals go'));
insert into p152 (label, id) select 'payables', (r->'data'->>'id')::uuid from r152 where label = 'c_pay';
select is(pg_temp.create_acct('p152-c12', 'Founder loan', 'equity')->'data'->>'type', 'equity', 'an equity account can be created');

-- 4. The first use case: a deposits account, the deposits category bound to it, Suspense to 0, no P&L figure moves.
select is(pg_temp.bal(pg_temp.acct('Suspense')), 190000::bigint, 'the deposit paid out sits on Suspense (kept out, unbound)');
create temp table pnl152 as select pg_temp.pnl() as v;
select is(pg_temp.bind('p152-b1', pg_temp.id('deposits'), pg_temp.id('deposits_acct'))->'data'->>'posts_to_name', 'Deposits paid out',
  'set_category_account binds the deposits category to the company account');
select is(pg_temp.bal(pg_temp.acct('Suspense')), 0::bigint, 'Suspense goes to 0');
select is(pg_temp.bal(pg_temp.id('deposits_acct')), 190000::bigint, 'the deposits account holds the deposit');
select is(pg_temp.pnl(), (select v from pnl152), 'and no P&L figure moves');
select is(pg_temp.row_of(pg_temp.id('deposits_acct'))->'categories'->0->>'name', 'Example deposits paid out',
  'list_accounts shows the category linked to it');
select is(pg_temp.row_of(pg_temp.id('deposits_acct'))->'balances', '[{"currency":"ILS","balance_minor":190000}]'::jsonb,
  'and its balance per currency');
select is(pg_temp.update_acct('p152-u11', pg_temp.id('deposits_acct'), null, null, 'liability')->'error'->>'message',
  'account has postings, so its type can''t change', 'the type can''t change once the account has legs');
select is(pg_temp.bind('p152-b2', pg_temp.id('accrual'), pg_temp.acct('Owner capital'))->'data'->>'posts_to_name', 'Owner capital',
  'a kept-out category binds to the equity system account');

-- 5. list_accounts.
select is(pg_temp.row_of(pg_temp.id('deposits_acct')) - 'categories' - 'balances' - 'id',
  '{"name":"Deposits paid out","type":"asset","category_id":null,"system":false,"is_system":false,"archived":false,"description":null,
    "is_bank":false,"excluded_from_pnl":true,"loan_part":null,"hidden":false,"bookable":true,"posts_to":null}'::jsonb,
  'list_accounts: a company account''s fields');
select is(pg_temp.row_of(pg_temp.acct('Owner capital'))->>'type', 'equity', 'Owner capital is listed as equity');
select is(pg_temp.row_of(pg_temp.acct('Owner capital'))->>'is_system', 'true', 'and as a system account');
select is(pg_temp.row_of(pg_temp.acct('Suspense'))->>'bookable', 'false', 'Suspense is not bookable');
select is(pg_temp.row_of(pg_temp.acct('Example rent'))->>'is_system', 'false', 'a category''s account is no system account');
select is(pg_temp.row_of(pg_temp.acct('Bank/Clearing'))->'balances' is not null, true, 'the bank lists its balances');

create or replace function pg_temp.balances_on_books(p_account uuid)
returns bigint language sql set search_path = '' as $$
  select coalesce(sum(l.amount_minor), 0)::bigint from public.legs l
  join public.transactions t on t.id = l.transaction_id and t.removed_at is null and t.line_status = 'posted'
  where l.account_id = p_account and not l.draft;
$$;

-- 6. A journal entry on company accounts (equity and liability), booked by book_line rules for the P&L side.
create or replace function pg_temp.je(p_key text, p_legs jsonb, p_date date default '2026-03-31')
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_mcp('a');
  r := public.mcp_create_journal_entry(p_key, p_date, 'ILS', 'Example accrual entry', null, p_legs);
  reset role;
  return r;
end; $$;
grant execute on function pg_temp.je(text, jsonb, date) to authenticated, service_role;

insert into r152 values ('je1', pg_temp.je('p152-je1', jsonb_build_array(
  pg_temp.leg(pg_temp.acct('Example depreciation'), 50000), pg_temp.leg(pg_temp.id('accrued'), -50000))));
select is((select r->>'ok' from r152 where label = 'je1'), 'true', 'a journal entry credits a company liability account');
insert into p152 (label, id) select 'je1', (r->'data'->>'id')::uuid from r152 where label = 'je1';
insert into r152 values ('je2', pg_temp.je('p152-je2', jsonb_build_array(
  pg_temp.leg(pg_temp.acct('Example depreciation'), 20000), pg_temp.leg(pg_temp.acct('Owner capital'), -20000))));
select is((select r->>'ok' from r152 where label = 'je2'), 'true', 'and an equity account (Owner capital)');
insert into p152 (label, id) select 'je2', (r->'data'->>'id')::uuid from r152 where label = 'je2';
select is(pg_temp.bal(pg_temp.id('accrued')), -50000::bigint, 'the accrued costs hold the credit');

-- 7. archive_account.
select is(pg_temp.archive_acct('p152-a1', pg_temp.acct('Suspense'))->'error'->>'message', 'system account can''t be changed',
  'a system account is not archived');
select is(pg_temp.archive_acct('p152-a2', pg_temp.id('accrued'))->'error'->>'message', 'account has a balance of -500.00',
  'an account with a balance is refused, the balance in the words');
select is(pg_temp.archive_acct('p152-a3', pg_temp.id('deposits_acct'))->'error'->>'message', 'account has a balance of 1900.00',
  'the deposits account holds 1,900.00');
select is(pg_temp.archive_acct('p152-a4', pg_temp.acct('Example rent'))->'error'->>'message', 'category account can''t be changed',
  'a category''s account is not archived');
-- A zero-balance account with a category bound to it.
insert into p152 (label, id) values ('empty_cat', tests.fixture_category(pg_temp.id('co'), 'Example unused kept-out', 'expense', true));
insert into r152 values ('c_unused', pg_temp.create_acct('p152-c13', 'Unused', 'asset'));
insert into p152 (label, id) select 'unused', (r->'data'->>'id')::uuid from r152 where label = 'c_unused';
select is(pg_temp.bind('p152-b3', pg_temp.id('empty_cat'), pg_temp.id('unused'))->>'ok', 'true', 'a category is bound to an empty account');
select is(pg_temp.archive_acct('p152-a5', pg_temp.id('unused'))->'error'->>'message', 'account has linked categories',
  'a category bound to the account blocks its archiving');
select is(pg_temp.bind('p152-b4', pg_temp.id('empty_cat'), null)->>'ok', 'true', 'the binding goes');
-- A hidden '· ledger' category posting there blocks it too.
insert into p152 (label, id) values ('hid', tests.fixture_category(pg_temp.id('co'), 'Unused · ledger', 'expense', true));
update public.categories set hidden = true, ledger_account_id = pg_temp.id('unused') where id = pg_temp.id('hid');
select is(pg_temp.archive_acct('p152-a6', pg_temp.id('unused'))->'error'->>'message', 'account has linked categories',
  'so does a hidden · ledger category');
delete from public.categories where id = pg_temp.id('hid');
insert into r152 values ('arch', pg_temp.archive_acct('p152-a7', pg_temp.id('unused')));
select is((select r->>'ok' from r152 where label = 'arch'), 'true', 'an empty account with nothing bound is archived');
select is(pg_temp.archive_acct('p152-a7', pg_temp.id('unused')), (select r from r152 where label = 'arch'), 'a replay returns the same answer');
select is(pg_temp.archive_acct('p152-a8', pg_temp.id('unused'))->'error'->>'message', 'account is archived', 'an archived account is not archived again');
select isnt((select a.archived_at from public.accounts a where a.id = pg_temp.id('unused')), null, 'archived_at is set');
select is(pg_temp.row_of(pg_temp.id('unused'), false), null, 'list_accounts hides it');
select is(pg_temp.row_of(pg_temp.id('unused'), true)->>'archived', 'true', 'include_archived shows it');
select is(pg_temp.row_of(pg_temp.id('unused'), true)->>'bookable', 'false', 'and it is not bookable');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.listed()) a where a->>'id' = pg_temp.id('unused')::text), 0,
  'the default list hides it as well');
select is(pg_temp.update_acct('p152-u12', pg_temp.id('unused'), 'Renamed')->'error'->>'message', 'account is archived',
  'an archived account is not changed');
select is(pg_temp.bind('p152-b5', pg_temp.id('empty_cat'), pg_temp.id('unused'))->'error'->>'message', 'account is archived',
  'a category is not bound to an archived account');
select is(public.mcp_accounts() is not null, true, 'the old list_accounts signature still works');

-- An archived account is not bookable by book_line or a journal entry.
create or replace function pg_temp.book(p_key text, p_account uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_mcp('a');
  r := public.mcp_book_line(p_key, '2026-03-25', 'expense', 'ILS', 'Example booking', jsonb_build_array(
    jsonb_build_object('account_id', (select a.id from public.accounts a where a.company_id = pg_temp.id('co') and a.is_bank), 'amount_minor', -1000),
    jsonb_build_object('account_id', p_account, 'amount_minor', 1000, 'project_id', pg_temp.id('maple'))));
  reset role;
  return r;
end; $$;
grant execute on function pg_temp.book(text, uuid) to authenticated, service_role;
select is(pg_temp.book('p152-bk1', pg_temp.id('unused'))->'error'->>'message', 'account is archived', 'book_line refuses an archived account');
select is(pg_temp.je('p152-je3', jsonb_build_array(
  pg_temp.leg(pg_temp.acct('Example depreciation'), 100), pg_temp.leg(pg_temp.id('unused'), -100)))->'error'->>'message',
  'account is archived', 'and so does a journal entry');

-- restore_account.
select is(pg_temp.restore_acct('p152-r1', pg_temp.id('deposits_acct'))->'error'->>'message', 'account is not archived',
  'an open account is not restored');
select is(pg_temp.restore_acct('p152-r2', pg_temp.acct('Suspense'))->'error'->>'message', 'system account can''t be changed',
  'a system account is not restored');
insert into r152 values ('rest', pg_temp.restore_acct('p152-r3', pg_temp.id('unused')));
select is((select r->>'ok' from r152 where label = 'rest'), 'true', 'restore_account opens it again');
select is(pg_temp.restore_acct('p152-r3', pg_temp.id('unused')), (select r from r152 where label = 'rest'), 'a replay returns the same answer');
select is((select a.archived_at from public.accounts a where a.id = pg_temp.id('unused')), null, 'archived_at is null');
select is(pg_temp.book('p152-bk2', pg_temp.id('unused'))->>'ok', 'true', 'it is bookable again (book_line takes a company account)');
select is(pg_temp.bal(pg_temp.id('unused')), 1000::bigint, 'and holds what was booked');

-- 8. merge_account.
select is(pg_temp.merge_acct('p152-m1', pg_temp.id('accrued'), pg_temp.id('accrued'))->'error'->>'message', 'pick a different account',
  'an account is not merged into itself');
select is(pg_temp.merge_acct('p152-m2', pg_temp.acct('Escrow'), pg_temp.id('accrued'))->'error'->>'message', 'system account can''t be changed',
  'a system account is not merged away');
select is(pg_temp.merge_acct('p152-m3', pg_temp.id('accrued'), pg_temp.id('deposits_acct'))->'error'->>'message', 'accounts must be the same type',
  'a liability is not merged into an asset');
select is(pg_temp.merge_acct('p152-m4', pg_temp.id('unused'), pg_temp.acct('Suspense'))->'error'->>'message',
  'the account must be a balance-sheet account', 'nothing is merged into Suspense');
select is(pg_temp.merge_acct('p152-m5', pg_temp.id('unused'), pg_temp.acct('Example rent'))->'error'->>'message',
  'the account must be a balance-sheet account', 'nor into a category''s account');
select is(pg_temp.merge_acct('p152-m6', pg_temp.id('accrued'), pg_temp.acct('Example rent'))->'error'->>'message',
  'the account must be a balance-sheet account', 'whatever the source');
-- Accrued costs (a counter leg of a journal entry, a category bound) into Other payables.
update public.categories set ledger_account_id = pg_temp.id('accrued') where id = pg_temp.id('empty_cat');
create temp table before152 as
  select (select jsonb_agg(x order by x->>'currency') from jsonb_array_elements(pg_temp.row_of(pg_temp.id('accrued'))->'balances') x) as bal,
         pg_temp.pnl() as pnl, pg_temp.sheet('2026-12-31') as sheet;
insert into r152 values ('merge', pg_temp.merge_acct('p152-m7', pg_temp.id('accrued'), pg_temp.id('payables')));
select is((select r->>'ok' from r152 where label = 'merge'), 'true', 'merge_account merges two company accounts');
select is((select r->'data'->>'categories_moved' from r152 where label = 'merge'), '1', 'and says it moved one category');
select is((select r->'data'->>'journal_legs_moved' from r152 where label = 'merge'), '1', 'and one journal leg');
select is(pg_temp.merge_acct('p152-m7', pg_temp.id('accrued'), pg_temp.id('payables')), (select r from r152 where label = 'merge'),
  'a replay returns the same answer');
select is(pg_temp.bal(pg_temp.id('accrued')), 0::bigint, 'the source holds nothing');
select is(pg_temp.bal(pg_temp.id('payables')), -50000::bigint, 'the target holds the journal leg');
select is((select a.archived_at is not null from public.accounts a where a.id = pg_temp.id('accrued')), true, 'the source is archived');
select is((select c.ledger_account_id from public.categories c where c.id = pg_temp.id('empty_cat')), pg_temp.id('payables'),
  'the category is bound to the target');
select is(pg_temp.pnl(), (select pnl from before152), 'no P&L figure moves');
select is((select (pg_temp.sheet('2026-12-31') - 'currencies') = (sheet - 'currencies') from before152), true,
  'the balance sheet header is the same');
select is((pg_temp.sheet('2026-12-31')->'currencies'->0->>'total_assets_minor')::bigint,
  (select (sheet->'currencies'->0->>'total_assets_minor')::bigint from before152), 'and so are the assets');
select is((pg_temp.sheet('2026-12-31')->'currencies'->0->'liabilities'->>'total_minor')::bigint,
  (select (sheet->'currencies'->0->'liabilities'->>'total_minor')::bigint from before152), 'and the liabilities');
select is(pg_temp.merge_acct('p152-m8', pg_temp.id('accrued'), pg_temp.id('payables'))->'error'->>'message', 'account is archived',
  'an archived account is not merged again');

-- 9. Cross-company: B can not touch A's accounts; B's own work is the positive control.
select is(pg_temp.create_acct('p152-bc1', 'Deposits paid', 'asset', null, 'b')->>'ok', 'true',
  'positive control: B creates an account of the same name in its own books');
insert into p152 (label, id) select 'b_acct', (r->'data'->>'id')::uuid
  from (select pg_temp.create_acct('p152-bc2', 'Reserve', 'asset', null, 'b') as r) x;
select is(pg_temp.update_acct('p152-bu1', pg_temp.id('deposits_acct'), 'Hijacked', null, null, 'b')->'error'->>'message', 'The write was refused.',
  'B can not rename A''s account');
select is(pg_temp.archive_acct('p152-ba1', pg_temp.id('unused'), 'b')->'error'->>'message', 'The write was refused.', 'nor archive it');
select is(pg_temp.restore_acct('p152-br1', pg_temp.id('accrued'), 'b')->'error'->>'message', 'The write was refused.', 'nor restore it');
select is(pg_temp.merge_acct('p152-bm1', pg_temp.id('b_acct'), pg_temp.id('deposits_acct'), 'b')->'error'->>'message', 'The write was refused.',
  'nor merge B''s account into it');
select is(pg_temp.merge_acct('p152-bm2', pg_temp.id('unused'), pg_temp.id('b_acct'), 'b')->'error'->>'message', 'The write was refused.',
  'nor A''s account into B''s');
select is(pg_temp.undo('p152-bundo', 'account_merge', pg_temp.id('accrued'), 'b')->'error'->>'code', 'not_found', 'nor undo A''s merge');
select is((select a.name from public.accounts a where a.id = pg_temp.id('deposits_acct')), 'Deposits paid out', 'A''s account is unchanged');

-- 10. Undo.
-- account_merge: refused when a bound category moved since; undone otherwise.
update public.categories set ledger_account_id = pg_temp.acct('Escrow') where id = pg_temp.id('empty_cat');
select is(pg_temp.undo('p152-um1', 'account_merge', pg_temp.id('accrued'))->'error'->>'code', 'conflict',
  'a merge is not undone when a category moved since');
update public.categories set ledger_account_id = pg_temp.id('payables') where id = pg_temp.id('empty_cat');
insert into r152 values ('um', pg_temp.undo('p152-um2', 'account_merge', pg_temp.id('accrued')));
select is((select r->>'ok' from r152 where label = 'um'), 'true', 'a merge is undone while it reads as written');
select is(pg_temp.undo('p152-um2', 'account_merge', pg_temp.id('accrued')), (select r from r152 where label = 'um'), 'an undo replays');
select is(pg_temp.bal(pg_temp.id('accrued')), -50000::bigint, 'the journal leg is back on the source');
select is(pg_temp.bal(pg_temp.id('payables')), 0::bigint, 'and the target holds nothing');
select is((select c.ledger_account_id from public.categories c where c.id = pg_temp.id('empty_cat')), pg_temp.id('accrued'), 'the category is bound to the source again');
select is((select a.archived_at is null from public.accounts a where a.id = pg_temp.id('accrued')), true, 'the source is open');
select is(pg_temp.pnl(), (select pnl from before152), 'no P&L figure moved');
select is(pg_temp.undo('p152-um3', 'account_merge', pg_temp.id('accrued'))->'error'->>'code', 'not_found', 'a second undo finds nothing');

-- account_archive.
insert into r152 values ('arch2', pg_temp.archive_acct('p152-a9', pg_temp.id('unused')));
select is(pg_temp.bal(pg_temp.id('unused')), 1000::bigint, 'the unused account holds 10.00, so its archive is refused');
select is((select r->'error'->>'message' from r152 where label = 'arch2'), 'account has a balance of 10.00', 'in words');
insert into r152 values ('c_tmp', pg_temp.create_acct('p152-c14', 'Temporary', 'asset'));
insert into p152 (label, id) select 'tmp', (r->'data'->>'id')::uuid from r152 where label = 'c_tmp';
select is(pg_temp.archive_acct('p152-a10', pg_temp.id('tmp'))->>'ok', 'true', 'an empty account is archived');
select is(pg_temp.undo('p152-ua1', 'account_archive', pg_temp.id('tmp'))->>'ok', 'true', 'its archive is undone');
select is((select a.archived_at is null from public.accounts a where a.id = pg_temp.id('tmp')), true, 'it is open');
select is(pg_temp.archive_acct('p152-a11', pg_temp.id('tmp'))->>'ok', 'true', 'archived again');
update public.accounts set archived_at = null where id = pg_temp.id('tmp');
select is(pg_temp.undo('p152-ua2', 'account_archive', pg_temp.id('tmp'))->'error'->>'code', 'conflict',
  'an archive is not undone when the account was restored since');

-- account_restore.
select is(pg_temp.archive_acct('p152-a12', pg_temp.id('tmp'))->>'ok', 'true', 'archived');
select is(pg_temp.restore_acct('p152-r4', pg_temp.id('tmp'))->>'ok', 'true', 'and restored');
select is(pg_temp.undo('p152-ur1', 'account_restore', pg_temp.id('tmp'))->>'ok', 'true', 'the restore is undone');
select is((select a.archived_at is not null from public.accounts a where a.id = pg_temp.id('tmp')), true, 'the account is archived again');
select is(pg_temp.restore_acct('p152-r5', pg_temp.id('tmp'))->>'ok', 'true', 'restored again');
select is(pg_temp.book('p152-bk3', pg_temp.id('tmp'))->>'ok', 'true', 'and booked on');
select is(pg_temp.undo('p152-ur2', 'account_restore', pg_temp.id('tmp'))->'error'->>'code', 'conflict',
  'a restore is not undone when the account has a balance since');

-- account_update.
select is(pg_temp.update_acct('p152-u13', pg_temp.id('payables'), 'Other payables 2', 'new text')->>'ok', 'true', 'renamed');
select is(pg_temp.undo('p152-uu1', 'account_update', pg_temp.id('payables'))->>'ok', 'true', 'the update is undone');
select is((select a.name || '/' || a.description from public.accounts a where a.id = pg_temp.id('payables')),
  'Other payables/Where merged accruals go', 'name and description are back');
select is(pg_temp.update_acct('p152-u14', pg_temp.id('payables'), 'Other payables 3')->>'ok', 'true', 'renamed again');
update public.accounts set name = 'Changed elsewhere' where id = pg_temp.id('payables');
select is(pg_temp.undo('p152-uu2', 'account_update', pg_temp.id('payables'))->'error'->>'code', 'conflict',
  'an update is not undone when the account changed since');

-- account_create.
insert into r152 values ('c_new', pg_temp.create_acct('p152-c15', 'Short lived', 'asset'));
insert into p152 (label, id) select 'short', (r->'data'->>'id')::uuid from r152 where label = 'c_new';
select is(pg_temp.undo('p152-uc1', 'account_create', pg_temp.id('short'))->>'ok', 'true', 'a created account is undone');
select is((select count(*)::integer from public.accounts a where a.id = pg_temp.id('short')), 0, 'it is gone');
insert into r152 values ('c_used', pg_temp.create_acct('p152-c16', 'Used at once', 'asset'));
insert into p152 (label, id) select 'used', (r->'data'->>'id')::uuid from r152 where label = 'c_used';
select is(pg_temp.book('p152-bk4', pg_temp.id('used'))->>'ok', 'true', 'booked on at once');
select is(pg_temp.undo('p152-uc2', 'account_create', pg_temp.id('used'))->'error'->>'code', 'conflict',
  'a created account with legs is not undone');

-- 11. get_balance_sheet on the fixture: a bank line, a split, a loan payment, a journal entry, the deposit.
create temp table sheet152 as select pg_temp.sheet('2026-12-31') as s;
select is(jsonb_array_length((select s->'currencies' from sheet152)), 1, 'one currency');
select is((select s->'currencies'->0->>'balanced' from sheet152), 'true', 'the balance sheet balances');
select is((select (s->'currencies'->0->>'difference_minor')::bigint from sheet152), 0::bigint, 'with no difference');
select is((select (s->'currencies'->0->>'retained_earnings_minor')::bigint from sheet152), pg_temp.pnl(),
  'retained earnings equal the P&L');
select is((select (s->'currencies'->0->>'total_assets_minor')::bigint from sheet152),
  (select (s->'currencies'->0->>'total_liabilities_and_equity_minor')::bigint from sheet152), 'assets equal liabilities, equity and retained earnings');
select is((select a->>'balance_minor' from sheet152, jsonb_array_elements(s->'currencies'->0->'assets'->'accounts') a where a->>'name' = 'Deposits paid out'),
  '190000', 'the deposits account is an asset');
select is((select a->>'balance_minor' from sheet152, jsonb_array_elements(s->'currencies'->0->'liabilities'->'accounts') a where a->>'name' = 'Loan principal'),
  '-90000', 'the loan principal paid down shows as a debit (negative liability)');
select is((select a->>'balance_minor' from sheet152, jsonb_array_elements(s->'currencies'->0->'equity'->'accounts') a where a->>'name' = 'Owner capital'),
  '20000', 'Owner capital is in equity, credit positive');
select is((select a->>'balance_minor' from sheet152, jsonb_array_elements(s->'currencies'->0->'assets'->'accounts') a where a->>'name' = 'Bank/Clearing'),
  '-333000', 'the bank is an asset: 1,000.00 in; 300.00, 600.00, 1,500.00, 1,900.00 and three bookings of 10.00 out');
select is((select s->'currencies'->0->'warnings' from sheet152), '[]'::jsonb, 'no warnings once Suspense is empty');
select is((pg_temp.sheet('2026-03-14')->'currencies'->0->>'retained_earnings_minor')::bigint, 100000 - 30000 - 60000::bigint,
  'as of a date: the P&L up to then');
select is(pg_temp.sheet('2026-03-14')->'currencies'->0->>'balanced', 'true', 'and it balances');
select is(pg_temp.sheet('2026-01-01')->'currencies', '[]'::jsonb, 'before the first line there is nothing');
select is(pg_temp.sheet(null)->>'as_of', current_date::text, 'a null date is today');
select is(pg_temp.sheet('2026-12-31', pg_temp.id('maple'))->>'project_name', 'Example Maple House', 'one project');
select is((pg_temp.sheet('2026-12-31', pg_temp.id('maple'))->'currencies'->0->>'retained_earnings_minor')::bigint, pg_temp.pnl(),
  'its retained earnings are the P&L of its lines');
select throws_ok($$select pg_temp.sheet('2026-12-31', gen_random_uuid())$$, 'P0002', 'project not found', 'an unknown project is an error');
select is(pg_temp.sheet('2026-12-31', null, 'b')->'currencies', '[]'::jsonb, 'company B sees none of A''s books');

-- Warnings: an unbound kept-out line on Suspense.
insert into p152 (label, id) values ('l_susp', tests.fixture_line(pg_temp.id('co'), 'p152:susp', 12300, 'expense', pg_temp.id('maple'),
  tests.fixture_category(pg_temp.id('co'), 'Example unbound kept-out', 'expense', true), '2026-03-22'));
select is((select w->>'code' from jsonb_array_elements(pg_temp.sheet('2026-12-31')->'currencies'->0->'warnings') w), 'suspense',
  'Suspense not at zero is a warning');
select is((select (w->>'balance_minor')::bigint from jsonb_array_elements(pg_temp.sheet('2026-12-31')->'currencies'->0->'warnings') w), 12300::bigint,
  'with its balance');
select is(pg_temp.sheet('2026-12-31')->'currencies'->0->>'balanced', 'true', 'and the sheet still balances');

-- A removed journal entry comes back with its legs when it is restored: its account can't be archived.
insert into public.accounts (company_id, name, type) values (pg_temp.id('co'), 'Example holding', 'asset');
insert into r152 values ('je_hold', pg_temp.je('p152-je-hold', jsonb_build_array(
  pg_temp.leg(pg_temp.acct('Example depreciation'), 7000), pg_temp.leg(pg_temp.acct('Example holding'), -7000))));
update public.transactions set removed_at = now()
where id = (select (r->'data'->>'id')::uuid from r152 where label = 'je_hold');
select is(pg_temp.balances_on_books(pg_temp.acct('Example holding')), 0::bigint, 'a removed entry leaves no balance on the account');
select is(pg_temp.archive_acct('p152-a-hold', pg_temp.acct('Example holding'))->'error'->>'message',
  'account has journal entries that are not posted', 'but the account can''t be archived while the entry can come back');

-- get_account_balances: company accounts and equity, no draft legs.
create or replace function pg_temp.balances(p_account uuid)
returns bigint language plpgsql set search_path = '' as $$
declare r bigint;
begin
  perform pg_temp.as_mcp('a');
  select coalesce(sum((b->>'balance_minor')::bigint), 0) into r
  from jsonb_array_elements(public.mcp_account_balances('2026-12-31')->'balances') b where b->>'account_id' = p_account::text;
  reset role;
  return r;
end; $$;
grant execute on function pg_temp.balances(uuid) to authenticated, service_role;
select is(pg_temp.balances(pg_temp.id('deposits_acct')), 190000::bigint, 'get_account_balances lists a company account');
select is(pg_temp.balances(pg_temp.acct('Owner capital')), -20000::bigint, 'and the equity account');

-- Draft legs are not on the books: a split that no longer matches its line leaves no figure.
update public.transactions set amount_gross = -61000, amount_net = -61000, amount_original = 61000 where id = pg_temp.id('l_split');
select is((select count(*)::integer from public.legs where transaction_id = pg_temp.id('l_split') and draft), 2, 'the mismatched split is kept as draft legs');
select is(pg_temp.sheet('2026-12-31')->'currencies'->0->>'balanced', 'true', 'and the balance sheet balances without them');

-- FLOW-154: a booking holds every leg's account in id order before it reads any, as merge_account
-- takes its two, so a booking and a merge on the same accounts never wait on each other in a circle.
select ok(
  pg_get_functiondef('private.book_line_core(uuid,text,date,text,text,jsonb,uuid,uuid)'::regprocedure) ~ 'kept_out_account\(cid, n\.category_id, null\)[^;]*order by a\.id\s+for share;'
  and strpos(pg_get_functiondef('private.book_line_core(uuid,text,date,text,text,jsonb,uuid,uuid)'::regprocedure), 'order by a.id')
    between 1 and strpos(pg_get_functiondef('private.book_line_core(uuid,text,date,text,text,jsonb,uuid,uuid)'::regprocedure), 'select * into acct from public.accounts a'),
  'book_line holds the legs'' accounts and their kept-out targets for share, in id order, before the per-leg reads');
select ok(
  pg_get_functiondef('private.post_journal_entry(uuid,date,text,text,text,jsonb)'::regprocedure) ~ 'kept_out_account\(cid, n\.category_id, null\)[^;]*order by a\.id\s+for share;'
  and strpos(pg_get_functiondef('private.post_journal_entry(uuid,date,text,text,text,jsonb)'::regprocedure), 'order by a.id')
    between 1 and strpos(pg_get_functiondef('private.post_journal_entry(uuid,date,text,text,text,jsonb)'::regprocedure), 'select * into acct from public.accounts a'),
  -- FLOW-155: create_journal_entry and the prepaid posting book through this core.
  'post_journal_entry (create_journal_entry''s core) holds the legs'' accounts and their kept-out targets for share, in id order, before the per-leg reads');

select * from finish();
rollback;
