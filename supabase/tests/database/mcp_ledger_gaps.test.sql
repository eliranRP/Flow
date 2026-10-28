-- FLOW-950 (decision 0208, item 9). The MCP can use the ledger: mcp_accounts (list_accounts) lists
-- the company's accounts with their live category; mcp_line_legs (get_line_legs) reads one line's legs
-- back; mcp_book_line books the caller's EXISTING posted line from legs, mapping each content leg to a
-- normal or a gross-up split part by its sign against the bank leg, through save_line_split, with
-- split_line's undo; bridge accounts follow a renamed or kept-out category. Invented books only; USD
-- cents.

begin;
select plan(62);

do $u$ begin
  perform tests.create_supabase_user('lg_owner', 'lg-owner@example.com');
  perform tests.create_supabase_user('lg_other', 'lg-other@example.com');
end $u$;

insert into public.companies (owner_id, name, is_demo) values
  (tests.get_supabase_uid('lg_owner'), 'Example Ledger Gaps LLC', false),
  (tests.get_supabase_uid('lg_other'), 'Example Other Gaps LLC', false);

create temp table lg (label text primary key, id uuid);
grant all on lg to authenticated, service_role;
insert into lg select 'co', id from public.companies where name = 'Example Ledger Gaps LLC';
insert into lg select 'other_co', id from public.companies where name = 'Example Other Gaps LLC';

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.lg where label = p_label
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into public.projects (company_id, name, status)
select pg_temp.id('co'), v.n, 'active' from (values ('Alpha'), ('Beta')) v(n);
insert into lg select lower(name), id from public.projects where company_id = pg_temp.id('co');

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
select pg_temp.id('co'), v.name, v.kind::public.category_kind, 90, false, v.ex
from (values ('Build', 'expense', false), ('Taxes', 'expense', false), ('Levy', 'expense', false),
  ('OtherInc', 'income', false), ('Kept', 'expense', true)) v(name, kind, ex);
insert into lg select lower(name), id from public.categories where company_id = pg_temp.id('co') and sort_order = 90;
insert into public.categories (company_id, name, kind, sort_order, is_default)
values (pg_temp.id('other_co'), 'Foreign', 'expense', 90, false);

-- Each category's bridge account is a_<label>; the bank is a_bank.
insert into lg select 'a_' || c.label, a.id from public.accounts a join lg c on c.id = a.category_id;
insert into lg select 'a_bank', id from public.accounts where company_id = pg_temp.id('co') and name = 'Bank/Clearing';
insert into lg select 'a_vat', id from public.accounts where company_id = pg_temp.id('co') and name = 'VAT control';

-- Posted lines filed to Build on Beta. pay is the property-tax wire (2000 + 249.48 - 850.77 = 1398.71).
create function pg_temp.line(p_key text, p_company text, p_gross bigint, p_vat bigint default 0,
  p_status text default 'posted') returns void
language sql as $$
  insert into public.transactions (
    company_id, direction, doc_kind, pnl_role, line_status, currency,
    amount_gross, amount_net, amount_original, vat_amount, vat_status,
    doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
  )
  values (pg_temp.id(p_company), 'expense', 'expense', 'project', p_status::public.line_status, 'USD',
    p_gross, p_gross - p_vat, abs(p_gross), p_vat, 'source', '2026-06-10', '2026-06-10', 'manual', 'lg:' || p_key,
    case when p_company = 'co' then pg_temp.id('beta') end,
    case when p_company = 'co' then pg_temp.id('build') end, p_key, true);
  insert into pg_temp.lg select 'txn_' || p_key, id from public.transactions where idempotency_key = 'lg:' || p_key;
$$;
select pg_temp.line('pay', 'co', -139871);
select pg_temp.line('pay2', 'co', -50000);
select pg_temp.line('pay3', 'co', -40000);
select pg_temp.line('vat', 'co', -11700, -1700);
select pg_temp.line('rev', 'co', -20000);
select pg_temp.line('loan', 'co', -30000);
select pg_temp.line('pend', 'co', -10000, 0, 'pending');
select pg_temp.line('keptline', 'co', -20000);
select pg_temp.line('pay4', 'co', -40000);
update public.transactions set in_pnl_override = false where id = pg_temp.id('txn_keptline');
select pg_temp.line('foreign', 'other_co', -139871);

insert into public.review_queue (company_id, transaction_id, status, reason)
values (pg_temp.id('co'), pg_temp.id('txn_rev'), 'open', 'suggested');
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency)
values (pg_temp.id('co'), 'Example Loan', 1000000, 50000, 120, '2026-01-01', 30000, 0, 'USD');
-- The loan line's payment parts: interest, escrow and principal.
select tests.loan_split(pg_temp.id('txn_loan'), l.id, (
  select jsonb_agg(jsonb_build_object('part', v.part, 'amount_minor', v.amount, 'scheduled_minor', v.amount,
    'category_id', (select c.id from public.categories c
                    where c.company_id = pg_temp.id('co') and c.loan_part = v.part::public.loan_split_part limit 1),
    'needs_review', false) order by v.ord)
  from (values (1, 'interest', 20000), (2, 'escrow', 0), (3, 'principal', 10000)) v(ord, part, amount)))
from public.loans l where l.company_id = pg_temp.id('co');

-- A leg: account label, signed amount, project label.
create function pg_temp.leg(p_account text, p_amount bigint, p_project text default null) returns jsonb
language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'account_id', pg_temp.id('a_' || p_account), 'amount_minor', p_amount, 'project_id', pg_temp.id(p_project)))
$$;
grant execute on function pg_temp.leg(text, bigint, text) to authenticated, service_role;

-- Book an existing line (doc_date, currency and description are the line's own: null).
create function pg_temp.book(p_key text, p_line text, p_legs jsonb, p_direction text default 'expense')
returns jsonb language sql as $$
  select public.mcp_book_line(p_key, null, p_direction, null, null, p_legs, null, pg_temp.id(p_line))
$$;
grant execute on function pg_temp.book(text, text, jsonb, text) to authenticated, service_role;

-- A line's parts as (category, project, amount, gross_up) text, in stored order.
create function pg_temp.parts_of(p_line text) returns text language sql stable as $$
  select string_agg(format('%s/%s/%s/%s', c.label, coalesce(p.label, '-'), s.amount_minor, s.gross_up::text), ' ' order by s.ordinal)
  from private.split_parts s
  join pg_temp.lg c on c.id = s.category_id
  left join pg_temp.lg p on p.id = s.project_id
  where s.transaction_id = pg_temp.id(p_line)
$$;
grant execute on function pg_temp.parts_of(text) to authenticated, service_role;

-- A line's P&L for one category and project, from the live pnl_lines.
create function pg_temp.pnl(p_line text, p_category text, p_project text) returns bigint language sql stable as $$
  select sum(l.amount_net)::bigint from private.pnl_lines l
  where l.transaction_id = pg_temp.id(p_line) and l.category_id = pg_temp.id(p_category)
    and l.project_id is not distinct from pg_temp.id(p_project) and l.in_pnl
$$;
grant execute on function pg_temp.pnl(text, text, text) to authenticated, service_role;

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('lg_owner'), pg_temp.id('co'), 'hash-lg-write', 'kid', array['read', 'write']::text[], '2099-01-01');
insert into lg select 'write', id from private.mcp_credentials where token_hash = 'hash-lg-write';

create function pg_temp.as_mcp() returns void language plpgsql set search_path = '' as $$
declare uid uuid := tests.get_supabase_uid('lg_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1',
    'mcp_tid', pg_temp.id('write'))::text, true);
end $$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

set local role authenticated;
select pg_temp.as_mcp();

-- ---------------------------------------------------------------------------
-- G1. mcp_accounts: the company's own accounts, with the live category.
-- ---------------------------------------------------------------------------
create temp table acct as select x from jsonb_array_elements(public.mcp_accounts()->'accounts') x;
select is((select count(*)::int from acct),
  (select count(*)::int from public.accounts where company_id = pg_temp.id('co')),
  'list_accounts lists every account of the company');
select is((select count(*)::int from acct x
  where (x->>'id')::uuid in (select id from public.accounts where company_id = pg_temp.id('other_co'))),
  0, 'list_accounts shows no account of another company');
select is((select x->>'is_bank' || '/' || (x->>'system') || '/' || (x->>'bookable') from acct x where x->>'name' = 'Bank/Clearing'),
  'true/true/true', 'the bank is a bookable system account');
select is((select x->>'type' || '/' || (x->>'excluded_from_pnl') || '/' || (x->>'bookable') || '/' || (x->>'category_id')
  from acct x where x->>'name' = 'Kept'),
  'expense/true/true/' || pg_temp.id('kept'), 'a kept-out category account is bookable (FLOW-953: it posts to its balance-sheet account)');
select is((select x->>'type' || '/' || (x->>'system') || '/' || (x->>'bookable') from acct x where x->>'name' = 'OtherInc'),
  'income/false/true', 'an in-P&L income category account is bookable');

-- ---------------------------------------------------------------------------
-- G2. mcp_line_legs: one line's legs; another company's or an unknown line is null.
-- ---------------------------------------------------------------------------
select is((public.mcp_line_legs(pg_temp.id('txn_pay'))->>'balanced'), 'true', 'get_line_legs: the line balances');
select is(jsonb_array_length(public.mcp_line_legs(pg_temp.id('txn_pay'))->'legs'), 2, 'get_line_legs: bank and Build legs');
select is((select (l->>'amount_minor')::bigint from jsonb_array_elements(public.mcp_line_legs(pg_temp.id('txn_pay'))->'legs') l
  where (l->>'is_bank')::boolean), -139871::bigint, 'get_line_legs: the bank leg is the signed line gross');
select is((select l->>'account_name' || '/' || (l->>'account_type') || '/' || (l->>'project_id')
  from jsonb_array_elements(public.mcp_line_legs(pg_temp.id('txn_pay'))->'legs') l where not (l->>'is_bank')::boolean),
  'Build/expense/' || pg_temp.id('beta'), 'get_line_legs: the content leg names its account and project');
select is(public.mcp_line_legs(pg_temp.id('txn_foreign')), null, 'get_line_legs: another company''s line is null');
select is(public.mcp_line_legs(gen_random_uuid()), null, 'get_line_legs: an unknown line is null');

-- ---------------------------------------------------------------------------
-- G3/G4 (a). The property-tax wire on an existing line: a Build cost, a Taxes cost and a Taxes contra
-- credit on the same project. First split it another way, so undo has a prior split to restore.
-- ---------------------------------------------------------------------------
select is(public.mcp_split_line('lg-split-1', pg_temp.id('txn_pay'), jsonb_build_array(
    jsonb_build_object('category_id', pg_temp.id('build'), 'project_id', pg_temp.id('beta'), 'amount_minor', 100000),
    jsonb_build_object('category_id', pg_temp.id('levy'), 'project_id', pg_temp.id('alpha'), 'amount_minor', 39871)))->>'ok',
  'true', 'the line starts split another way');

create temp table booked as select pg_temp.book('lg-a', 'txn_pay', jsonb_build_array(
  pg_temp.leg('bank', -139871),
  pg_temp.leg('build', 200000, 'beta'),
  pg_temp.leg('taxes', 24948, 'alpha'),
  pg_temp.leg('taxes', -85077, 'alpha'))) as r;
select is((select r->>'ok' from booked), 'true', 'book_line books the existing line');
select is((select r->'data'->>'undo_kind' || '/' || (r->'data'->>'id') from booked),
  'line_split/' || pg_temp.id('txn_pay'), 'the booking undoes as line_split, by the line id');
select ok((select (r->'data'->>'write_id') is not null from booked), 'the booking returns its write_id');
select is(pg_temp.parts_of('txn_pay'),
  'build/beta/200000/false taxes/alpha/24948/false taxes/alpha/85077/true',
  'the debit legs are normal parts and the Taxes credit a gross-up part on the same project');
select is((select count(*)::int from public.transactions where company_id = pg_temp.id('co') and description = 'pay'),
  1, 'no new line: the existing line was booked');
select is(pg_temp.pnl('txn_pay', 'taxes', 'alpha'), 60129::bigint, 'Taxes nets +60129 on Alpha (the contra credit wins)');
select is(pg_temp.pnl('txn_pay', 'build', 'beta'), -200000::bigint, 'Build is -200000 on Beta');
select is((select sum(amount_minor)::bigint from public.legs where transaction_id = pg_temp.id('txn_pay')), 0::bigint,
  'the booked line''s legs balance');
select is((public.mcp_line_legs(pg_temp.id('txn_pay'))->>'balanced') || '/'
  || jsonb_array_length(public.mcp_line_legs(pg_temp.id('txn_pay'))->'legs'),
  'true/4', 'get_line_legs reads the booking back: four balanced legs');
select is((select sum((l->>'amount_minor')::bigint)::bigint from jsonb_array_elements(public.mcp_line_legs(pg_temp.id('txn_pay'))->'legs') l
  where l->>'category_id' = pg_temp.id('taxes')::text), -60129::bigint, 'the Taxes legs net to a credit of 60129');

-- The same key replays; nothing is written twice.
select is((pg_temp.book('lg-a', 'txn_pay', jsonb_build_array(
  pg_temp.leg('bank', -139871), pg_temp.leg('build', 200000, 'beta'),
  pg_temp.leg('taxes', 24948, 'alpha'), pg_temp.leg('taxes', -85077, 'alpha')))->'data'->>'write_id'),
  (select r->'data'->>'write_id' from booked), 'the same idempotency key replays the booking');

-- (d) Undo restores the split before the booking.
select is(public.mcp_undo('lg-undo-a', 'line_split', pg_temp.id('txn_pay'))->>'ok', 'true', 'undo of the booking succeeds');
select is(pg_temp.parts_of('txn_pay'), 'build/beta/100000/false levy/alpha/39871/false', 'undo restores the prior split');
select is(pg_temp.pnl('txn_pay', 'taxes', 'alpha'), null, 'after undo Taxes is gone from the line');

-- ---------------------------------------------------------------------------
-- (b) An opposite-kind gross-up: an income credit on a payment, plus two Build legs that merge.
-- ---------------------------------------------------------------------------
select is(pg_temp.book('lg-b', 'txn_pay2', jsonb_build_array(
  pg_temp.leg('bank', -50000),
  pg_temp.leg('build', 30000, 'beta'),
  pg_temp.leg('build', 30000, 'beta'),
  pg_temp.leg('otherinc', -10000, 'alpha')))->>'ok', 'true', 'an income credit on a payment books');
select is(pg_temp.parts_of('txn_pay2'), 'build/beta/60000/false otherinc/alpha/10000/true',
  'same account, project and sign merge; the income credit is a gross-up part');
select is(pg_temp.pnl('txn_pay2', 'otherinc', 'alpha'), 10000::bigint, 'the gross-up income counts as +10000 income');
select is(pg_temp.pnl('txn_pay2', 'build', 'beta'), -60000::bigint, 'Build is -60000');

-- An income debit on a payment is a reversal part (normal): it needs a project, as split_line says.
select is(pg_temp.book('lg-b2', 'txn_pay3', jsonb_build_array(
  pg_temp.leg('bank', -40000), pg_temp.leg('build', 30000, 'beta'), pg_temp.leg('otherinc', 10000)))->'error'->>'message',
  'a reversal part needs a project', 'an income debit with no project is refused by the split rules');
-- A gross-up leg with no project takes the line's project (a normal one stays on the line, unnamed).
select is(pg_temp.book('lg-b3', 'txn_pay4', jsonb_build_array(
  pg_temp.leg('bank', -40000), pg_temp.leg('build', 50000), pg_temp.leg('taxes', -10000)))->>'ok',
  'true', 'a contra credit with no project books on the line''s project');
select is(pg_temp.parts_of('txn_pay4'), 'build/-/50000/false taxes/beta/10000/true',
  'the normal part stays unnamed, the gross-up part takes the line''s project');

-- ---------------------------------------------------------------------------
-- (c) Refusals.
-- ---------------------------------------------------------------------------
select is(pg_temp.book('lg-c1', 'txn_pay3', jsonb_build_array(
  pg_temp.leg('bank', -30000), pg_temp.leg('build', 20000, 'beta'), pg_temp.leg('taxes', 10000, 'alpha')))->'error'->>'message',
  'book_line: the bank leg must equal the line amount', 'a bank leg other than the line gross is refused');
select is(pg_temp.book('lg-c2', 'txn_pay3', jsonb_build_array(
  pg_temp.leg('bank', 40000), pg_temp.leg('build', -20000, 'beta'), pg_temp.leg('taxes', -20000, 'alpha')), 'income')->'error'->>'message',
  'book_line: direction does not match the line', 'a direction other than the line''s is refused');
select is(pg_temp.book('lg-c3', 'txn_vat', jsonb_build_array(
  pg_temp.leg('bank', -11700), pg_temp.leg('build', 5850, 'beta'), pg_temp.leg('taxes', 5850, 'alpha')))->'error'->>'message',
  'book_line: a line with VAT is a later phase', 'a line with VAT is refused');
select is(pg_temp.book('lg-c4', 'txn_rev', jsonb_build_array(
  pg_temp.leg('bank', -20000), pg_temp.leg('build', 10000, 'beta'), pg_temp.leg('taxes', 10000, 'alpha')))->'error'->>'message',
  'line has an open review', 'a line with an open review is refused, as split_line does');
select is(pg_temp.book('lg-c5', 'txn_loan', jsonb_build_array(
  pg_temp.leg('bank', -30000), pg_temp.leg('build', 10000, 'beta'), pg_temp.leg('taxes', 20000, 'alpha')))->'error'->>'message',
  'line has a loan split', 'a line with a loan split is refused, as split_line does');
select is(pg_temp.book('lg-c6', 'txn_foreign', jsonb_build_array(
  pg_temp.leg('bank', -139871), pg_temp.leg('build', 100000, 'beta'), pg_temp.leg('taxes', 39871, 'alpha')))->'error'->>'message',
  'transaction not found', 'another company''s line is not found');
select is(pg_temp.book('lg-c7', 'txn_pay3', jsonb_build_array(
  pg_temp.leg('bank', -40000), pg_temp.leg('taxes', 40000, 'alpha')))->'error'->>'message',
  'book_line: one category leg on an existing line — use assign_expense', 'one content leg on an existing line points to assign_expense');
select is(pg_temp.book('lg-c11', 'txn_keptline', jsonb_build_array(
  pg_temp.leg('bank', -20000), pg_temp.leg('build', 10000, 'beta'), pg_temp.leg('taxes', 10000, 'alpha')))->'error'->>'message',
  'book_line: the line is kept out of the P&L', 'a line kept out of the P&L is refused plainly');
select is(pg_temp.book('lg-c8', 'txn_pend', jsonb_build_array(
  pg_temp.leg('bank', -10000), pg_temp.leg('build', 5000, 'beta'), pg_temp.leg('taxes', 5000, 'alpha')))->'error'->>'message',
  'book_line: the line is not posted', 'a pending line is refused');
select is(public.mcp_book_line('lg-c9', '2026-06-10', 'expense', null, null, jsonb_build_array(
  pg_temp.leg('bank', -40000), pg_temp.leg('build', 20000, 'beta'), pg_temp.leg('taxes', 20000, 'alpha')), null, pg_temp.id('txn_pay3'))->'error'->>'code',
  'validation', 'doc_date with transaction_id is a validation error (the line keeps its own)');
select is(pg_temp.book('lg-c10', 'txn_pay3', jsonb_build_array(
  pg_temp.leg('bank', -40000), pg_temp.leg('build', 30000, 'beta'), pg_temp.leg('vat', 10000)))->'error'->>'message',
  'book_line: a VAT leg is a later phase', 'a VAT leg is refused');
select is(pg_temp.parts_of('txn_pay3'), null, 'none of the refusals wrote a part');

-- ---------------------------------------------------------------------------
-- (e) G5: the bridge account follows a rename and a keep-out, and its lines' legs follow the P&L.
-- ---------------------------------------------------------------------------
select is(public.mcp_rename_category('lg-ren', pg_temp.id('levy'), 'Levy Renamed')->>'ok', 'true', 'rename the Levy category');
select is((select name from public.accounts where id = pg_temp.id('a_levy')), 'Levy Renamed', 'the bridge account takes the new name');
select is((select x->>'name' from jsonb_array_elements(public.mcp_accounts()->'accounts') x where (x->>'id')::uuid = pg_temp.id('a_levy')),
  'Levy Renamed', 'list_accounts shows the new name');

-- The legs follow every in_pnl change: after each step the company's whole projection equals pnl_lines
-- (owned by and run as the test's superuser, a definer, so it reads every leg of the company).
reset role;
create function pg_temp.reconciled() returns boolean language sql security definer set search_path = '' as $$
  select (select coalesce(jsonb_agg(jsonb_build_object('t', transaction_id, 'c', category_id, 'p', project_id, 'n', n)
      order by transaction_id, category_id, project_id), '[]') from (
      select l.transaction_id, a.category_id, l.project_id, sum(-l.amount_minor)::bigint n
      from public.legs l join public.accounts a on a.id = l.account_id
      where l.company_id = pg_temp.id('co') and a.type in ('income', 'expense') group by 1, 2, 3) x)
    = (select coalesce(jsonb_agg(jsonb_build_object('t', transaction_id, 'c', category_id, 'p', project_id, 'n', n)
      order by transaction_id, category_id, project_id), '[]') from (
      select transaction_id, category_id, project_id, sum(amount_net)::bigint n
      from private.pnl_lines where company_id = pg_temp.id('co') and in_pnl and kind in ('income', 'expense')
      group by 1, 2, 3) x)
$$;
grant execute on function pg_temp.reconciled() to authenticated;
select pg_temp.as_mcp();
select ok(pg_temp.reconciled(), 'the legs project exactly to pnl_lines after the bookings, undo and rename');

select is(public.mcp_set_category_pnl('lg-out', pg_temp.id('levy'), true)->>'ok', 'true', 'keep Levy out of the P&L (MCP)');
select is((select excluded_from_pnl from public.accounts where id = pg_temp.id('a_levy')), true,
  'the bridge account is kept out too');
select is((select count(*)::int from public.legs where account_id = pg_temp.id('a_levy')), 0,
  'the line split onto Levy no longer has a leg on its income/expense bridge');
select is((select sum(amount_minor)::bigint from public.legs where transaction_id = pg_temp.id('txn_pay')), 0::bigint,
  'that line''s re-derived legs still balance');
select ok(pg_temp.reconciled(), 'kept out by set_category_pnl: the projection still equals pnl_lines');
select is(pg_temp.book('lg-e1', 'txn_pay3', jsonb_build_array(
  pg_temp.leg('bank', -40000), pg_temp.leg('build', 30000, 'beta'), pg_temp.leg('levy', 10000, 'alpha')))->>'ok',
  'true', 'book_line reads the live category: a kept-out one books on its balance-sheet account (FLOW-953)');

select is(public.mcp_undo('lg-undo-out', 'category_pnl', pg_temp.id('levy'))->>'ok', 'true', 'undo puts Levy back in the P&L');
select is((select sum(amount_minor)::bigint from public.legs where account_id = pg_temp.id('a_levy') and transaction_id = pg_temp.id('txn_pay')),
  39871::bigint, 'the Levy part''s leg is back on its bridge');
select ok(pg_temp.reconciled(), 'after the undo: the projection still equals pnl_lines');

-- The app's RPC on a whole-line category (Build files most lines whole), out and back.
select lives_ok($$ select public.set_category_excluded_from_pnl(pg_temp.id('build'), true) $$, 'keep Build out (app RPC)');
select ok(pg_temp.reconciled() and (select count(*) = 0 from public.legs where account_id = pg_temp.id('a_build')),
  'Build kept out: no leg on its bridge, and the projection equals pnl_lines');
select lives_ok($$ select public.set_category_excluded_from_pnl(pg_temp.id('build'), false) $$, 'put Build back (app RPC)');
select ok(pg_temp.reconciled() and (select count(*) > 0 from public.legs where account_id = pg_temp.id('a_build')),
  'Build back in: its legs return, and the projection equals pnl_lines');

select * from finish();
rollback;
