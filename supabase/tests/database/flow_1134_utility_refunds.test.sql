-- FLOW-1134 (decision 0265): utility bills the tenant never paid back. The match on read (the three
-- amount rules, the window, the category rule for auto), the owner's answers (matched, rejected, seen,
-- taken back), who pays, a month with no rent, mark all as seen, the refile and its undo, the MCP writes
-- and their undo, a viewer and another company refused. Every read passes its as-of date.
-- Invented names, ids and @example.com emails only. Amounts are agorot.

begin;

select plan(117);

do $users$
begin
  perform tests.create_supabase_user('ur_owner', 'ur-owner@example.com');
  perform tests.create_supabase_user('ur_editor', 'ur-editor@example.com');
  perform tests.create_supabase_user('ur_viewer', 'ur-viewer@example.com');
  perform tests.create_supabase_user('ur_outsider', 'ur-outsider@example.com');
end
$users$;

create temp table ur (label text primary key, id uuid);
grant all on ur to authenticated, service_role;
create function pg_temp.uid(p_label text) returns uuid language sql as $$ select id from pg_temp.ur where label = p_label; $$;
grant execute on function pg_temp.uid(text) to authenticated, service_role;

insert into ur (label, id) values
  ('co', tests.fixture_company('ur_owner', 'Example Utility Books')),
  ('other', tests.fixture_company('ur_outsider', 'Example Other Books')),
  ('owner', tests.get_supabase_uid('ur_owner')),
  ('editor', tests.get_supabase_uid('ur_editor')),
  ('viewer', tests.get_supabase_uid('ur_viewer'));
insert into public.company_members (company_id, user_id, role) values
  (pg_temp.uid('co'), pg_temp.uid('editor'), 'editor'),
  (pg_temp.uid('co'), pg_temp.uid('viewer'), 'viewer');
insert into public.active_companies (user_id, company_id) values
  (pg_temp.uid('editor'), pg_temp.uid('co')),
  (pg_temp.uid('viewer'), pg_temp.uid('co'));

-- The categories: חשבונות with חשמל ומים and גז under it, the rent and another income.
insert into ur (label, id) values
  ('bills', tests.fixture_category(pg_temp.uid('co'), 'חשבונות')),
  ('power', tests.fixture_category(pg_temp.uid('co'), 'חשמל ומים')),
  ('gas', tests.fixture_category(pg_temp.uid('co'), 'גז')),
  ('rent', tests.fixture_category(pg_temp.uid('co'), 'שכירות', 'income')),
  ('other_income', tests.fixture_category(pg_temp.uid('co'), 'Example other income', 'income')),
  ('oak', tests.fixture_project(pg_temp.uid('co'), 'Example Oak House')),
  ('elm', tests.fixture_project(pg_temp.uid('co'), 'Example Elm House')),
  ('birch', tests.fixture_project(pg_temp.uid('co'), 'Example Birch House')),
  ('far', tests.fixture_project(pg_temp.uid('other'), 'Example Far House'));
update public.categories set parent_id = pg_temp.uid('bills') where id in (pg_temp.uid('power'), pg_temp.uid('gas'));
create temp table ur_suppliers (label text, company text, name text);
insert into ur_suppliers values ('electric', 'co', 'Example Power Co'), ('gasco', 'co', 'Example Gas Co'),
  ('water', 'co', 'Example Water Co'), ('net', 'co', 'Example Net Co'), ('trash', 'co', 'Example Trash Co'), ('far_supplier', 'other', 'Example Far Co');
with made as (
  insert into public.suppliers (company_id, name)
  select pg_temp.uid(v.company), v.name from ur_suppliers v
  returning id, name
)
insert into ur (label, id) select v.label, m.id from made m join ur_suppliers v on v.name = m.name;

-- label, direction, project, category, supplier, date, amount.
create temp table ur_lines (label text, direction text, project text, category text, supplier text, doc_date date, amount bigint);
insert into ur_lines values
  -- Oak's rent, 200000 a month (its usual rent).
  ('rent1', 'income', 'oak', 'rent', null, '2026-01-01', 200000),
  ('rent2', 'income', 'oak', 'rent', null, '2026-02-01', 200000),
  ('rent3', 'income', 'oak', 'rent', null, '2026-03-01', 200000),
  ('rent4', 'income', 'oak', 'rent', null, '2026-04-01', 200000),
  ('rent5', 'income', 'oak', 'rent', null, '2026-05-01', 200000),
  -- Rule 1, auto: the bill's amount within one unit, filed to the bill's category.
  ('e1', 'expense', 'oak', 'power', 'electric', '2026-03-05', 10000),
  ('pe1', 'income', 'oak', 'power', null, '2026-03-20', 10050),
  -- Rule 1 in another category, on no property: a suggestion.
  ('g1', 'expense', 'oak', 'gas', 'gasco', '2026-03-10', 7000),
  ('pg1', 'income', null, 'other_income', null, '2026-03-25', 7000),
  -- Rule 2 with two categories: a suggestion.
  ('e0', 'expense', 'oak', 'power', 'electric', '2026-01-10', 6000),
  ('g0', 'expense', 'oak', 'gas', 'gasco', '2026-01-12', 2000),
  ('p0', 'income', 'oak', 'power', null, '2026-01-25', 8000),
  -- Rule 2, auto: two bills of April together, both in the payment's category.
  ('e2', 'expense', 'oak', 'power', 'electric', '2026-04-05', 8000),
  ('g2', 'expense', 'oak', 'power', 'gasco', '2026-04-08', 4000),
  ('p2', 'income', 'oak', 'power', null, '2026-04-20', 12000),
  -- Rule 3: the usual rent plus May's bill, filed as rent: a suggestion.
  ('e3', 'expense', 'oak', 'power', 'electric', '2026-05-05', 9000),
  ('p3', 'income', 'oak', 'rent', null, '2026-06-01', 209000),
  -- The window: a payment more than a month before the bill, and one after the as-of date.
  ('w1', 'expense', 'oak', 'power', 'water', '2026-02-10', 5000),
  ('pw_early', 'income', 'oak', 'power', null, '2026-01-05', 5000),
  ('pw_late', 'income', 'oak', 'power', null, '2026-07-05', 5000),
  -- 20 days old on 2026-06-30: waiting; 35 days on 2026-07-15: not refunded.
  ('e4', 'expense', 'oak', 'power', 'electric', '2026-06-10', 9500),
  -- Elm has no rent: its bills are flagged. The gas is company-paid.
  ('elm_e', 'expense', 'elm', 'power', 'electric', '2026-03-15', 6000),
  ('elm_e2', 'expense', 'elm', 'power', 'electric', '2026-04-15', 6100),
  ('elm_g', 'expense', 'elm', 'gas', 'gasco', '2026-03-20', 3000),
  -- Internet is not filed under חשבונות: not a utility until the owner adds it.
  ('net1', 'expense', 'elm', 'other_expense', 'net', '2026-03-22', 2500),
  -- The guards the tests above rely on: a payment on another property of the bill's amount (the property
  -- guard; w1 must stay not refunded), one 101 off (the tolerance), and a rule 3 payment filed in the bill's
  -- category (rule 3 is never counted by itself: e3 stays a suggestion on p3).
  ('elm_pay', 'income', 'elm', 'power', null, '2026-02-15', 5000),
  ('pw_near', 'income', 'oak', 'power', null, '2026-02-20', 5101),
  ('p3b', 'income', 'oak', 'power', null, '2026-06-02', 209000),
  -- Birch: the rent plus two bills of two categories in one payment (rule 3), for the refile in two parts.
  ('brent1', 'income', 'birch', 'rent', null, '2026-04-01', 150000),
  ('brent2', 'income', 'birch', 'rent', null, '2026-05-01', 150000),
  ('be', 'expense', 'birch', 'power', 'electric', '2026-05-03', 4000),
  ('bg', 'expense', 'birch', 'gas', 'gasco', '2026-05-04', 3000),
  ('pb', 'income', 'birch', 'rent', null, '2026-05-28', 157000),
  -- An ILS payment of a USD bill's amount (the currency guard: trash1 below is USD).
  ('trash_pay', 'income', 'elm', 'other_income', null, '2026-06-22', 7777);
insert into ur (label, id) values ('other_expense', tests.fixture_category(pg_temp.uid('co'), 'Example other expense'));
insert into ur (label, id)
select l.label, tests.fixture_line(pg_temp.uid('co'), 'ur:' || l.label, l.amount, l.direction,
  pg_temp.uid(l.project), pg_temp.uid(l.category), l.doc_date)
from ur_lines l;
update public.transactions t set supplier_id = pg_temp.uid(l.supplier)
from ur_lines l where t.id = pg_temp.uid(l.label) and l.supplier is not null;
-- The card-name rule (decision 0262): a Mercury card named after Elm with a utilities word makes its
-- supplier a utility of Elm, wherever the line is filed; a card with no utilities word does not.
insert into public.connector_connections (
  company_id, provider, slot, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_ref, kek_version, envelope_version,
  card_labels
) values (pg_temp.uid('co'), 'mercury', 1, '\x01', '\x0201', '\x03', '\x0401', 'MERCURY_KEK', '1', '3',
  '[{"last4": "1234", "label": "Example Elm House Utilities"}, {"last4": "5678", "label": "Example Elm House Card"}]');
insert into ur (label, id) values
  ('trash1', tests.fixture_line(pg_temp.uid('co'), 'ur:trash1', 7777, 'expense', pg_temp.uid('elm'), pg_temp.uid('other_expense'),
    '2026-06-20', 'USD', 'posted', 'mercury', 'project', 'expense')),
  ('net_card', tests.fixture_line(pg_temp.uid('co'), 'ur:net_card', 4444, 'expense', pg_temp.uid('elm'), pg_temp.uid('other_expense'),
    '2026-06-21', 'USD', 'posted', 'mercury', 'project', 'expense'));
update public.transactions set supplier_id = pg_temp.uid('trash'), provider_meta = '{"card_last4": "1234"}'
where id = pg_temp.uid('trash1');
update public.transactions set supplier_id = pg_temp.uid('net'), provider_meta = '{"card_last4": "5678"}'
where id = pg_temp.uid('net_card');
insert into ur (label, id) values
  ('far_bill', tests.fixture_line(pg_temp.uid('other'), 'ur:far', 4000, 'expense', pg_temp.uid('far'), null, '2026-03-01'));

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at) values
  (pg_temp.uid('owner'), pg_temp.uid('co'), 'hash-ur-owner', 'kid', array['read', 'write']::text[], '2099-01-01'),
  (pg_temp.uid('owner'), pg_temp.uid('co'), 'hash-ur-read', 'kid', array['read']::text[], '2099-01-01'),
  (pg_temp.uid('owner'), pg_temp.uid('co'), 'hash-ur-old', 'kid', array['read', 'write']::text[], '2020-01-01');
insert into ur (label, id)
select replace(token_hash, 'hash-ur-', 'tok-'), id from private.mcp_credentials where token_hash like 'hash-ur-%';

create or replace function pg_temp.as_mcp(p_user text, p_token text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := pg_temp.uid(p_user);
  tid uuid := pg_temp.uid(p_token);
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text, text) to authenticated, service_role;

-- A bill's row in the full list as of a date, and its "state[/rule][>payment]" summary.
create or replace function pg_temp.bill(p_label text, p_today date)
returns jsonb
language sql
as $$
  select b from jsonb_array_elements(public.list_utility_refunds(null, p_today, true)->'bills') b
  where (b->>'bill_transaction_id')::uuid = pg_temp.uid(p_label);
$$;
create or replace function pg_temp.st(p_label text, p_today date default '2026-06-30')
returns text
language sql
as $$
  select coalesce(b->>'state', 'absent')
    || coalesce('/' || (b->>'rule'), '')
    || coalesce('>' || (select x.label from pg_temp.ur x where x.id = (b->'payment'->>'transaction_id')::uuid), '')
  from (select pg_temp.bill(p_label, p_today) as b) q;
$$;
grant execute on function pg_temp.bill(text, date) to authenticated;
grant execute on function pg_temp.st(text, date) to authenticated;

select tests.authenticate_as('ur_owner');

-- The match.
select is(pg_temp.st('e1'), 'refunded/bill>pe1', 'rule 1 in the bill''s category counts by itself');
select is(pg_temp.bill('e1', '2026-06-30')->>'source', 'auto', 'it is counted by Flow (source auto)');
select is(pg_temp.st('g1'), 'suggested/bill>pg1', 'rule 1 in another category, on no property, is a suggestion');
select is(pg_temp.bill('g1', '2026-06-30')->>'wrong_category', 'true', 'the suggested payment is flagged as filed elsewhere');
select is(pg_temp.st('e2') || ' ' || pg_temp.st('g2'), 'refunded/bills>p2 refunded/bills>p2',
  'rule 2: two bills of the month together, all in the payment''s category, count by themselves');
select is(pg_temp.st('e0') || ' ' || pg_temp.st('g0'), 'suggested/bills>p0 suggested/bills>p0',
  'rule 2 with bills in two categories is a suggestion');
select is(jsonb_array_length(pg_temp.bill('e2', '2026-06-30')->'group_bill_transaction_ids'), 2, 'the group names both bills');
select is(pg_temp.st('e3'), 'suggested/rent_and_bills>p3', 'rule 3: the usual rent plus the bill is always a suggestion');
select is(pg_temp.st('w1'), 'not_refunded', 'a payment more than a month before the bill, or after the as-of date, does not count');
select is(pg_temp.st('w1', '2026-07-10'), 'refunded/bill>pw_late', 'the late payment counts once the as-of date reaches it');
select is(pg_temp.st('e4'), 'waiting', 'a bill 20 days old with no refund is still waiting');
select is(pg_temp.st('e4', '2026-07-15'), 'not_refunded', 'after 30 days it is not refunded');
select is(pg_temp.bill('elm_e', '2026-06-30')->>'no_rent', 'true', 'a month with no rent on the property is flagged');
select is(pg_temp.bill('e1', '2026-06-30')->>'no_rent', 'false', 'a month with rent is not');
select is(pg_temp.st('net1'), 'absent', 'a supplier not filed under חשבונות is not a utility');
select is(pg_temp.st('elm_g'), 'not_refunded', 'a utility is tenant-paid by default');
select is(pg_temp.st('rent1'), 'absent', 'income lines are not bills');
select is(pg_temp.st('trash1'), 'waiting', 'a line paid with a card named after the property and utilities makes a utility');
select is(pg_temp.st('net_card'), 'absent', 'a card named after the property with no utilities word does not');
select is(pg_temp.st('trash1', '2026-07-30'), 'not_refunded', 'an ILS payment never refunds a USD bill');
select is(pg_temp.st('be') || ' ' || pg_temp.st('bg'), 'suggested/rent_and_bills>pb suggested/rent_and_bills>pb',
  'the rent plus two bills of two categories is one suggestion for both');

-- The app's list: what asks for an answer.
select is(
  (select string_agg((select x.label from pg_temp.ur x where x.id = (b->>'bill_transaction_id')::uuid), ' '
     order by o)
   from jsonb_array_elements(public.list_utility_refunds(pg_temp.uid('oak'), '2026-06-30')->'bills') with ordinality e(b, o)),
  'e0 g0 g1 e3 w1', 'the app''s list for Oak: the suggestions first, then the bills not refunded');
select is(public.count_utility_refunds('2026-06-30'),
  jsonb_build_object('as_of', '2026-06-30', 'not_refunded_count', 4,
    'not_refunded_by_currency', jsonb_build_array(jsonb_build_object('currency', 'ILS', 'amount_minor', 20100)),
    'suggested_count', 6),
  'count_utility_refunds: the bills not refunded (w1, elm_e, elm_e2, elm_g) with their sum, and the suggestions');

-- Who pays.
select is(public.set_utility_payer(pg_temp.uid('elm'), pg_temp.uid('gasco'), 'ILS', 'company')->'prior', 'null'::jsonb,
  'set_utility_payer returns the prior state (none)');
select is(pg_temp.st('elm_g'), 'absent', 'a company-paid utility''s bills are never checked');
select is(public.set_utility_payer(pg_temp.uid('elm'), pg_temp.uid('net'), 'ILS', 'tenant', true)->>'added', 'true',
  'the owner adds a supplier by hand');
select is(pg_temp.st('net1'), 'not_refunded', 'its bills are checked from then on');
select is(
  (select string_agg(u->>'supplier_name' || ':' || (u->>'payer') || ':' || (u->>'added') || ':' || (u->>'found') || ':' || coalesce(u->>'usual_minor', '-'), ' '
     order by u->>'supplier_name')
   from jsonb_array_elements(public.list_utility_payers(pg_temp.uid('elm'))->'utilities') u),
  'Example Gas Co:company:false:true:3000 Example Net Co:tenant:true:false:2500 Example Power Co:tenant:false:true:6050 Example Trash Co:tenant:false:true:7777',
  'list_utility_payers: each utility with who pays, how it was found and the usual amount (median of the last 3 bills)');
select is(
  (select string_agg(u->>'supplier_name' || ':' || coalesce(u->>'category_name', '-'), ' ' order by u->>'supplier_name')
   from jsonb_array_elements(public.list_utility_payers(pg_temp.uid('oak'))->'utilities') u),
  'Example Gas Co:חשמל ומים Example Power Co:חשמל ומים Example Water Co:חשמל ומים',
  'each utility names its latest bill''s category (gas''s April bill is filed under חשמל ומים)');
select is(public.set_utility_payer(pg_temp.uid('elm'), pg_temp.uid('net'), 'ILS', null)->'prior',
  jsonb_build_object('payer', 'tenant', 'added', true), 'a null payer removes the row and returns what it was');

-- The answers.
select is(public.answer_utility_refund(pg_temp.uid('g1'), 'rejected', pg_temp.uid('pg1'))->>'state', 'rejected', 'the owner rejects a suggestion');
select is(pg_temp.st('g1'), 'not_refunded', 'a rejected pair is never suggested again');
select is(public.answer_utility_refund(pg_temp.uid('g1'), null, pg_temp.uid('pg1'))->>'prior_state', null,
  'taking the rejection back');
select is(pg_temp.st('g1'), 'suggested/bill>pg1', 'the pair is suggested again');
select is(public.answer_utility_refund(pg_temp.uid('e1'), null)->>'state', 'rejected',
  'taking back an auto-counted refund records the pair as rejected');
select is(pg_temp.st('e1'), 'not_refunded', 'so it is neither counted nor suggested again');
select is(public.answer_utility_refund(pg_temp.uid('e1'), null, pg_temp.uid('pe1'))->>'state', null, 'removing that rejection');
select is(pg_temp.st('e1'), 'refunded/bill>pe1', 'counts by itself again');
select is(public.answer_utility_refund(pg_temp.uid('elm_e2'), 'seen')->>'prior_state', null, 'the owner closes a bill as seen');
select is(pg_temp.st('elm_e2'), 'seen', 'a seen bill is closed');
select ok(pg_temp.bill('elm_e2', '2026-06-30') is not null
  and not exists (select 1 from jsonb_array_elements(public.list_utility_refunds(null, '2026-06-30')->'bills') b
                  where (b->>'bill_transaction_id')::uuid = pg_temp.uid('elm_e2')),
  'and leaves the app''s list');
select is(public.answer_utility_refund(pg_temp.uid('elm_e2'), null)->>'prior_state', 'seen', 'taking the seen answer back');
select throws_ok(format('select public.answer_utility_refund(%L, %L)', pg_temp.uid('g1'), 'matched'),
  'P0001', 'validation', 'matched needs a payment');
select throws_ok(format('select public.answer_utility_refund(%L, %L, %L)', pg_temp.uid('g1'), 'matched', pg_temp.uid('e2')),
  'P0001', 'not a refund payment', 'a payment must be money in');
select throws_ok(format('select public.answer_utility_refund(%L, %L)', pg_temp.uid('rent1'), 'seen'),
  'P0001', 'not a utility bill', 'only a utility''s bill takes an answer');

-- Mark all as seen: Oak's open not-refunded bills, suggestions left open.
select is(public.mark_utility_refunds_seen(pg_temp.uid('oak'), '2026-06-30')->'bill_transaction_ids',
  to_jsonb(array[pg_temp.uid('w1')]), 'mark_utility_refunds_seen closes Oak''s not-refunded bills and returns them');
select is(pg_temp.st('w1') || ' ' || pg_temp.st('g1'), 'seen suggested/bill>pg1', 'the suggestion stays open');
select is(public.unmark_utility_refunds_seen(array[pg_temp.uid('w1'), pg_temp.uid('g1')])->'bill_transaction_ids',
  to_jsonb(array[pg_temp.uid('w1')]), 'unmark_utility_refunds_seen takes them back');
select is(pg_temp.st('w1'), 'not_refunded', 'the bill is open again');

-- The one-tap fix: the owner says yes to a payment filed elsewhere, then moves it.
select is(public.answer_utility_refund(pg_temp.uid('g1'), 'matched', pg_temp.uid('pg1'))->>'state', 'matched', 'the owner matches g1');
select is(pg_temp.st('g1') || ':' || (pg_temp.bill('g1', '2026-06-30')->>'wrong_category'), 'refunded>pg1:true',
  'the matched refund shows it may be filed wrong');
select is(public.refile_utility_refund(pg_temp.uid('g1'), pg_temp.uid('pg1'))->>'mode', 'move', 'refile moves the whole payment');
select is((select category_id::text || project_id::text from public.transactions where id = pg_temp.uid('pg1')),
  pg_temp.uid('gas')::text || pg_temp.uid('oak')::text, 'to the bill''s category and property');
select is(pg_temp.bill('g1', '2026-06-30')->>'wrong_category', 'false', 'the note goes');
select throws_ok(format('select public.answer_utility_refund(%L, %L)', pg_temp.uid('g1'), 'seen'),
  'P0001', 'undo the refile first', 'a refiled refund keeps its answer until the refile is undone');
select lives_ok(format('select public.undo_utility_refile(%L, %L)', pg_temp.uid('g1'), pg_temp.uid('pg1')), 'undo the refile');
select is((select category_id from public.transactions where id = pg_temp.uid('pg1')), pg_temp.uid('other_income'),
  'the payment is back in its own category');
-- Keep the books as they are (להשאיר): the note goes, and the bill leaves the app's list.
select is(public.answer_utility_refund(pg_temp.uid('g1'), 'matched', pg_temp.uid('pg1'), null, true)->>'keep_category', 'true',
  'the owner keeps the payment where it is filed');
select is((pg_temp.bill('g1', '2026-06-30')->>'wrong_category') || ' ' || (pg_temp.bill('g1', '2026-06-30')->>'keep_category'),
  'false true', 'a kept refund raises no wrong-category note');
select ok(not exists (select 1 from jsonb_array_elements(public.list_utility_refunds(pg_temp.uid('oak'), '2026-06-30')->'bills') b
                      where (b->>'bill_transaction_id')::uuid = pg_temp.uid('g1')), 'and leaves the app''s list');
select is(public.answer_utility_refund(pg_temp.uid('g1'), 'matched', pg_temp.uid('pg1'), null, false)->>'keep_category', 'false',
  'the keep can be taken back');
select throws_ok(format('select public.answer_utility_refund(%L, %L, null, null, true)', pg_temp.uid('g1'), 'seen'),
  'P0001', 'validation', 'only a matched answer keeps a category');
-- Rent plus the bill: the bill's part is split off.
select lives_ok(format('select public.answer_utility_refund(%L, %L, %L)', pg_temp.uid('e3'), 'matched', pg_temp.uid('p3')),
  'the owner matches the rent payment to e3');
select is(public.refile_utility_refund(pg_temp.uid('e3'), pg_temp.uid('p3'))->>'part_minor', '9000', 'refile splits the bill''s part off');
reset role;
select is(private.line_split_parts(pg_temp.uid('p3')),
  jsonb_build_array(
    jsonb_build_object('category_id', pg_temp.uid('power'), 'project_id', pg_temp.uid('oak'), 'amount_minor', 9000, 'gross_up', false),
    jsonb_build_object('category_id', pg_temp.uid('rent'), 'project_id', null, 'amount_minor', 200000, 'gross_up', false)),
  'the bill''s category takes its part, the rest stays rent');
select tests.line_split(pg_temp.uid('p3'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.uid('power'), 'project_id', pg_temp.uid('oak'), 'amount_minor', 8000),
  jsonb_build_object('category_id', pg_temp.uid('rent'), 'amount_minor', 201000)));
select tests.authenticate_as('ur_owner');
select throws_ok(format('select public.undo_utility_refile(%L, %L)', pg_temp.uid('e3'), pg_temp.uid('p3')),
  'P0001', 'line changed since', 'undo is refused once the line changed since');
reset role;
select tests.line_split(pg_temp.uid('p3'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.uid('power'), 'project_id', pg_temp.uid('oak'), 'amount_minor', 9000),
  jsonb_build_object('category_id', pg_temp.uid('rent'), 'amount_minor', 200000)));
select tests.authenticate_as('ur_owner');
select lives_ok(format('select public.undo_utility_refile(%L, %L)', pg_temp.uid('e3'), pg_temp.uid('p3')), 'undo the split');
reset role;
select is(private.line_split_parts(pg_temp.uid('p3')), '[]'::jsonb, 'the payment is whole again');
-- Two bills of two categories in one rent payment: one refile splits a part for each.
select tests.authenticate_as('ur_owner');
select lives_ok(format('select public.answer_utility_refund(%L, %L, %L), public.answer_utility_refund(%L, %L, %L)',
  pg_temp.uid('be'), 'matched', pg_temp.uid('pb'), pg_temp.uid('bg'), 'matched', pg_temp.uid('pb')), 'the owner matches both to pb');
select is(public.refile_utility_refund(pg_temp.uid('be'), pg_temp.uid('pb'))->>'part_minor', '7000',
  'one refile splits off both bills'' parts');
select is((pg_temp.bill('bg', '2026-06-30')->>'refiled') || (pg_temp.bill('bg', '2026-06-30')->>'wrong_category'), 'truefalse',
  'the other bill is refiled too, and its note goes');
reset role;
select is(private.line_split_parts(pg_temp.uid('pb')),
  jsonb_build_array(
    jsonb_build_object('category_id', pg_temp.uid('power'), 'project_id', pg_temp.uid('birch'), 'amount_minor', 4000, 'gross_up', false),
    jsonb_build_object('category_id', pg_temp.uid('gas'), 'project_id', pg_temp.uid('birch'), 'amount_minor', 3000, 'gross_up', false),
    jsonb_build_object('category_id', pg_temp.uid('rent'), 'project_id', null, 'amount_minor', 150000, 'gross_up', false)),
  'a part per bill category, the rest stays rent');
select tests.authenticate_as('ur_owner');
select lives_ok(format('select public.undo_utility_refile(%L, %L)', pg_temp.uid('bg'), pg_temp.uid('pb')), 'undo from either bill');
reset role;
select is(private.line_split_parts(pg_temp.uid('pb')), '[]'::jsonb, 'the payment is whole again');

-- Another company's ids are refused; the owner gets their own.
select tests.authenticate_as('ur_outsider');
select throws_ok(format('select public.list_utility_payers(%L)', pg_temp.uid('oak')), 'P0001', 'project not found',
  'list_utility_payers: another company''s property is refused');
select throws_ok(format('select public.list_utility_refunds(%L)', pg_temp.uid('oak')), 'P0001', 'project not found',
  'list_utility_refunds: another company''s property is refused');
select throws_ok(format('select public.set_utility_payer(%L, %L, %L, %L)', pg_temp.uid('oak'), pg_temp.uid('electric'), 'ILS', 'company'),
  'P0001', 'project not found', 'set_utility_payer: another company''s property is refused');
select throws_ok(format('select public.set_utility_payer(%L, %L, %L, %L)', pg_temp.uid('far'), pg_temp.uid('electric'), 'ILS', 'company'),
  'P0001', 'supplier not found', 'set_utility_payer: another company''s supplier is refused');
select throws_ok(format('select public.answer_utility_refund(%L, %L)', pg_temp.uid('e4'), 'seen'), 'P0001', 'transaction not found',
  'answer_utility_refund: another company''s bill is refused');
select throws_ok(format('select public.answer_utility_refund(%L, %L, %L)', pg_temp.uid('far_bill'), 'matched', pg_temp.uid('pe1')),
  'P0001', 'transaction not found', 'answer_utility_refund: another company''s payment is refused');
select throws_ok(format('select public.mark_utility_refunds_seen(%L)', pg_temp.uid('oak')), 'P0001', 'project not found',
  'mark_utility_refunds_seen: another company''s property is refused');
select throws_ok(format('select public.refile_utility_refund(%L, %L)', pg_temp.uid('g1'), pg_temp.uid('pg1')), 'P0001', 'transaction not found',
  'refile_utility_refund: another company''s lines are refused');
select is(public.count_utility_refunds('2026-06-30')->>'not_refunded_count', '0', 'the other company counts nothing of the first''s');
select tests.authenticate_as('ur_owner');
select is(jsonb_array_length(public.list_utility_payers(pg_temp.uid('oak'))->'utilities'), 3,
  'the owner still reads their own property''s utilities');

-- A viewer reads but is refused each write.
select tests.authenticate_as('ur_viewer');
select is(pg_temp.st('e1'), 'refunded/bill>pe1', 'a viewer reads the list');
select throws_ok(
  format($$select public.set_utility_payer(%L, %L, 'ILS', 'company'), public.answer_utility_refund(%L, 'seen')$$,
    pg_temp.uid('oak'), pg_temp.uid('electric'), pg_temp.uid('e4')),
  '42501', 'forbidden', 'a viewer is refused set_utility_payer and answer_utility_refund');
select throws_ok(
  format($$select public.mark_utility_refunds_seen(%L), public.refile_utility_refund(%L, %L)$$,
    pg_temp.uid('oak'), pg_temp.uid('g1'), pg_temp.uid('pg1')),
  '42501', 'forbidden', 'a viewer is refused mark_utility_refunds_seen and refile_utility_refund');

-- MCP: the writes with idempotency and undo. A replay with the same key gives the write's id back.
select pg_temp.as_mcp('owner', 'tok-owner');
create temp table ur_w as
select public.mcp_answer_utility_refund('ur-k1', pg_temp.uid('w1'), 'seen', null, '2026-06-30') as r;
select is((select r->'data'->>'undo_kind' from ur_w), 'utility_refund', 'mcp_answer_utility_refund answers with undo kind utility_refund');
select is(public.mcp_answer_utility_refund('ur-k1', pg_temp.uid('w1'), 'seen', null, '2026-06-30'), (select r from ur_w),
  'the same key replays the answer');
select is(public.mcp_undo('ur-u1', 'utility_refund', (select (r->'data'->>'id')::uuid from ur_w))->>'ok', 'true', 'undo takes it back');
select is(pg_temp.st('w1'), 'not_refunded', 'the bill is open again');
select is(public.mcp_undo('ur-u2', 'utility_refund', (select (r->'data'->>'id')::uuid from ur_w))->'error'->>'code', 'not_found',
  'an undone write cannot be undone twice');
select is(public.mcp_mark_utility_refunds_seen('ur-k2', pg_temp.uid('elm'), '2026-06-30')->'data'->'bill_transaction_ids',
  to_jsonb(array[pg_temp.uid('elm_e'), pg_temp.uid('elm_e2')]), 'mcp_mark_utility_refunds_seen closes Elm''s bills');
select is(public.mcp_undo('ur-u3', 'utility_refunds_seen',
  (public.mcp_mark_utility_refunds_seen('ur-k2', pg_temp.uid('elm'), '2026-06-30')->'data'->>'id')::uuid)->>'ok', 'true',
  'its undo opens every one again');
select is(pg_temp.st('elm_e') || ' ' || pg_temp.st('elm_e2'), 'not_refunded not_refunded', 'both are open');
select is(public.mcp_set_utility_payer('ur-k3', pg_temp.uid('oak'), pg_temp.uid('water'), 'ILS', 'company', false)->'data'->>'payer',
  'company', 'mcp_set_utility_payer');
select is(public.mcp_undo('ur-u4', 'utility_payer',
  (public.mcp_set_utility_payer('ur-k3', pg_temp.uid('oak'), pg_temp.uid('water'), 'ILS', 'company', false)->'data'->>'id')::uuid)->>'ok', 'true',
  'its undo puts the payer back');
select is(pg_temp.st('w1'), 'not_refunded', 'water is tenant-paid again');
select lives_ok(format('select public.answer_utility_refund(%L, %L, %L)', pg_temp.uid('g1'), 'matched', pg_temp.uid('pg1')), 'g1 matched for the refile');
select is(public.mcp_refile_utility_refund('ur-k4', pg_temp.uid('g1'), pg_temp.uid('pg1'))->'data'->>'undo_kind', 'utility_refile',
  'mcp_refile_utility_refund refiles with undo kind utility_refile');
select is(public.mcp_undo('ur-u5', 'utility_refile',
  (public.mcp_refile_utility_refund('ur-k4', pg_temp.uid('g1'), pg_temp.uid('pg1'))->'data'->>'id')::uuid)->>'ok', 'true',
  'its undo puts the payment back');
select is((select category_id from public.transactions where id = pg_temp.uid('pg1')), pg_temp.uid('other_income'), 'in its own category');
select is(public.mcp_undo('ur-u6', 'utility_refund',
  (public.mcp_answer_utility_refund('ur-k9', pg_temp.uid('g1'), 'matched', pg_temp.uid('pg1'), null, true)->'data'->>'id')::uuid)->>'ok', 'true',
  'mcp_answer_utility_refund keeps a category, and its undo takes the keep back');
select is(public.mcp_answer_utility_refund('ur-k5', pg_temp.uid('far_bill'), 'seen')->'error'->>'code', 'refused',
  'the MCP refuses another company''s bill');
reset role;
create function pg_temp.ur_clash() returns trigger language plpgsql as $$
begin
  raise unique_violation using message = 'duplicate key';
end;
$$;
create trigger ur_clash before insert on public.utility_payers for each row execute function pg_temp.ur_clash();
select pg_temp.as_mcp('owner', 'tok-owner');
select is(public.mcp_set_utility_payer('ur-k8', pg_temp.uid('oak'), pg_temp.uid('water'), 'ILS', 'company')->'error'->>'code',
  'unavailable', 'a unique violation is a retry, not a refusal');
reset role;
drop trigger ur_clash on public.utility_payers;
select pg_temp.as_mcp('owner', 'tok-owner');
select is(public.mcp_set_utility_payer('ur-k8', pg_temp.uid('oak'), pg_temp.uid('water'), 'ILS', 'company')->'data'->>'payer',
  'company', 'and is not cached: the same key writes on the retry');
select pg_temp.as_mcp('owner', 'tok-read');
select is(public.mcp_answer_utility_refund('ur-k6', pg_temp.uid('w1'), 'seen')->'error'->>'code', 'forbidden', 'a read-only token is refused');
select pg_temp.as_mcp('owner', 'tok-old');
select is(public.mcp_set_utility_payer('ur-k7', pg_temp.uid('oak'), pg_temp.uid('water'), 'ILS', 'company')->'error'->>'message',
  'expired', 'an expired token is refused');

-- The card-name rule's cases: the same as supabase/functions/_shared/jev_tag_plan_test.ts (FLOW-1072).
reset role;
create temp table ur_props (list jsonb);
insert into ur_props values (jsonb_build_array(
  jsonb_build_object('id', 'a0000000-0000-4000-8000-000000000001', 'name', 'Example Rd 1234'),
  jsonb_build_object('id', 'a0000000-0000-4000-8000-000000000002', 'name', 'Example Rd 1300'),
  jsonb_build_object('id', 'a0000000-0000-4000-8000-000000000003', 'name', 'Sample 2432'),
  jsonb_build_object('id', 'a0000000-0000-4000-8000-000000000004', 'name', 'Old Place 10', 'finished', true)));
select is(private.card_name_project_of('Sample Utilities', (select list from ur_props)), 'a0000000-0000-4000-8000-000000000003', 'card: a name''s own word');
select is(private.card_name_project_of('sample 2432 water', (select list from ur_props)), 'a0000000-0000-4000-8000-000000000003', 'card: any case, with its number');
select is(private.card_name_project_of('Example Rd 1234 Utilities', (select list from ur_props)), 'a0000000-0000-4000-8000-000000000001', 'card: the number decides two on one street');
select is(private.card_name_project_of('Example Rd Utilities', (select list from ur_props)), null, 'card: two matches are none');
select is(private.card_name_project_of('Rd Utilities', (select list from ur_props)), null, 'card: generic words never match');
select is(private.card_name_project_of('Old Place 10', (select list from ur_props)), null, 'card: a finished project is no candidate');
select is(private.card_name_project_of('Main Business Card', jsonb_build_array(jsonb_build_object('id', 'a0000000-0000-4000-8000-000000000001', 'name', 'Main St 1200'))), null,
  'card: generic account words never match');
select is(private.card_name_project_of('הרצל חשמל', jsonb_build_array(jsonb_build_object('id', 'a0000000-0000-4000-8000-000000000001', 'name', 'הרצל 12'))),
  'a0000000-0000-4000-8000-000000000001', 'card: a Hebrew name matches the same way');
select is(private.card_name_project_of('Example Rd 1234', jsonb_build_array(jsonb_build_object('id', 'a0000000-0000-4000-8000-000000000001', 'name', 'Example Rd 1234', 'overhead', true))), null,
  'card: the overhead project is no candidate');

select * from finish();
rollback;
