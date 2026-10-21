-- FLOW-941 (decision 0205): a transfer between two Mercury connections comes in as two lines (money
-- out on one, money in on the other). list_transfer_matches suggests the pair; answer_transfer_match
-- confirms it (both lines become a transfer), rejects it (never suggested again) or takes the answer
-- back; mcp_answer_transfer_match adds the idempotency key and undo kind transfer_match.
-- Invented names, ids and @example.com emails only. Amounts are cents.

begin;

select plan(45);

do $users$
begin
  perform tests.create_supabase_user('xm_owner', 'xm-owner@example.com');
  perform tests.create_supabase_user('xm_editor', 'xm-editor@example.com');
  perform tests.create_supabase_user('xm_outsider', 'xm-outsider@example.com');
end
$users$;

create temp table xm (label text primary key, id uuid);
grant all on xm to authenticated, service_role;
create function pg_temp.xid(p_label text) returns uuid language sql as $$ select id from pg_temp.xm where label = p_label; $$;
grant execute on function pg_temp.xid(text) to authenticated, service_role;

insert into xm (label, id) values
  ('co', tests.fixture_company('xm_owner', 'Example Harbor Books')),
  ('other', tests.fixture_company('xm_outsider', 'Example Other Books')),
  ('owner', tests.get_supabase_uid('xm_owner')),
  ('editor', tests.get_supabase_uid('xm_editor'));
insert into public.company_members (company_id, user_id, role) values (pg_temp.xid('co'), pg_temp.xid('editor'), 'editor');
insert into public.active_companies (user_id, company_id) values (pg_temp.xid('editor'), pg_temp.xid('co'));

-- Slot 1 (Harbor) syncs acct-h1 and leaves acct-h2 out; slot 2 (Quarry) syncs acct-q1.
insert into public.connector_connections (
  company_id, provider, slot, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_ref, kek_version, envelope_version,
  account_labels, org_label, accounts_chosen_at, sync_account_ids, skip_account_ids
) values
  (pg_temp.xid('co'), 'mercury', 1, '\x01', '\x0201', '\x03', '\x0401', 'MERCURY_KEK', '1', '3',
   '[{"id":"acct-h1","label":"Operations","last4":"4821","kind":"checking"},{"id":"acct-h2","label":"Payroll","last4":"1170","kind":"checking"}]',
   'Harbor Sample LLC', '2026-01-02T00:00:00Z', array['acct-h1'], array['acct-h2']),
  (pg_temp.xid('co'), 'mercury', 2, '\x01', '\x0201', '\x03', '\x0401', 'MERCURY_KEK', '1', '3',
   '[{"id":"acct-q1","label":"Main","last4":"9034","kind":"checking"}]',
   'Quarry Sample Inc', '2026-01-02T00:00:00Z', null, '{}');

-- label, direction, account, date, amount. The dates are as of 2026-10-25 and move with today, so the
-- app's 90 days hold the same lines whenever the test runs (pg_temp.day).
create function pg_temp.day(p date) returns date language sql stable as $$ select p + ((now() at time zone 'Asia/Jerusalem')::date - date '2026-10-25'); $$;
grant execute on function pg_temp.day(date) to authenticated, service_role;
create temp table xm_lines (label text, direction text, account text, doc_date date, amount bigint);
insert into xm_lines values
  ('out1', 'expense', 'acct-h1', '2026-10-10', 500000),
  ('in1', 'income', 'acct-q1', '2026-10-11', 500000),
  ('in1b', 'income', 'acct-q1', '2026-10-12', 500000),
  ('out2', 'expense', 'acct-h1', '2026-10-01', 120000),
  ('in2', 'income', 'acct-q1', '2026-10-06', 120000),
  ('out3', 'expense', 'acct-h1', '2026-10-03', 70000),
  ('in3', 'income', 'acct-h1', '2026-10-03', 70000),
  ('out4', 'expense', 'acct-h2', '2026-10-04', 90000),
  ('in4', 'income', 'acct-q1', '2026-10-04', 90000),
  ('out5', 'expense', 'acct-h1', '2026-10-05', 33000),
  ('in5', 'income', 'acct-q1', '2026-10-05', 33000),
  ('out6', 'expense', 'acct-h1', '2026-10-15', 44000),
  ('in6', 'income', 'acct-q1', '2026-10-15', 44000),
  -- Each in-line below is one the list leaves out: an invoice's linked deposit, a credit note, a line
  -- kept out of the P&L. Confirm refuses them too.
  ('out7', 'expense', 'acct-h1', '2026-10-20', 61000),
  ('in7', 'income', 'acct-q1', '2026-10-20', 61000),
  ('out8', 'expense', 'acct-h1', '2026-10-21', 62000),
  ('in8', 'income', 'acct-q1', '2026-10-21', 62000),
  ('out9', 'expense', 'acct-h1', '2026-10-22', 63000),
  ('in9', 'income', 'acct-q1', '2026-10-22', 63000),
  -- Older than the app's 90 days: only the MCP's list (p_all) has it.
  ('outold', 'expense', 'acct-h1', '2026-06-20', 81000),
  ('inold', 'income', 'acct-q1', '2026-06-20', 81000);
insert into xm (label, id)
select l.label, tests.fixture_line(
  pg_temp.xid('co'), 'xm:' || l.label, l.amount, l.direction, null, null, pg_temp.day(l.doc_date),
  p_currency => 'USD', p_source => 'mercury', p_pnl_role => null,
  p_doc_kind => case when l.label = 'in8' then 'credit' when l.direction = 'expense' then 'expense' else 'invoice_receipt' end
)
from xm_lines l;
insert into xm (label, id) values ('inv7', tests.fixture_line(
  pg_temp.xid('co'), 'xm:inv7', 61000, 'income', null, null, pg_temp.day('2026-10-18'),
  p_currency => 'USD', p_source => 'manual', p_pnl_role => null, p_doc_kind => 'invoice'));
insert into public.invoice_payment_links (company_id, transaction_id, bank_transaction_id, linked_by)
values (pg_temp.xid('co'), pg_temp.xid('inv7'), pg_temp.xid('in7'), pg_temp.xid('owner'));
update public.transactions set in_pnl_override = false where id = pg_temp.xid('in9');
update public.transactions t
set provider_meta = jsonb_build_object('method', 'ach', 'account_id', l.account),
    user_assigned = false, category_assigned = false
from xm_lines l
where t.id = pg_temp.xid(l.label);
insert into public.suppliers (company_id, name) values (pg_temp.xid('co'), 'Quarry Sample Inc') returning id;
update public.transactions set supplier_id = (select s.id from public.suppliers s where s.company_id = pg_temp.xid('co'))
where id = pg_temp.xid('out1');
-- out5 is already a transfer (the category העברות, the owner's pick).
update public.transactions set category_id = (
  select c.id from public.categories c where c.company_id = pg_temp.xid('co') and c.kind = 'expense' and c.name = 'העברות'
) where id = pg_temp.xid('out5');
insert into public.review_queue (company_id, transaction_id, status, reason) values
  (pg_temp.xid('co'), pg_temp.xid('out1'), 'open', 'missing_category'),
  (pg_temp.xid('co'), pg_temp.xid('in1'), 'open', 'missing_category');

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at) values
  (pg_temp.xid('owner'), pg_temp.xid('co'), 'hash-xm-owner', 'kid', array['read', 'write']::text[], '2099-01-01'),
  (pg_temp.xid('owner'), pg_temp.xid('co'), 'hash-xm-read', 'kid', array['read']::text[], '2099-01-01');
insert into xm (label, id)
select replace(token_hash, 'hash-xm-', 'tok-'), id from private.mcp_credentials where token_hash like 'hash-xm-%';

create or replace function pg_temp.as_mcp(p_user text, p_token text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := pg_temp.xid(p_user);
  tid uuid := pg_temp.xid(p_token);
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text, text) to authenticated, service_role;

-- The pairs the list gives, as "out/in" labels (p_all: the MCP's list, every pair however old).
create or replace function pg_temp.pairs(p_all boolean default false)
returns text
language sql
as $$
  select coalesce(string_agg(
    (select x.label from pg_temp.xm x where x.id = (m->'out'->>'transaction_id')::uuid) || '/' ||
    (select x.label from pg_temp.xm x where x.id = (m->'in'->>'transaction_id')::uuid), ' ' order by o), '')
  from jsonb_array_elements(public.list_transfer_matches(p_all)->'matches') with ordinality e(m, o);
$$;
grant execute on function pg_temp.pairs(boolean) to authenticated, service_role;

-- A line's transfer state: its category (העברות, or - for any other: a null category takes a suggested
-- one), in_pnl_override, in_cash_override.
create or replace function pg_temp.state(p_label text)
returns text
language sql
security definer
as $$
  select case when c.name = 'העברות' then c.name else '-' end || ':' || coalesce(t.in_pnl_override::text, 'null') || ':' || coalesce(t.in_cash_override::text, 'null')
  from public.transactions t left join public.categories c on c.id = t.category_id
  where t.id = pg_temp.xid(p_label);
$$;
grant execute on function pg_temp.state(text) to authenticated, service_role;

create or replace function pg_temp.reviews(p_label text)
returns text
language sql
security definer
as $$
  select string_agg(q.status::text, ',' order by q.created_at)
  from public.review_queue q where q.transaction_id = pg_temp.xid(p_label);
$$;
grant execute on function pg_temp.reviews(text) to authenticated, service_role;

-- 1-4. The suggestions.
select tests.authenticate_as('xm_owner');
select is(pg_temp.pairs(), 'out6/in6 out1/in1',
  'the same day first; a gap over 3 days, the same connection, an unsynced account and a line already a transfer are not suggested, and each line is in one pair');
select is(
  (public.list_transfer_matches()->'matches'->1->'out') - 'transaction_id'::text,
  jsonb_build_object('doc_date', pg_temp.day('2026-10-10')) || '{"amount_minor":500000,"currency":"USD","description":"xm:out1","party":"Quarry Sample Inc","slot":1,"org_label":"Harbor Sample LLC","account_name":"Operations","account_last4":"4821"}'::jsonb,
  'a side has its date, amount, payee, connection, organisation and account');
select is(
  (public.list_transfer_matches()->'matches'->1->>'name_hint')::boolean and (public.list_transfer_matches()->'matches'->1->>'day_diff')::int = 1,
  true,
  'the payee naming the other organisation is a name hint, and the days between are given');
select is(
  (public.list_transfer_matches()->'matches'->0->'in'->>'org_label'),
  'Quarry Sample Inc',
  'the money-in side names its own organisation');

-- 5-10. Confirming (an editor may).
select tests.authenticate_as('xm_editor');
select is(
  public.answer_transfer_match(pg_temp.xid('out1'), pg_temp.xid('in1'), true),
  jsonb_build_object('out_transaction_id', pg_temp.xid('out1'), 'in_transaction_id', pg_temp.xid('in1'), 'same', true, 'prior_same', null),
  'an editor confirms the pair');
select is(pg_temp.state('out1') || ' ' || pg_temp.state('in1'), 'העברות:false:false העברות:false:false',
  'both lines are filed as a transfer of their kind, out of the P&L and the cash view');
select is(
  (select c.kind::text from public.transactions t join public.categories c on c.id = t.category_id where t.id = pg_temp.xid('in1')),
  'income',
  'the money-in line takes the income העברות');
select is(pg_temp.reviews('out1') || ' ' || pg_temp.reviews('in1'), 'skipped skipped',
  'their open reviews are set aside');
select is(pg_temp.pairs(), 'out6/in6', 'a confirmed line is not suggested again, with another line either');
select throws_ok(
  format('select public.answer_transfer_match(%L, %L, true)', pg_temp.xid('out1'), pg_temp.xid('in1b')),
  'already matched',
  'a line already in a confirmed pair cannot be confirmed with another');

-- 11-14. Taking it back.
select is(
  public.answer_transfer_match(pg_temp.xid('out1'), pg_temp.xid('in1'), null)->'prior_same',
  'true'::jsonb,
  'null takes the answer back and says it was confirmed');
select is(pg_temp.state('out1') || ' ' || pg_temp.state('in1'), '-:null:null -:null:null',
  'the lines get their category and switches back');
select is(pg_temp.reviews('out1') || ' ' || pg_temp.reviews('in1'), 'open open', 'their reviews reopen');
select is(pg_temp.pairs(), 'out6/in6 out1/in1', 'the pair is suggested again');

-- 15-17. Rejecting.
select is(
  public.answer_transfer_match(pg_temp.xid('out1'), pg_temp.xid('in1'), false)->>'same',
  'false',
  'the editor says it is a coincidence');
select is(pg_temp.state('out1') || ' ' || pg_temp.reviews('out1'), '-:null:null open', 'a rejection changes nothing on the lines');
select is(pg_temp.pairs(), 'out6/in6 out1/in1b', 'the rejected pair is never suggested again; the line may pair with another');

-- 18-21. Refusals.
select throws_ok(
  format('select public.answer_transfer_match(%L, %L, true)', pg_temp.xid('out2'), pg_temp.xid('in2')),
  'not a transfer pair', 'dates more than 3 days apart are refused');
select throws_ok(
  format('select public.answer_transfer_match(%L, %L, true)', pg_temp.xid('out3'), pg_temp.xid('in3')),
  'not a transfer pair', 'two lines of the same connection are refused');
select throws_ok(
  format('select public.answer_transfer_match(%L, %L, true)', pg_temp.xid('in1'), pg_temp.xid('out1')),
  'not a transfer pair', 'the money-out line comes first');
select tests.authenticate_as('xm_outsider');
select throws_ok(
  format('select public.answer_transfer_match(%L, %L, true)', pg_temp.xid('out6'), pg_temp.xid('in6')),
  'transaction not found', 'another company''s lines are not found');

-- 22. The outsider's own list is empty.
select is(public.list_transfer_matches(), '{"matches": []}'::jsonb, 'another company sees none of these');

-- 23-30. MCP.
select pg_temp.as_mcp('owner', 'tok-read');
select is(
  public.mcp_answer_transfer_match('xm-read', pg_temp.xid('out6'), pg_temp.xid('in6'), true)->'error'->>'code',
  'forbidden', 'a read-only key may not answer');
select pg_temp.as_mcp('owner', 'tok-owner');
select is(
  public.mcp_answer_transfer_match('xm-confirm', pg_temp.xid('out6'), pg_temp.xid('in6'), true)->'data',
  jsonb_build_object('out_transaction_id', pg_temp.xid('out6'), 'in_transaction_id', pg_temp.xid('in6'), 'same', true,
    'undo_kind', 'transfer_match', 'id', pg_temp.xid('out6')),
  'confirm_transfer_match answers with the undo kind and the money-out line as its id');
select is(
  public.mcp_answer_transfer_match('xm-confirm', pg_temp.xid('out6'), pg_temp.xid('in6'), true)->'data'->>'id',
  pg_temp.xid('out6')::text, 'the same key replays');
select is(pg_temp.state('out6'), 'העברות:false:false', 'the MCP confirm files the line as a transfer');
select is(
  public.mcp_undo('xm-undo', 'transfer_match', pg_temp.xid('out6'))->>'ok',
  'true', 'undo takes the confirmation back');
select is(pg_temp.state('out6') || ' ' || pg_temp.pairs(), '-:null:null out6/in6 out1/in1b',
  'the line is back and the pair is suggested again');
select is(
  public.mcp_answer_transfer_match('xm-dismiss', pg_temp.xid('out6'), pg_temp.xid('in6'), false)->'data'->>'same',
  'false', 'dismiss_transfer_match rejects the pair');
select tests.authenticate_as('xm_owner');
select public.answer_transfer_match(pg_temp.xid('out6'), pg_temp.xid('in6'), null);
select pg_temp.as_mcp('owner', 'tok-owner');
select is(
  public.mcp_undo('xm-undo-2', 'transfer_match', pg_temp.xid('out6'))->'error'->>'code',
  'conflict', 'undo is a conflict once the answer changed since');

-- 31-32. Validation.
select is(
  public.mcp_answer_transfer_match('xm-bad', pg_temp.xid('out6'), pg_temp.xid('out6'), true)->'error'->>'code',
  'validation', 'two different lines are needed');
select is(
  public.mcp_answer_transfer_match('xm-bad-2', pg_temp.xid('out2'), pg_temp.xid('in2'), true)->'error',
  '{"code":"refused","message":"not a transfer pair"}'::jsonb, 'a pair that does not fit is refused');

-- 33-35. Confirm takes only a pair the list could give (the list's rule for both lines).
select tests.authenticate_as('xm_owner');
select throws_ok(
  format('select public.answer_transfer_match(%L, %L, true)', pg_temp.xid('out7'), pg_temp.xid('in7')),
  'not a transfer pair', 'an invoice''s linked deposit is refused');
select throws_ok(
  format('select public.answer_transfer_match(%L, %L, true)', pg_temp.xid('out8'), pg_temp.xid('in8')),
  'not a transfer pair', 'a money-in credit note is refused');
select throws_ok(
  format('select public.answer_transfer_match(%L, %L, true)', pg_temp.xid('out9'), pg_temp.xid('in9')),
  'not a transfer pair', 'a line kept out of the P&L is refused');

-- 36-37. A confirmed pair stays out of לאישור, also after Mercury edits a line.
select public.answer_transfer_match(pg_temp.xid('out6'), pg_temp.xid('in6'), true);
reset role;
update public.transactions set description = 'xm:out6 edited', doc_date = doc_date + 1
where id = pg_temp.xid('out6');
create or replace function pg_temp.sync()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.sync_review_queue(pg_temp.xid('co'));
end;
$$;
select pg_temp.sync();
select is(coalesce(pg_temp.reviews('out6'), 'none') || ' ' || coalesce(pg_temp.reviews('in6'), 'none'), 'none none',
  'the sync queues no line of a confirmed pair, even after Mercury edits it');
select is(pg_temp.reviews('out1'), 'open', 'a line in no confirmed pair is still queued as before');

-- 38-39. The count is the list's length.
select tests.authenticate_as('xm_owner');
select is(public.count_transfer_matches(), jsonb_array_length(public.list_transfer_matches()->'matches'),
  'count_transfer_matches counts the pairs the list gives');
select tests.authenticate_as('xm_outsider');
select is(public.count_transfer_matches(), 0, 'another company counts none of these');

-- 40-44. The app's 90 days, the MCP's every pair; confirming an older pair, under a new העברות.
select tests.authenticate_as('xm_owner');
select is(pg_temp.pairs() || ' | ' || pg_temp.pairs(true) || ' | ' || public.count_transfer_matches()::text,
  'out1/in1b | outold/inold out1/in1b | 1',
  'the app''s list and count have the last 90 days; p_all has every pair, however old');
reset role;
update public.categories set name = 'העברות ישנות'
where company_id = pg_temp.xid('co') and kind = 'income' and name = 'העברות';
update public.transactions set category_id = (
  select c.id from public.categories c where c.company_id = pg_temp.xid('co') and c.kind = 'income' and c.name = 'הכנסה אחרת'
) where id = pg_temp.xid('inold');
select tests.authenticate_as('xm_editor');
select is(public.answer_transfer_match(pg_temp.xid('outold'), pg_temp.xid('inold'), true)->>'same', 'true',
  'a pair older than 90 days can be confirmed');
select is(pg_temp.state('outold') || ' ' || pg_temp.state('inold'), 'העברות:false:false העברות:false:false',
  'both lines are filed under העברות, created for the money in when the company had none');
select is(
  (select row(c.kind::text, c.excluded_from_pnl, c.in_cash, c.is_default)::text
   from public.transactions t join public.categories c on c.id = t.category_id where t.id = pg_temp.xid('inold')),
  '(income,t,f,t)',
  'the new העברות is the default one: income, out of the P&L and out of the cash view');
select public.answer_transfer_match(pg_temp.xid('outold'), pg_temp.xid('inold'), null);
select is(
  (select coalesce(c.name, '-') from public.transactions t left join public.categories c on c.id = t.category_id where t.id = pg_temp.xid('inold'))
    || ' ' || pg_temp.state('outold'),
  'הכנסה אחרת -:null:null',
  'taking it back restores each line''s category from before');

-- 45. A company with one chosen connection gets no suggestion.
reset role;
update public.connector_connections set accounts_chosen_at = null where company_id = pg_temp.xid('co') and slot = 2;
select tests.authenticate_as('xm_owner');
select is(pg_temp.pairs(), '', 'one connection: nothing is suggested');

select * from finish();
rollback;
