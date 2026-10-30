-- FLOW-174 (decision 0234): correct a posted journal entry in place. update_journal_entry re-books the
-- entry under its own id with create_journal_entry's rules, saves the version it replaced, and undoes
-- while the entry reads as it left it. The P&L moves by the difference of the P&L legs only, the
-- balance-sheet balances follow, and the entry stays out of every cash view. Refused: a stale version,
-- a line that is not a journal entry, the books-closed date, a viewer and another company's entry.
-- Fixed dates. Invented data only.

begin;

select plan(58);

do $users$
begin
  perform tests.create_supabase_user('je174_owner', 'owner174@example.com');
  perform tests.create_supabase_user('je174_editor', 'editor174@example.com');
  perform tests.create_supabase_user('je174_viewer', 'viewer174@example.com');
  perform tests.create_supabase_user('je174_other', 'other174@example.com');
end
$users$;

create temp table je (label text primary key, id uuid);
grant all on je to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid language sql set search_path = '' as $$ select id from pg_temp.je where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- Act as a holder of a flow-mcp credential: a = A's owner, e = A's editor, v = A's viewer, b = B's owner.
create or replace function pg_temp.as_mcp(p_who text)
returns void language plpgsql set search_path = '' as $$
declare
  uid uuid := tests.get_supabase_uid(case p_who when 'b' then 'je174_other' when 'e' then 'je174_editor'
    when 'v' then 'je174_viewer' else 'je174_owner' end);
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1',
    'mcp_tid', pg_temp.id('tok_' || p_who))::text, true);
end; $$;

-- One call as p_who.
create or replace function pg_temp.mcp(p_who text, p_sql text)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_mcp(p_who);
  execute p_sql into r;
  reset role;
  return r;
end; $$;

-- An account of company A by its system name or its category's name.
create or replace function pg_temp.acct(p_name text)
returns uuid language sql set search_path = '' as $$
  select a.id from public.accounts a
  left join public.categories c on c.id = a.category_id
  where a.company_id = pg_temp.id('co') and coalesce(c.name, a.name) = p_name
  order by a.category_id nulls first
  limit 1;
$$;

create or replace function pg_temp.leg(p_account text, p_amount bigint, p_project text default null)
returns jsonb language sql set search_path = '' as $$
  select jsonb_build_object('account_id', pg_temp.acct(p_account), 'amount_minor', p_amount,
    'project_id', pg_temp.id(p_project));
$$;

-- update_journal_entry as p_who.
create or replace function pg_temp.upd(
  p_who text, p_key text, p_id uuid, p_version text, p_reason text,
  p_date date default null, p_description text default null, p_set_reference boolean default false,
  p_reference text default null, p_legs jsonb default null)
returns jsonb language sql set search_path = '' as $$
  select pg_temp.mcp(p_who, format(
    'select public.mcp_update_journal_entry(%L, %L::uuid, %L, %L, %L::date, %L, %L::boolean, %L, %L::jsonb)',
    p_key, p_id, p_version, p_reason, p_date, p_description, p_set_reference, p_reference, p_legs));
$$;

create or replace function pg_temp.undo(p_who text, p_key text, p_kind text, p_id uuid)
returns jsonb language sql set search_path = '' as $$
  select pg_temp.mcp(p_who, format('select public.mcp_undo(%L, %L, %L::uuid)', p_key, p_kind, p_id));
$$;

-- The P&L of a project in December 2025, from the posting rules every reader goes through.
create or replace function pg_temp.pnl(p_project text)
returns bigint language sql set search_path = '' as $$
  select coalesce(sum(l.amount_net), 0)::bigint
  from private.pnl_lines l
  join public.transactions t on t.id = l.transaction_id
  where l.company_id = pg_temp.id('co') and l.in_pnl and l.project_id is not distinct from pg_temp.id(p_project)
    and t.removed_at is null and t.doc_date between '2025-12-01' and '2025-12-31';
$$;

-- A balance-sheet account's balance per project as get_account_balances gives it (0 when absent).
create or replace function pg_temp.bal(p_account text, p_project text)
returns bigint language sql set search_path = '' as $$
  select coalesce((
    select sum((b->>'balance_minor')::bigint)
    from jsonb_array_elements(pg_temp.mcp('a', 'select public.mcp_account_balances(''2026-12-31''::date)')->'balances') b
    where b->>'account_name' = p_account and b->>'project_id' is not distinct from pg_temp.id(p_project)::text
  ), 0)::bigint;
$$;

-- The entry's legs on the books, by account and project label.
create or replace function pg_temp.legs_of(p_id uuid)
returns jsonb language sql set search_path = '' as $$
  select jsonb_agg(jsonb_build_object('account', coalesce(c.name, a.name), 'project', p.label, 'amount', l.amount_minor)
    order by coalesce(c.name, a.name), p.label, l.amount_minor)
  from public.legs l
  join public.accounts a on a.id = l.account_id
  left join public.categories c on c.id = a.category_id
  left join pg_temp.je p on p.id = l.project_id and p.label in ('maple', 'oak')
  where l.transaction_id = p_id and not l.draft;
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- Company A (owner, an editor, a viewer) and B; two projects; three categories, one kept out.
insert into je (label, id) values
  ('co', tests.fixture_company('je174_owner', 'Example Holdings 174')),
  ('co_b', tests.fixture_company('je174_other', 'Example Other 174'));
insert into public.company_members (company_id, user_id, role) values
  (pg_temp.id('co'), tests.get_supabase_uid('je174_editor'), 'editor'),
  (pg_temp.id('co'), tests.get_supabase_uid('je174_viewer'), 'viewer');
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values
  (tests.get_supabase_uid('je174_owner'), pg_temp.id('co'), 'hash-je174-owner-01', 'pepper-1', array['read', 'write'], now() + interval '90 days'),
  (tests.get_supabase_uid('je174_editor'), pg_temp.id('co'), 'hash-je174-editor-1', 'pepper-1', array['read', 'write'], now() + interval '90 days'),
  (tests.get_supabase_uid('je174_viewer'), pg_temp.id('co'), 'hash-je174-viewer-1', 'pepper-1', array['read', 'write'], now() + interval '90 days'),
  (tests.get_supabase_uid('je174_other'), pg_temp.id('co_b'), 'hash-je174-other-01', 'pepper-1', array['read', 'write'], now() + interval '90 days');
insert into je (label, id)
select 'tok_' || v.who, c.id from private.mcp_credentials c
join (values ('a', 'hash-je174-owner-01'), ('e', 'hash-je174-editor-1'), ('v', 'hash-je174-viewer-1'), ('b', 'hash-je174-other-01')) v(who, h)
  on c.token_hash = v.h;

insert into je (label, id) values
  ('maple', tests.fixture_project(pg_temp.id('co'), 'Example Maple house')),
  ('oak', tests.fixture_project(pg_temp.id('co'), 'Example Oak duplex'));
insert into je (label, id) values
  ('dep', tests.fixture_category(pg_temp.id('co'), 'Example depreciation', 'expense')),
  ('furniture', tests.fixture_category(pg_temp.id('co'), 'Example furniture', 'expense')),
  ('b_dep', tests.fixture_category(pg_temp.id('co_b'), 'Example other depreciation', 'expense'));
insert into je (label, id) values
  ('bank_line', tests.fixture_line(pg_temp.id('co'), 'je174:bank', 40000, 'expense', pg_temp.id('maple'), pg_temp.id('dep'), '2025-11-10'));

-- Version 1: depreciation, an owner-capital plug and a Property credit with no project.
insert into je (label, id)
select 'entry', (pg_temp.mcp('a', format('select public.mcp_create_journal_entry(%L, %L::date, %L, %L, %L, %L::jsonb)',
  'je174-create', '2025-12-31', 'ILS', 'Example year-end entry', 'Example JE 7', jsonb_build_array(
    pg_temp.leg('Example depreciation', 500000, 'maple'),
    pg_temp.leg('Owner capital', 10000),
    pg_temp.leg('Accumulated depreciation', -490000, 'maple'),
    pg_temp.leg('Property', -20000)
  )))->'data'->>'id')::uuid;
insert into je (label, id)
select 'b_entry', (pg_temp.mcp('b', format('select public.mcp_create_journal_entry(%L, %L::date, %L, %L, %L, %L::jsonb)',
  'je174-b-create', '2025-12-31', 'ILS', 'Example other entry', null, jsonb_build_array(
    jsonb_build_object('account_id', (select a.id from public.accounts a where a.category_id = pg_temp.id('b_dep')), 'amount_minor', 1000),
    jsonb_build_object('account_id', (select a.id from public.accounts a where a.company_id = pg_temp.id('co_b')
      and a.category_id is null and a.name = 'Accumulated depreciation'), 'amount_minor', -1000)
  )))->'data'->>'id')::uuid;
select isnt(pg_temp.id('entry'), null, 'the entry is booked');

select is(
  pg_temp.mcp('a', format('select public.mcp_line_legs(%L::uuid)', pg_temp.id('entry')))->'journal_entry'->>'version',
  '1', 'get_line_legs gives version 1');
select is(
  pg_temp.mcp('a', format('select public.get_transaction(%L::uuid)', pg_temp.id('entry')))->'journal_entry'->>'version',
  '1', 'get_expense (get_transaction) gives version 1');
select is(pg_temp.pnl('maple'), -500000::bigint, 'before: the house''s December P&L is the depreciation');
select is(pg_temp.bal('Owner capital', null), 10000::bigint, 'before: Owner capital carries the plug');

-- Refusals before anything changes.
select is(
  pg_temp.upd('a', 'je174-stale', pg_temp.id('entry'), '2', 'Example fix')->'error'->>'message',
  'entry changed', 'a stale expected_version is refused');
select is(
  pg_temp.upd('a', 'je174-noreason', pg_temp.id('entry'), '1', ' ')->'error'->>'code',
  'validation', 'a blank reason is validation');
select is(
  pg_temp.upd('a', 'je174-notje', pg_temp.id('bank_line'), '1', 'Example fix')->'error'->>'message',
  'not a journal entry', 'a bank line is not a journal entry');
select is(
  pg_temp.upd('a', 'je174-otherco', pg_temp.id('b_entry'), '1', 'Example fix')->'error'->>'message',
  'transaction not found', 'another company''s entry is not found');
select is(
  pg_temp.upd('v', 'je174-viewer', pg_temp.id('entry'), '1', 'Example fix')->'error'->>'code',
  'forbidden', 'a viewer is refused');
select is(
  pg_temp.upd('a', 'je174-unbalanced', pg_temp.id('entry'), '1', 'Example fix', p_legs => jsonb_build_array(
    pg_temp.leg('Example depreciation', 500000, 'maple'), pg_temp.leg('Accumulated depreciation', -400000, 'maple')
  ))->'error'->>'message',
  'legs do not balance', 'legs that do not balance are refused');
select is(
  pg_temp.upd('a', 'je174-bank', pg_temp.id('entry'), '1', 'Example fix', p_legs => jsonb_build_array(
    pg_temp.leg('Example depreciation', 500000, 'maple'), pg_temp.leg('Bank/Clearing', -500000)
  ))->'error'->>'message',
  'a journal entry has no bank leg', 'a bank leg is refused');
select is(
  pg_temp.upd('a', 'je174-pnl0', pg_temp.id('entry'), '1', 'Example fix', p_legs => jsonb_build_array(
    pg_temp.leg('Example depreciation', 500000, 'maple'), pg_temp.leg('Example furniture', -500000, 'maple')
  ))->'error'->>'message',
  'a journal entry must change the P&L', 'P&L legs that net to 0 are refused');
select is(
  pg_temp.upd('a', 'je174-foreign', pg_temp.id('entry'), '1', 'Example fix', p_legs => jsonb_build_array(
    pg_temp.leg('Example depreciation', 500000, 'maple'),
    jsonb_build_object('account_id', (select a.id from public.accounts a where a.category_id = pg_temp.id('b_dep')), 'amount_minor', -500000)
  ))->'error'->>'message',
  'The write was refused.', 'another company''s account is refused, as create_journal_entry refuses it');
select is((select j.version from public.journal_entries j where j.transaction_id = pg_temp.id('entry')), 1,
  'the refusals leave version 1');
select is(pg_temp.pnl('maple'), -500000::bigint, 'and the P&L as it was');

-- The correction: the plug goes to furniture, the Property credit gets the house.
insert into je (label, id) values ('w1', null);
select is(
  (pg_temp.upd('e', 'je174-fix', pg_temp.id('entry'), '1', 'Example: plug moved to furniture', p_legs => jsonb_build_array(
    pg_temp.leg('Example depreciation', 500000, 'maple'),
    pg_temp.leg('Example furniture', 10000, 'maple'),
    pg_temp.leg('Accumulated depreciation', -490000, 'maple'),
    pg_temp.leg('Property', -20000, 'maple')
  ))->'data') - 'legs',
  jsonb_build_object(
    'id', pg_temp.id('entry'), 'version', '2', 'previous_version', '1', 'doc_date', '2025-12-31', 'currency', 'ILS',
    'description', 'Example year-end entry', 'reference', 'Example JE 7', 'pnl_minor', -510000,
    'previous_pnl_minor', -500000, 'reason', 'Example: plug moved to furniture', 'undo_kind', 'journal_entry_update'),
  'an editor corrects the owner''s entry: same id, version 2, its P&L effect before and after');
select is(
  pg_temp.upd('e', 'je174-fix', pg_temp.id('entry'), '1', 'Example: plug moved to furniture', p_legs => jsonb_build_array(
    pg_temp.leg('Example depreciation', 500000, 'maple'),
    pg_temp.leg('Example furniture', 10000, 'maple'),
    pg_temp.leg('Accumulated depreciation', -490000, 'maple'),
    pg_temp.leg('Property', -20000, 'maple')
  ))->'data'->>'version',
  '2', 'a replay with the same key returns the same answer');
select is(
  pg_temp.legs_of(pg_temp.id('entry')),
  '[{"account": "Accumulated depreciation", "project": "maple", "amount": -490000},
    {"account": "Example depreciation", "project": "maple", "amount": 500000},
    {"account": "Example furniture", "project": "maple", "amount": 10000},
    {"account": "Property", "project": "maple", "amount": -20000}]'::jsonb,
  'the legs on the books are the new ones');
select is(
  (select count(*)::integer from public.transactions t where t.company_id = pg_temp.id('co')
     and exists (select 1 from public.journal_entries j where j.transaction_id = t.id)),
  1, 'still one journal entry: the edit leaves no other line');
select is(pg_temp.pnl('maple'), -510000::bigint, 'the house''s P&L moves by the plug only');
select is(pg_temp.pnl('oak'), 0::bigint, 'the duplex''s P&L does not move');
select is(pg_temp.bal('Owner capital', null), 0::bigint, 'Owner capital is back to 0');
select is(pg_temp.bal('Property', null), 0::bigint, 'no Property credit is left without a project');
select is(pg_temp.bal('Property', 'maple'), -20000::bigint, 'the Property credit is on the house');
select is(pg_temp.bal('Accumulated depreciation', 'maple'), -490000::bigint, 'Accumulated depreciation is unchanged');
select is(
  pg_temp.mcp('a', format('select public.mcp_line_legs(%L::uuid)', pg_temp.id('entry')))->>'balanced',
  'true', 'the entry still balances');
select is(
  (select count(*)::integer from public.legs l join public.accounts a on a.id = l.account_id
   where l.transaction_id = pg_temp.id('entry') and a.is_bank),
  0, 'and has no bank leg');
select is(
  (select t.in_cash_override from public.transactions t where t.id = pg_temp.id('entry')),
  false, 'the entry stays out of the cash view');
select is(
  pg_temp.mcp('a', $q$select to_jsonb(public.cash_month_lines('2025-12-01'::date, 'out', 'ILS', 200, 0))$q$)::text
    like '%' || pg_temp.id('entry')::text || '%',
  false, 'get_cash_lines does not list it');
select is(
  (select count(*)::integer from public.review_queue q where q.transaction_id = pg_temp.id('entry') and q.status = 'open'),
  0, 'it waits for no review');
select throws_ok(
  format('update public.transactions set amount_gross = 1 where id = %L', pg_temp.id('entry')),
  '23514', 'journal entry is fixed', 'any other change of the entry is still refused');

-- The history keeps version 1 and both names.
select is(
  (select jsonb_build_object('version', h->'version', 'n', jsonb_array_length(h->'versions'),
     'current', h->'versions'->0->'version', 'cur_reason', h->'versions'->0->'reason',
     'cur_by', h->'versions'->0->'written_by_name', 'old', h->'versions'->1->'version',
     'old_by', h->'versions'->1->'written_by_name', 'old_replaced_by', h->'versions'->1->'replaced_by_name',
     'old_why', h->'versions'->1->'replaced_reason', 'old_pnl', h->'versions'->1->'pnl_minor',
     'created_by', h->'created_by_name')
   from (select pg_temp.mcp('v', format('select public.mcp_journal_entry_history(%L::uuid)', pg_temp.id('entry'))) h) x),
  jsonb_build_object('version', '2', 'n', 2, 'current', '2', 'cur_reason', 'Example: plug moved to furniture',
    'cur_by', 'editor174@example.com', 'old', '1', 'old_by', 'owner174@example.com',
    'old_replaced_by', 'editor174@example.com', 'old_why', 'Example: plug moved to furniture', 'old_pnl', -500000,
    'created_by', 'owner174@example.com'),
  'get_journal_entry_history (any member): version 2 by the editor, version 1 by the owner with its P&L');
select is(
  (select count(*)::integer
   from jsonb_array_elements(pg_temp.mcp('a', format('select public.mcp_journal_entry_history(%L::uuid)', pg_temp.id('entry')))->'versions'->1->'legs') g
   where g->>'account_id' = pg_temp.acct('Owner capital')::text and (g->>'amount_minor')::bigint = 10000),
  1, 'version 1''s legs keep the Owner capital plug');
select is(
  pg_temp.mcp('a', format('select public.mcp_journal_entry_history(%L::uuid)', pg_temp.id('b_entry'))),
  null, 'another company''s history reads null');
select is(
  pg_temp.mcp('a', format('select public.mcp_journal_entry_history(%L::uuid)', pg_temp.id('bank_line')))->>'is_journal_entry',
  'false', 'a bank line has no journal entry history');
select is(
  pg_temp.mcp('a', format('select public.mcp_line_legs(%L::uuid)', pg_temp.id('entry')))->'journal_entry'->>'version',
  '2', 'get_line_legs gives version 2');

-- Fields left out stay; the reference can be cleared.
select is(
  (select jsonb_build_object('v', d->'version', 'desc', d->'description', 'ref', d->'reference', 'pnl', d->'pnl_minor')
   from (select pg_temp.upd('a', 'je174-desc', pg_temp.id('entry'), '2', 'Example: clearer words',
     p_description => 'Example year-end entry, corrected', p_set_reference => true)->'data' d) x),
  '{"v": "3", "desc": "Example year-end entry, corrected", "ref": null, "pnl": -510000}'::jsonb,
  'a new description and a cleared reference keep the legs');
select is(pg_temp.pnl('maple'), -510000::bigint, 'the P&L is unchanged by it');
select is(
  (select j.reference from public.journal_entries j where j.transaction_id = pg_temp.id('entry')),
  null, 'the reference is cleared');

-- The books-closed date guards the old and the new date.
update public.companies set books_closed_through = '2025-12-31' where id = pg_temp.id('co');
select is(
  pg_temp.upd('a', 'je174-closed', pg_temp.id('entry'), '3', 'Example fix', p_date => '2026-01-05')->'error'->>'message',
  'the books are closed through 2025-12-31', 'an entry dated in closed books is refused');
update public.companies set books_closed_through = '2025-12-15' where id = pg_temp.id('co');
select is(
  pg_temp.upd('a', 'je174-closed-new', pg_temp.id('entry'), '3', 'Example fix', p_date => '2025-12-10')->'error'->>'message',
  'the books are closed through 2025-12-15', 'moving it into closed books is refused');
update public.companies set books_closed_through = null where id = pg_temp.id('co');

-- Undo: the owner's description edit first, then the editor's correction, each as a new version.
select is(
  pg_temp.undo('a', 'je174-undo-desc', 'journal_entry_update', pg_temp.id('entry'))->'data'->>'version',
  '4', 'undo puts the description and reference back as version 4');
select is(
  (select jsonb_build_object('d', t.description, 'r', j.reference)
   from public.transactions t join public.journal_entries j on j.transaction_id = t.id where t.id = pg_temp.id('entry')),
  '{"d": "Example year-end entry", "r": "Example JE 7"}'::jsonb, 'the description and reference are back');
select is(
  pg_temp.undo('a', 'je174-undo-none', 'journal_entry_update', pg_temp.id('entry'))->'error'->>'code',
  'not_found', 'the owner has no other edit to undo (the correction is the editor''s)');

-- A change since the edit makes its undo a conflict.
select is(
  pg_temp.upd('a', 'je174-later', pg_temp.id('entry'), '4', 'Example: later words', p_description => 'Example later words')->'data'->>'version',
  '5', 'the owner edits again');
select is(
  pg_temp.undo('e', 'je174-undo-conflict', 'journal_entry_update', pg_temp.id('entry'))->'error'->>'code',
  'conflict', 'the editor''s undo is a conflict once the entry changed since');
select is(
  pg_temp.undo('a', 'je174-undo-later', 'journal_entry_update', pg_temp.id('entry'))->'data'->>'version',
  '6', 'the owner undoes the later edit');
select is(
  pg_temp.undo('e', 'je174-undo-fix', 'journal_entry_update', pg_temp.id('entry'))->'data'->>'version',
  '7', 'now the editor''s correction undoes');
select is(pg_temp.pnl('maple'), -500000::bigint, 'the P&L is back to version 1');
select is(pg_temp.bal('Owner capital', null), 10000::bigint, 'the plug is back on Owner capital');
select is(pg_temp.bal('Property', null), -20000::bigint, 'and the Property credit without a project');
select is(
  (select count(*)::integer from public.journal_entry_versions v where v.transaction_id = pg_temp.id('entry')),
  6, 'every version replaced is kept');
select is(
  (select v.replaced_reason from public.journal_entry_versions v where v.transaction_id = pg_temp.id('entry') and v.version = 6),
  'undo: Example: plug moved to furniture', 'an undo is recorded with the reason it undid');

-- A prepaid schedule's posted month is changed with the prepaid tools only.
insert into je (label, id) values
  ('prepaid_line', tests.fixture_line(pg_temp.id('co'), 'je174:prepaid', 20000, 'expense', null, pg_temp.id('furniture'), '2025-10-05'));
select is(
  pg_temp.mcp('a', format('select public.mcp_create_prepaid_schedule(%L, %L::uuid, %L::uuid, %L, 2)',
    'je174-prepaid', pg_temp.id('prepaid_line'), pg_temp.id('furniture'), '2025-10'))->>'ok',
  'true', 'a prepaid schedule posts its past months as journal entries');
select is(
  pg_temp.upd('a', 'je174-prepaid-edit', (select r.entry_id from public.prepaid_rows r
    join public.prepaid_schedules s on s.id = r.schedule_id
    where s.transaction_id = pg_temp.id('prepaid_line') and r.seq = 1), '1', 'Example fix')->'error'->>'message',
  'the entry belongs to a prepaid schedule', 'a prepaid month''s entry is refused');

-- Back as booked, the entry undoes as booked: create_journal_entry's undo removes it.
select is(
  pg_temp.undo('a', 'je174-undo-create', 'journal_entry', pg_temp.id('entry'))->>'ok',
  'true', 'create_journal_entry''s undo removes the entry once it reads as booked');
select is(
  (select count(*)::integer from public.journal_entry_versions v where v.transaction_id = pg_temp.id('entry')),
  0, 'its history goes with it');

select * from finish();
rollback;
