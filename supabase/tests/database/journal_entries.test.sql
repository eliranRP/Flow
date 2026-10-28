-- FLOW-149 (decision 0228): journal entries that move no money. A property's depreciation is a
-- debit to a depreciation expense and a credit to Accumulated depreciation, per project. It counts in
-- the P&L of its project and month, moves no cash figure, has no bank leg, cannot be edited, and undoes.
-- get_account_balances sums the balance-sheet legs per project with each project's net book value.
-- Fixed dates. @example.com only.

begin;

select plan(54);

do $users$
begin
  perform tests.create_supabase_user('f149_owner', 'owner149@example.com');
  perform tests.create_supabase_user('f149_other', 'other149@example.com');
end
$users$;

create temp table f149 (label text primary key, id uuid);
grant all on f149 to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
set search_path = ''
as $$
  select id from pg_temp.f149 where label = p_label;
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
  uid := tests.get_supabase_uid('f149_owner');
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

-- An account id by its system name, or by its category's name.
create or replace function pg_temp.acct(p_name text)
returns uuid
language sql
set search_path = ''
as $$
  select a.id from public.accounts a
  left join public.categories c on c.id = a.category_id
  where a.company_id = pg_temp.id('company') and coalesce(c.name, a.name) = p_name
  order by a.category_id nulls first
  limit 1;
$$;
grant execute on function pg_temp.acct(text) to authenticated, service_role;

create or replace function pg_temp.leg(p_account text, p_amount bigint, p_project text default null)
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_build_object('account_id', pg_temp.acct(p_account), 'amount_minor', p_amount)
    || case when p_project is null then '{}'::jsonb else jsonb_build_object('project_id', pg_temp.id(p_project)) end;
$$;
grant execute on function pg_temp.leg(text, bigint, text) to authenticated, service_role;

create or replace function pg_temp.je(p_key text, p_date date, p_legs jsonb, p_reference text default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_create_journal_entry(p_key, p_date, 'ILS', 'Example depreciation', p_reference, p_legs);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.je(text, date, jsonb, text) to authenticated, service_role;

create or replace function pg_temp.undo(p_key text, p_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_undo(p_key, 'journal_entry', p_id);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.undo(text, uuid) to authenticated, service_role;

create or replace function pg_temp.balances(p_as_of date)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_account_balances(p_as_of);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.balances(date) to authenticated, service_role;

-- The P&L of a project for December 2025, from the posting rules every reader goes through.
create or replace function pg_temp.pnl(p_project text)
returns bigint
language sql
set search_path = ''
as $$
  select coalesce(sum(l.amount_net), 0)::bigint
  from private.pnl_lines l
  join public.transactions t on t.id = l.transaction_id
  where l.company_id = pg_temp.id('company') and l.in_pnl and l.project_id = pg_temp.id(p_project)
    and t.removed_at is null and t.doc_date between '2025-12-01' and '2025-12-31';
$$;
grant execute on function pg_temp.pnl(text) to authenticated, service_role;

select tests.authenticate_as('f149_owner');
select public.create_company('Example Rentals Co', true);
reset role;
insert into f149 (label, id) select 'company', id from public.companies where name = 'Example Rentals Co';
select tests.authenticate_as('f149_other');
select public.create_company('Example Other Co', true);
reset role;
insert into f149 (label, id) select 'other_company', id from public.companies where name = 'Example Other Co';

insert into public.projects (company_id, name, status)
values (pg_temp.id('company'), 'Example Maple House', 'active'), (pg_temp.id('company'), 'Example Oak Duplex', 'active');
insert into f149 (label, id) select 'maple', id from public.projects where name = 'Example Maple House';
insert into f149 (label, id) select 'oak', id from public.projects where name = 'Example Oak Duplex';

-- Depreciation in the P&L, a second depreciation category, and a kept-out purchase category on Property.
insert into public.categories (company_id, name, kind, sort_order)
values
  (pg_temp.id('company'), 'Example depreciation', 'expense', 900),
  (pg_temp.id('company'), 'Example furniture depreciation', 'expense', 901),
  (pg_temp.id('company'), 'Example purchase', 'expense', 902);
update public.categories
set excluded_from_pnl = true,
    ledger_account_id = (select a.id from public.accounts a
                         where a.company_id = pg_temp.id('company') and a.category_id is null and a.name = 'Property')
where company_id = pg_temp.id('company') and name = 'Example purchase';

select public.store_mcp_credential(
  tests.get_supabase_uid('f149_owner'), 'hash-f149-write-1', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into f149 (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-f149-write-1';

-- The house was bought for 300,000.00 in 2025 (a bank line under the kept-out purchase category).
insert into public.transactions (
  company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original, vat_amount,
  vat_status, doc_date, cash_date, currency, source, idempotency_key, description, category_id, project_id,
  pnl_role, user_assigned
)
values (pg_temp.id('company'), 'expense', 'other', 'posted', -30000000, -30000000, 30000000, 0, 'unknown',
  '2025-03-01', '2025-03-01', 'ILS', 'manual', 'f149:purchase', 'Example purchase wire',
  (select id from public.categories where company_id = pg_temp.id('company') and name = 'Example purchase'),
  pg_temp.id('maple'), 'project', true);

-- Accumulated depreciation is a bookable asset account in every company.
select is(
  (select a.type from public.accounts a
   where a.company_id = pg_temp.id('company') and a.category_id is null and a.name = 'Accumulated depreciation'),
  'asset',
  'every company has an Accumulated depreciation asset account'
);
select pg_temp.as_mcp();
select is(
  (select (a->>'bookable')::boolean from jsonb_array_elements(public.mcp_accounts()->'accounts') a
   where a->>'name' = 'Accumulated depreciation'),
  true,
  'list_accounts shows it as bookable'
);
reset role;

-- The year's depreciation for the house: debit the expense, credit Accumulated depreciation.
insert into f149 (label, id)
select 'je_maple', (pg_temp.je('f149-maple', '2025-12-31', jsonb_build_array(
  pg_temp.leg('Example depreciation', 560900, 'maple'),
  pg_temp.leg('Accumulated depreciation', -560900, 'maple')
), 'Example JE 1')->'data'->>'id')::uuid;
select isnt(pg_temp.id('je_maple'), null, 'create_journal_entry books the entry');
select is(
  pg_temp.je('f149-maple', '2025-12-31', jsonb_build_array(
    pg_temp.leg('Example depreciation', 560900, 'maple'),
    pg_temp.leg('Accumulated depreciation', -560900, 'maple')
  ), 'Example JE 1')->'data'->>'id',
  pg_temp.id('je_maple')::text,
  'a replay with the same key returns the same entry'
);

-- Its legs: the expense and Accumulated depreciation, no bank leg, balanced.
select is(
  (select jsonb_agg(jsonb_build_object('kind', l.leg_kind, 'account', a.name, 'amount', l.amount_minor) order by l.ordinal)
   from public.legs l join public.accounts a on a.id = l.account_id
   where l.transaction_id = pg_temp.id('je_maple')),
  '[{"kind": "item", "account": "Example depreciation", "amount": 560900},
    {"kind": "journal", "account": "Accumulated depreciation", "amount": -560900}]'::jsonb,
  'the entry''s legs are the expense and Accumulated depreciation'
);
select is(
  (select count(*)::integer from public.legs l join public.accounts a on a.id = l.account_id
   where l.transaction_id = pg_temp.id('je_maple') and a.is_bank),
  0,
  'it has no bank leg'
);
select pg_temp.as_mcp();
select is(
  (public.mcp_line_legs(pg_temp.id('je_maple'))->>'balanced')::boolean,
  true,
  'get_line_legs reads it balanced'
);
select is(
  public.mcp_line_legs(pg_temp.id('je_maple'))->'journal_entry'->>'reference',
  'Example JE 1',
  'get_line_legs names the reference'
);
select is(
  public.get_transaction(pg_temp.id('je_maple'))->'journal_entry'->>'reference',
  'Example JE 1',
  'get_expense (get_transaction) names it a journal entry'
);
select is(
  public.get_transaction(pg_temp.id('bogus')),
  null,
  'an unknown line still reads null'
);
reset role;

-- The P&L of the house moves by the depreciation in December 2025; the duplex's does not.
select is(pg_temp.pnl('maple'), -560900::bigint, 'the house''s December P&L takes the depreciation');
select is(pg_temp.pnl('oak'), 0::bigint, 'the duplex''s P&L does not move');
-- company_pnl is the service role's (the dashboard reads it through its own definers).
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select is(
  (public.company_pnl(pg_temp.id('company'), '2025-12-01', '2025-12-31', 'cash')->>'net_profit_agorot')::bigint,
  -560900::bigint,
  'the company P&L counts it on the cash basis'
);
select is(
  (public.company_pnl(pg_temp.id('company'), '2025-12-01', '2025-12-31', 'invoiced')->>'net_profit_agorot')::bigint,
  -560900::bigint,
  'and on the invoiced basis'
);
select set_config('request.jwt.claims', '', true);

-- No cash figure moves: the line is out of the cash view, and nothing waits for review.
select is(
  (select count(*)::integer from private.cash_parts(pg_temp.id('company'), 'cash', '2025-01-01', '2025-12-31') p
   where p.transaction_id = pg_temp.id('je_maple') and p.in_cash),
  0,
  'the entry is in no cash figure'
);
select is(
  (select t.in_cash_override from public.transactions t where t.id = pg_temp.id('je_maple')),
  false,
  'the line is kept out of the cash view'
);
select is(
  (select count(*)::integer from public.review_queue q where q.transaction_id = pg_temp.id('je_maple')),
  0,
  'it never waits for review'
);
select is(
  (select t.doc_kind::text from public.transactions t where t.id = pg_temp.id('je_maple')),
  'other',
  'it is not a receipt, so it never pairs with an invoice'
);

-- Every line's legs on the books balance (decision 0232: the legs are the only booking store).
select is(
  (select count(*)::integer from (
     select l.transaction_id from public.legs l
     where l.company_id = pg_temp.id('company') and not l.draft
     group by l.transaction_id having sum(l.amount_minor) <> 0) x),
  0,
  'every line''s legs balance'
);

-- Balances: Accumulated depreciation per project, and the house's net book value.
select is(
  (select (b->>'balance_minor')::bigint from jsonb_array_elements(pg_temp.balances('2025-12-31')->'balances') b
   where b->>'account_name' = 'Accumulated depreciation' and b->>'project_id' = pg_temp.id('maple')::text),
  -560900::bigint,
  'get_account_balances shows the house''s accumulated depreciation'
);
select is(
  (select jsonb_build_object('p', v->'property_minor', 'a', v->'accumulated_depreciation_minor', 'n', v->'net_book_value_minor')
   from jsonb_array_elements(pg_temp.balances('2025-12-31')->'book_value') v
   where v->>'project_id' = pg_temp.id('maple')::text),
  '{"p": 30000000, "a": -560900, "n": 29439100}'::jsonb,
  'and its net book value: the price less the depreciation'
);
select is(
  (select v->'accumulated_depreciation_minor' from jsonb_array_elements(pg_temp.balances('2025-12-30')->'book_value') v
   where v->>'project_id' = pg_temp.id('maple')::text),
  '0'::jsonb,
  'as of the day before, there is no depreciation yet'
);

-- The duplex's entry has two expense legs (a split) and one credit.
insert into f149 (label, id)
select 'je_oak', (pg_temp.je('f149-oak', '2025-12-31', jsonb_build_array(
  pg_temp.leg('Example depreciation', 621900, 'oak'),
  pg_temp.leg('Example furniture depreciation', 26100, 'oak'),
  pg_temp.leg('Accumulated depreciation', -648000, 'oak')
), 'Example JE 2')->'data'->>'id')::uuid;
select is(pg_temp.pnl('oak'), -648000::bigint, 'a split entry counts each expense leg in the duplex''s P&L');
select is(
  (select count(*)::integer from private.split_parts s where s.transaction_id = pg_temp.id('je_oak') and not s.draft),
  2,
  'its two expense legs are two split parts'
);

-- It is fixed: no edit of what posts it, while its description stays editable.
select throws_ok(
  $$ update public.transactions set category_id = null where id = pg_temp.id('je_maple') $$,
  '23514', 'journal entry is fixed', 'its category cannot change'
);
select throws_ok(
  $$ update public.transactions set in_cash_override = null where id = pg_temp.id('je_maple') $$,
  '23514', 'journal entry is fixed', 'it cannot come into the cash view'
);
select throws_ok(
  $$ select tests.line_split(pg_temp.id('je_oak'), (
       select jsonb_agg(jsonb_build_object('category_id', s.category_id, 'project_id', s.project_id,
         'amount_minor', s.amount_minor + 1, 'gross_up', s.gross_up) order by s.ordinal)
       from private.split_parts s where s.transaction_id = pg_temp.id('je_oak'))) $$,
  '23514', 'journal entry is fixed', 'its split cannot change'
);
select lives_ok(
  $$ update public.transactions set description = 'Example depreciation, 2025' where id = pg_temp.id('je_maple') $$,
  'its description can change'
);
select pg_temp.as_mcp();
select is(
  public.mcp_set_line_cash('f149-cash', pg_temp.id('je_maple'), true)->'error'->>'message',
  'journal entry is fixed',
  'set_line_cash is refused in words'
);
reset role;

-- Refusals.
select is(
  pg_temp.je('f149-bank', '2025-12-31', jsonb_build_array(
    pg_temp.leg('Example depreciation', 1000, 'maple'), pg_temp.leg('Bank/Clearing', -1000)))->'error'->>'message',
  'a journal entry has no bank leg',
  'a bank leg is refused'
);
select is(
  pg_temp.je('f149-unbalanced', '2025-12-31', jsonb_build_array(
    pg_temp.leg('Example depreciation', 1000, 'maple'), pg_temp.leg('Accumulated depreciation', -900, 'maple')))->'error'->>'message',
  'legs do not balance',
  'legs that do not balance are refused'
);
select is(
  pg_temp.je('f149-zero', '2025-12-31', jsonb_build_array(
    pg_temp.leg('Example depreciation', 1000, 'maple'), pg_temp.leg('Example depreciation', -1000, 'oak')))->'error'->>'message',
  'a journal entry must change the P&L',
  'an entry whose P&L legs net to zero is refused'
);
select is(
  pg_temp.je('f149-suspense', '2025-12-31', jsonb_build_array(
    pg_temp.leg('Example depreciation', 1000, 'maple'), pg_temp.leg('Suspense', -1000)))->'error'->>'message',
  'a journal entry takes category and balance-sheet accounts',
  'Suspense is refused'
);
select is(
  pg_temp.je('f149-other-account', '2025-12-31', jsonb_build_array(
    pg_temp.leg('Example depreciation', 1000, 'maple'),
    jsonb_build_object('account_id', (select a.id from public.accounts a
      where a.company_id = pg_temp.id('other_company') and a.name = 'Accumulated depreciation'), 'amount_minor', -1000)))->'error'->>'message',
  'The write was refused.',
  'another company''s account stays generic (no existence leak)'
);
select is(
  pg_temp.je('f149-shape', '2025-12-31', jsonb_build_array(
    pg_temp.leg('Example depreciation', 1000, 'maple') || '{"currency": "ILS"}',
    pg_temp.leg('Accumulated depreciation', -1000, 'maple')))->'error'->>'code',
  'validation',
  'an unknown key on a leg is a validation error'
);
select is(
  (select count(*)::integer from public.journal_entries where company_id = pg_temp.id('company')),
  2,
  'a refused entry writes nothing'
);

-- FLOW-152: an entry on balance-sheet accounts only (a reclass of the house's cost) is booked. Its line
-- moves nothing: it is in no P&L and no cash figure, its legs balance, and it undoes.
insert into f149 (label, id)
select 'je_sheet', (pg_temp.je('f149-sheet-only', '2025-12-31', jsonb_build_array(
  pg_temp.leg('Property', 100000, 'maple'), pg_temp.leg('Owner capital', -100000, 'maple')), 'Example JE 3')->'data'->>'id')::uuid;
select isnt(pg_temp.id('je_sheet'), null, 'an entry with no P&L leg is booked');
select is(
  (select jsonb_agg(jsonb_build_object('kind', l.leg_kind, 'account', a.name, 'amount', l.amount_minor) order by l.ordinal)
   from public.legs l join public.accounts a on a.id = l.account_id
   where l.transaction_id = pg_temp.id('je_sheet') and l.amount_minor <> 0),
  '[{"kind": "journal", "account": "Property", "amount": 100000},
    {"kind": "journal", "account": "Owner capital", "amount": -100000}]'::jsonb,
  'its legs are the two balance-sheet legs'
);
select is(
  (select count(*)::integer from private.pnl_lines p
   where p.transaction_id = pg_temp.id('je_sheet') and (p.in_pnl or p.amount_net <> 0)),
  0,
  'it is in no P&L figure'
);
select is(pg_temp.pnl('maple'), -560900::bigint, 'the house''s P&L does not move');
select is(
  (select count(*)::integer from private.cash_parts(pg_temp.id('company'), 'cash', '2025-01-01', '2025-12-31') p
   where p.transaction_id = pg_temp.id('je_sheet') and p.in_cash),
  0,
  'and in no cash figure'
);
select pg_temp.as_mcp();
select is(
  (public.mcp_line_legs(pg_temp.id('je_sheet'))->>'balanced')::boolean,
  true,
  'get_line_legs reads it balanced'
);
reset role;
select is(
  (select (b->>'balance_minor')::bigint from jsonb_array_elements(pg_temp.balances('2025-12-31')->'balances') b
   where b->>'account_name' = 'Owner capital' and b->>'project_id' = pg_temp.id('maple')::text),
  -100000::bigint,
  'get_account_balances shows the credit to Owner capital'
);

-- The person's own balance-sheet account takes a leg; once archived it is refused.
insert into public.accounts (company_id, name, type)
values (pg_temp.id('company'), 'Example equipment', 'asset');
select is(
  pg_temp.je('f149-own-account', '2025-12-31', jsonb_build_array(
    pg_temp.leg('Example equipment', 2500, 'oak'), pg_temp.leg('Owner capital', -2500, 'oak')))->>'ok',
  'true',
  'a user account takes a journal leg'
);
update public.accounts set archived_at = now()
where company_id = pg_temp.id('company') and name = 'Example equipment';
select is(
  pg_temp.je('f149-archived', '2025-12-31', jsonb_build_array(
    pg_temp.leg('Example equipment', 2500, 'oak'), pg_temp.leg('Owner capital', -2500, 'oak')))->'error'->>'message',
  'account is archived',
  'an archived account is refused'
);

select is(pg_temp.undo('f149-undo-sheet', pg_temp.id('je_sheet'))->>'ok', 'true', 'undo of the balance-sheet entry succeeds');
select is(
  (select count(*)::integer from public.legs where transaction_id = pg_temp.id('je_sheet')),
  0,
  'its line and legs are gone'
);

-- Undo removes the entry while it reads as written; a second undo finds nothing.
select is(pg_temp.undo('f149-undo', pg_temp.id('je_maple'))->>'ok', 'true', 'undo of journal_entry succeeds');
select is(
  (select count(*)::integer from public.transactions where id = pg_temp.id('je_maple')),
  0,
  'the line is gone'
);
select is(
  (select count(*)::integer from public.legs where transaction_id = pg_temp.id('je_maple')),
  0,
  'its legs went with it'
);
select is(pg_temp.pnl('maple'), 0::bigint, 'the house''s P&L is back');
select is(
  (select v->'accumulated_depreciation_minor' from jsonb_array_elements(pg_temp.balances('2025-12-31')->'book_value') v
   where v->>'project_id' = pg_temp.id('maple')::text),
  '0'::jsonb,
  'and its accumulated depreciation'
);
select is(pg_temp.undo('f149-undo-2', pg_temp.id('je_maple'))->'error'->>'code', 'not_found', 'a second undo finds nothing');

-- A category of the entry cannot be deleted while the entry stands (its lines would move).
select tests.authenticate_as('f149_owner');
select throws_ok(
  $$ select public.delete_category((select id from public.categories
       where company_id = pg_temp.id('company') and name = 'Example furniture depreciation')) $$,
  null,
  'journal entry is fixed',
  'a category the entry uses cannot be deleted'
);
reset role;

select * from finish();

rollback;
