-- FLOW-955 (decision 0208). The journal entry composer and the review of Jev's bookings:
-- save_line_journal books the caller's existing line from legs through book_line's rules (and the
-- parts before come back through save_line_split); get_line_journal_suggestion and
-- get_line_journal_copies start an entry from the same party's booked lines, scaled to the cent with
-- the remainder on the largest leg; list_jev_bookings / approve_jev_booking / undo_jev_booking review
-- what an MCP write booked. Company scoped throughout. Invented books only; USD cents.

begin;
select plan(56);

do $u$ begin
  perform tests.create_supabase_user('lc_owner', 'lc-owner@example.com');
  perform tests.create_supabase_user('lc_other', 'lc-other@example.com');
  perform tests.create_supabase_user('lc_viewer', 'lc-viewer@example.com');
end $u$;

insert into public.companies (owner_id, name, is_demo) values
  (tests.get_supabase_uid('lc_owner'), 'Example Composer LLC', false),
  (tests.get_supabase_uid('lc_other'), 'Example Other Composer LLC', false);

create temp table lc (label text primary key, id uuid);
grant all on lc to authenticated, service_role;
insert into lc select 'co', id from public.companies where name = 'Example Composer LLC';
insert into lc select 'other_co', id from public.companies where name = 'Example Other Composer LLC';

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.lc where label = p_label
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into public.company_members (company_id, user_id, role)
values (pg_temp.id('co'), tests.get_supabase_uid('lc_viewer'), 'viewer');

insert into public.projects (company_id, name, status)
select pg_temp.id('co'), v.n, 'active' from (values ('Alpha'), ('Beta'), ('Gamma')) v(n);
insert into lc select lower(name), id from public.projects where company_id = pg_temp.id('co');

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
select pg_temp.id('co'), v.name, v.kind::public.category_kind, 90, false, v.ex
from (values ('Closing', 'expense', false), ('Fees', 'expense', false), ('Proceeds', 'income', true),
  ('Interest', 'expense', false)) v(name, kind, ex);
insert into lc select lower(name), id from public.categories where company_id = pg_temp.id('co') and sort_order = 90;
insert into lc select 'a_' || c.label, a.id from public.accounts a join lc c on c.id = a.category_id;
insert into lc select 'a_bank', id from public.accounts where company_id = pg_temp.id('co') and name = 'Bank/Clearing';
insert into lc select 'a_other_bank', id from public.accounts where company_id = pg_temp.id('other_co') and name = 'Bank/Clearing';

insert into public.suppliers (company_id, name) values
  (pg_temp.id('co'), 'Example Lender'), (pg_temp.id('co'), 'Example Shop'), (pg_temp.id('other_co'), 'Example Lender');
insert into lc select 'lender', id from public.suppliers where company_id = pg_temp.id('co') and name = 'Example Lender';
insert into lc select 'shop', id from public.suppliers where company_id = pg_temp.id('co') and name = 'Example Shop';
insert into lc select 'other_lender', id from public.suppliers where company_id = pg_temp.id('other_co');

-- A posted line of a supplier, filed to a category on a project.
create function pg_temp.line(p_key text, p_company text, p_dir text, p_gross bigint, p_category text,
  p_supplier text, p_date date, p_project text default 'alpha') returns void
language sql as $$
  insert into public.transactions (
    company_id, direction, doc_kind, pnl_role, line_status, currency,
    amount_gross, amount_net, amount_original, vat_amount, vat_status,
    doc_date, cash_date, source, idempotency_key, project_id, category_id, supplier_id, description, user_assigned
  )
  values (pg_temp.id(p_company), p_dir::public.txn_direction, 'receipt', 'project', 'posted', 'USD',
    p_gross, p_gross, abs(p_gross), 0, 'source', p_date, p_date, 'manual', 'lc:' || p_key,
    case when p_company = 'co' then pg_temp.id(p_project) end,
    case when p_company = 'co' then pg_temp.id(p_category) end, pg_temp.id(p_supplier), p_key, true);
  insert into pg_temp.lc select 'txn_' || p_key, id from public.transactions where idempotency_key = 'lc:' || p_key;
$$;

create function pg_temp.split(p_line text, p_parts jsonb) returns void language sql as $$
  select tests.line_split(pg_temp.id(p_line), (
    select jsonb_agg(jsonb_build_object('category_id', pg_temp.id(e->>'c'), 'project_id', pg_temp.id(e->>'p'),
      'amount_minor', (e->>'n')::bigint, 'gross_up', coalesce((e->>'g')::boolean, false)) order by o)
    from jsonb_array_elements(p_parts) with ordinality x(e, o)));
$$;

-- The lender's history: three loans booked as proceeds 103% of the deposit less closing costs 3%
-- (one on Beta), and one older one booked another way (fees). Bank in, so the bank leg is a debit.
select pg_temp.line('h1', 'co', 'income', 15000000, 'proceeds', 'lender', '2026-08-02', 'beta');
select pg_temp.split('txn_h1', '[{"c":"proceeds","p":"beta","n":15450000},{"c":"closing","p":"beta","n":450000,"g":true}]');
select pg_temp.line('h2', 'co', 'income', 18000000, 'proceeds', 'lender', '2026-05-11');
select pg_temp.split('txn_h2', '[{"c":"proceeds","p":"alpha","n":18540000},{"c":"closing","p":"alpha","n":540000,"g":true}]');
select pg_temp.line('h3', 'co', 'income', 12000000, 'proceeds', 'lender', '2026-01-20');
select pg_temp.split('txn_h3', '[{"c":"proceeds","p":"alpha","n":12360000},{"c":"closing","p":"alpha","n":360000,"g":true}]');
select pg_temp.line('h4', 'co', 'income', 10000000, 'proceeds', 'lender', '2025-12-01');
select pg_temp.split('txn_h4', '[{"c":"proceeds","p":"alpha","n":10100000},{"c":"fees","p":"alpha","n":100000,"g":true}]');
-- A plain (one-category) lender line: not a booking to start from.
select pg_temp.line('plain', 'co', 'income', 5000000, 'proceeds', 'lender', '2026-09-01');
-- The new loan on Gamma, $200,000.01, and a shop line with no history.
select pg_temp.line('new', 'co', 'income', 20000001, 'proceeds', 'lender', '2026-10-16', 'gamma');
select pg_temp.line('shop', 'co', 'expense', -10000, 'fees', 'shop', '2026-10-01');
select pg_temp.line('foreign', 'other_co', 'income', 20000000, 'proceeds', 'other_lender', '2026-10-16', 'alpha');

-- ---------------------------------------------------------------------------
-- The scaling: each leg to the cent, the remainder on the largest leg.
-- ---------------------------------------------------------------------------
select is(private.scale_entry('[{"amount_minor":3333},{"amount_minor":3333},{"amount_minor":3334}]', -10000, -10001),
  '[{"amount_minor":3333},{"amount_minor":3333},{"amount_minor":3335}]'::jsonb,
  'one cent over: rounding leaves +1 and the largest leg takes it');
select is(private.scale_entry('[{"amount_minor":3335},{"amount_minor":3335},{"amount_minor":3330}]', -10000, -10002),
  '[{"amount_minor":3335},{"amount_minor":3336},{"amount_minor":3331}]'::jsonb,
  'every leg rounds up, one cent too many: the first of the largest gives it back');
select is(private.scale_entry('[{"amount_minor":450000},{"amount_minor":-15450000}]', 15000000, 20000000),
  '[{"amount_minor":600000},{"amount_minor":-20600000}]'::jsonb, 'an exact scale needs no remainder');
select is(private.scale_entry('[{"amount_minor":100},{"amount_minor":-200}]', 100, -100), null,
  'a bank amount of the other sign scales nothing');
select is(private.scale_entry('[{"amount_minor":1},{"amount_minor":-10001}]', 10000, 100), null,
  'a leg that would reach zero scales nothing');

select tests.authenticate_as('lc_owner');

-- ---------------------------------------------------------------------------
-- ✦ הצעה של Jev: the most common shape, scaled to this line.
-- ---------------------------------------------------------------------------
create temp table sug as select public.get_line_journal_suggestion(pg_temp.id('txn_new')) as s;
select is((select s->>'party_name' from sug), 'Example Lender', 'the suggestion names the party');
select is((select (s->>'basis_count')::int from sug), 3, 'it rests on the three loans of one shape (not the fees one, not the plain line)');
select is((select s->>'source_transaction_id' from sug), pg_temp.id('txn_h1')::text, 'the amounts come from the newest line of that shape');
select is((select (e->>'amount_minor')::bigint from sug, jsonb_array_elements(s->'legs') e where e->>'account_id' = pg_temp.id('a_closing')::text),
  600000::bigint, 'closing costs scale from 3% of $150,000 to $6,000.00 (600000.0003 rounds down)');
select is((select (e->>'amount_minor')::bigint from sug, jsonb_array_elements(s->'legs') e where e->>'account_id' = pg_temp.id('a_proceeds')::text),
  -20600001::bigint, 'the proceeds leg (the largest) takes the cent: the entry balances');
select is((select 20000001 + sum((e->>'amount_minor')::bigint) from sug, jsonb_array_elements(s->'legs') e), 0::numeric,
  'bank + legs = 0');
select is((select string_agg(distinct e->>'project_name', ',') from sug, jsonb_array_elements(s->'legs') e),
  'Gamma', 'an entry on one project takes this line''s project');
select is(public.get_line_journal_suggestion(pg_temp.id('txn_shop')), null, 'a party with no booked split: no suggestion');
select is(public.get_line_journal_suggestion(pg_temp.id('txn_foreign')), null, 'another company''s line: null');

-- ---------------------------------------------------------------------------
-- כמו תנועה קודמת: the party's booked lines, newest first, each scaled.
-- ---------------------------------------------------------------------------
create temp table cp as select public.get_line_journal_copies(pg_temp.id('txn_new')) as c;
select is((select jsonb_array_length(c->'lines') from cp), 4, 'four booked lines with a split (the plain line is not one)');
select is((select c->'lines'->0->>'transaction_id' from cp), pg_temp.id('txn_h1')::text, 'newest first');
select is((select jsonb_array_length(c->'lines'->0->'legs') from cp), 3, 'each with its legs as booked (bank and two)');
select is((select (e->>'amount_minor')::bigint from cp, jsonb_array_elements(c->'lines'->3->'scaled') e
  where e->>'account_id' = pg_temp.id('a_fees')::text), 200000::bigint, 'the fees line scales its 1% to $2,000.00');
select is((select 20000001 + sum((e->>'amount_minor')::bigint) from cp, jsonb_array_elements(c->'lines'->3->'scaled') e), 0::numeric,
  'a copied entry balances against this line');
select is(public.get_line_journal_copies(pg_temp.id('txn_foreign')), null, 'another company''s line: null');
select is(public.get_line_journal_copies(pg_temp.id('txn_shop'))->'lines', '[]'::jsonb, 'no history: no lines');

-- ---------------------------------------------------------------------------
-- save_line_journal: the app books the line through book_line's rules.
-- ---------------------------------------------------------------------------
create function pg_temp.leg(p_account text, p_amount bigint, p_project text default null) returns jsonb
language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('account_id', pg_temp.id(p_account), 'amount_minor', p_amount,
    'project_id', pg_temp.id(p_project)))
$$;
grant execute on function pg_temp.leg(text, bigint, text) to authenticated, service_role;

create temp table saved as select public.save_line_journal(pg_temp.id('txn_new'), jsonb_build_array(
  pg_temp.leg('a_bank', 20000001), pg_temp.leg('a_closing', 600000, 'gamma'), pg_temp.leg('a_proceeds', -20600001, 'gamma'))) as r;
select is((select r->'before' from saved), '[]'::jsonb, 'the line had no split before');
select is((select jsonb_array_length(r->'parts') from saved), 2, 'the booking saved two parts');
select is((select sum(amount_minor)::bigint from public.legs where transaction_id = pg_temp.id('txn_new')), 0::bigint,
  'the booked line''s legs balance');
select is((select count(*)::int from public.legs l where l.transaction_id = pg_temp.id('txn_new') and l.account_id = pg_temp.id('a_closing')),
  1, 'the closing costs leg is in the ledger');
select is(public.get_line_journal(pg_temp.id('txn_new'))->>'booked_by_ai', 'false', 'a person''s booking is not Jev''s');
-- ביטול: the parts before go back through save_line_split (empty clears the split).
select is(jsonb_array_length(public.save_line_split(pg_temp.id('txn_new'), '[]'::jsonb)), 0, 'the app''s ביטול clears the split');
select is((select count(*)::int from private.split_parts where transaction_id = pg_temp.id('txn_new')), 0, 'the line is plain again');

select throws_ok($$ select public.save_line_journal(pg_temp.id('txn_new'), jsonb_build_array(
  pg_temp.leg('a_bank', 20000001), pg_temp.leg('a_closing', 600000), pg_temp.leg('a_proceeds', -20600000))) $$,
  'legs do not balance', 'an unbalanced entry is refused');
select throws_ok($$ select public.save_line_journal(pg_temp.id('txn_new'), jsonb_build_array(
  pg_temp.leg('a_bank', 20000001), pg_temp.leg('a_proceeds', -20000001))) $$,
  'book_line: one category leg on an existing line — use assign_expense', 'one leg on an existing line is an assignment');
select throws_ok($$ select public.save_line_journal(pg_temp.id('txn_new'), jsonb_build_array(
  pg_temp.leg('a_bank', 100), pg_temp.leg('a_closing', 100), pg_temp.leg('a_proceeds', -200))) $$,
  'book_line: the bank leg must equal the line amount', 'the bank leg is the line''s amount');
select throws_ok($$ select public.save_line_journal(pg_temp.id('txn_new'), '{}'::jsonb) $$,
  'validation', 'legs must be an array');
-- The composer edits a booked line on book_line's accounts: a kept-out leg (Proceeds posts to Suspense)
-- comes back on its category's own account, so the entry saves again as it is.
select is((select e->>'book_account_id' from jsonb_array_elements(public.get_line_journal(pg_temp.id('txn_h1'))->'legs') e
  where (e->>'amount_minor')::bigint = -15450000), pg_temp.id('a_proceeds')::text, 'a kept-out leg is edited on its category''s account');
select is(jsonb_array_length(public.save_line_journal(pg_temp.id('txn_h1'), (
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('account_id', e->>'book_account_id',
    'amount_minor', (e->>'amount_minor')::bigint, 'project_id', e->>'project_id')))
  from jsonb_array_elements(public.get_line_journal(pg_temp.id('txn_h1'))->'legs') e))->'parts'), 2,
  'the booked entry saves again unchanged');
select tests.authenticate_as('lc_viewer');
select throws_ok($$ select public.save_line_journal(pg_temp.id('txn_new'), jsonb_build_array(
  pg_temp.leg('a_bank', 20000001), pg_temp.leg('a_closing', 600000), pg_temp.leg('a_proceeds', -20600001))) $$,
  '42501', 'forbidden', 'a viewer cannot book');
select tests.authenticate_as('lc_owner');
select throws_ok($$ select public.save_line_journal(pg_temp.id('txn_foreign'), jsonb_build_array(
  pg_temp.leg('a_other_bank', 20000000), pg_temp.leg('a_closing', 100), pg_temp.leg('a_proceeds', -20000100))) $$,
  'transaction not found', 'another company''s line is not found');

-- ---------------------------------------------------------------------------
-- Jev's bookings: an MCP book_line on an existing line waits in לאישור.
-- ---------------------------------------------------------------------------
reset role;
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('lc_owner'), pg_temp.id('co'), 'hash-lc-write', 'kid', array['read', 'write']::text[], '2099-01-01');
insert into lc select 'write', id from private.mcp_credentials where token_hash = 'hash-lc-write';

create function pg_temp.as_mcp() returns void language plpgsql set search_path = '' as $$
declare uid uuid := tests.get_supabase_uid('lc_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1',
    'mcp_tid', pg_temp.id('write'))::text, true);
end $$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

set local role authenticated;
select pg_temp.as_mcp();
select is(public.mcp_book_line('lc-jev-1', null, 'income', null, null, jsonb_build_array(
  pg_temp.leg('a_bank', 20000001), pg_temp.leg('a_closing', 600000, 'gamma'), pg_temp.leg('a_proceeds', -20600001, 'gamma')),
  null, pg_temp.id('txn_new'))->>'ok', 'true', 'Jev books the new loan');
select is(public.mcp_book_line('lc-jev-2', null, 'expense', null, null, jsonb_build_array(
  pg_temp.leg('a_bank', -10000), pg_temp.leg('a_fees', 6000), pg_temp.leg('a_interest', 4000)),
  null, pg_temp.id('txn_shop'))->>'ok', 'true', 'and the shop line');

select tests.authenticate_as('lc_owner');
create temp table jb as select public.list_jev_bookings() as l;
select is((select jsonb_array_length(l) from jb), 2, 'both bookings wait for review');
select is((select l->0->>'transaction_id' from jb), pg_temp.id('txn_new')::text, 'oldest first');
select is((select l->0->>'party' || '/' || (l->0->>'kind') from jb), 'Example Lender/line_split', 'named by the party, booked on the existing line');
select is((select jsonb_array_length(l->0->'journal'->'legs') from jb), 3, 'with the proposed entry');
select is((select l->0->'journal'->>'booked_by_ai' from jb), 'true', 'which reads as Jev''s');

-- אישור keeps it and leaves the queue.
select is(public.approve_jev_booking(pg_temp.id('txn_new'))->>'reviewed', 'true', 'אישור marks it reviewed');
select is(jsonb_array_length(public.list_jev_bookings()), 1, 'one booking left');
select throws_ok($$ select public.approve_jev_booking(pg_temp.id('txn_new')) $$,
  'booking not found', 'an approved booking is not approved twice');

-- A viewer sees the queue but cannot act on it.
select tests.authenticate_as('lc_viewer');
select is(jsonb_array_length(public.list_jev_bookings()), 1, 'a viewer reads the queue');
select throws_ok($$ select public.undo_jev_booking(pg_temp.id('txn_shop')) $$,
  '42501', 'forbidden', 'a viewer cannot undo');

-- Another company sees none of it.
select tests.authenticate_as('lc_other');
select is(public.list_jev_bookings(), '[]'::jsonb, 'another company lists none of the bookings');
select throws_ok($$ select public.undo_jev_booking(pg_temp.id('txn_shop')) $$,
  'booking not found', 'another company cannot undo one');

-- ביטול takes the booking back: the shop line returns to its plain category.
select tests.authenticate_as('lc_owner');
select is(public.undo_jev_booking(pg_temp.id('txn_shop'))->>'undone', 'true', 'ביטול undoes Jev''s booking');
select is((select count(*)::int from private.split_parts where transaction_id = pg_temp.id('txn_shop')), 0,
  'the shop line is plain again (normal assignment)');
select is(public.list_jev_bookings(), '[]'::jsonb, 'the queue is empty');

-- A booking the owner changed since is no longer Jev's: it leaves the queue and ביטול keeps the change.
set local role authenticated;
select pg_temp.as_mcp();
create temp table jev3 as select public.mcp_book_line('lc-jev-3', null, 'income', null, null, jsonb_build_array(
  pg_temp.leg('a_bank', 20000001), pg_temp.leg('a_closing', 500000, 'gamma'), pg_temp.leg('a_proceeds', -20500001, 'gamma')),
  null, pg_temp.id('txn_new')) as r;
select tests.authenticate_as('lc_owner');
select is(jsonb_array_length(public.save_line_journal(pg_temp.id('txn_new'), jsonb_build_array(
  pg_temp.leg('a_bank', 20000001), pg_temp.leg('a_fees', 400000, 'gamma'), pg_temp.leg('a_proceeds', -20400001, 'gamma')))->'parts'),
  2, 'the owner books the line another way');
select is(public.list_jev_bookings(), '[]'::jsonb, 'Jev''s booking no longer stands, so it does not wait');
select throws_ok($$ select public.undo_jev_booking(pg_temp.id('txn_new')) $$,
  'line changed since', 'ביטול refuses a line changed since');

select * from finish();
rollback;
