-- FLOW-401 (decision 0149). project_category_months: per expense category and currency of a
-- project, the last complete months, this month, the expected cost (median of the months with a
-- cost, from 3 of them) and the high, new and missing flags. Category groups: set_category_group
-- and MCP set_category_group with undo kind category_group. Invented data only. Amounts are
-- agorot or cents. "Today" is 2026-09-20, so the complete months are March to August 2026.

begin;

select plan(30);

do $users$
begin
  perform tests.create_supabase_user('pcm_owner', 'pcm-owner@example.com');
  perform tests.create_supabase_user('pcm_viewer', 'pcm-viewer@example.com');
  perform tests.create_supabase_user('pcm_other', 'pcm-other@example.com');
end
$users$;

create temp table pcm (label text primary key, id uuid);
grant all on pcm to authenticated, service_role;
create temp table pcm_out (label text primary key, body jsonb);
grant all on pcm_out to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.pcm where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into pcm (label, id) values ('co', tests.fixture_company('pcm_owner', 'Example Months LLC', true));
insert into pcm (label, id) values ('other_co', tests.fixture_company('pcm_other', 'Example Other Months LLC'));
insert into public.company_viewers (user_id, company_id)
values (tests.get_supabase_uid('pcm_viewer'), pg_temp.id('co'));
insert into pcm (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example House')),
  ('elec', tests.fixture_category(pg_temp.id('co'), 'Electricity')),
  ('water', tests.fixture_category(pg_temp.id('co'), 'Water')),
  ('roof', tests.fixture_category(pg_temp.id('co'), 'Roof')),
  ('paint', tests.fixture_category(pg_temp.id('co'), 'Paint')),
  ('gas', tests.fixture_category(pg_temp.id('co'), 'Gas')),
  ('split', tests.fixture_category(pg_temp.id('co'), 'Split header')),
  ('other_elec', tests.fixture_category(pg_temp.id('other_co'), 'Electricity'));

create function pg_temp.line(p_key text, p_cat text, p_amount bigint, p_date date, p_currency text default 'ILS', p_status text default 'posted')
returns uuid
language sql
as $$
  select tests.fixture_line(pg_temp.id('co'), 'pcm:' || p_key, p_amount, p_project => pg_temp.id('house'),
    p_category => pg_temp.id(p_cat), p_doc_date => p_date, p_currency => p_currency, p_line_status => p_status)
$$;

-- Electricity: 6 months with a gap in June; a void line; ₪400 this month (high).
select pg_temp.line('e3', 'elec', 10000, '2026-03-12');
select pg_temp.line('e4', 'elec', 12000, '2026-04-12');
select pg_temp.line('e5', 'elec', 11000, '2026-05-12');
select pg_temp.line('e7', 'elec', 13000, '2026-07-12');
select pg_temp.line('e8', 'elec', 10000, '2026-08-12');
select pg_temp.line('ev', 'elec', 90000, '2026-08-13', p_status => 'void');
select pg_temp.line('e9', 'elec', 40000, '2026-09-12');
-- A dollar electricity line this month: its own row, below the flag floor.
select pg_temp.line('eu', 'elec', 5000, '2026-09-03', 'USD');
-- Water: April to August on the 5th; nothing yet this month (missing).
select pg_temp.line('w4', 'water', 5000, '2026-04-05');
select pg_temp.line('w5', 'water', 5000, '2026-05-05');
select pg_temp.line('w6', 'water', 5000, '2026-06-05');
select pg_temp.line('w7', 'water', 5000, '2026-07-05');
select pg_temp.line('w8', 'water', 5000, '2026-08-05');
-- Roof: nothing before, ₪800 now (new). Paint: two months only, then more (no expected, no flag).
select pg_temp.line('r9', 'roof', 80000, '2026-09-02');
select pg_temp.line('p7', 'paint', 3000, '2026-07-01');
select pg_temp.line('p8', 'paint', 3000, '2026-08-01');
select pg_temp.line('p9', 'paint', 9000, '2026-09-01');
-- Gas: small amounts; double this month but under the ₪200 floor (no flag).
select pg_temp.line('g6', 'gas', 1000, '2026-06-20');
select pg_temp.line('g7', 'gas', 1000, '2026-07-20');
select pg_temp.line('g8', 'gas', 1000, '2026-08-20');
select pg_temp.line('g9', 'gas', 2000, '2026-09-02');
-- An August line split between Electricity ₪20 and Water ₪30. Its own category is Split header.
insert into pcm (label, id) values ('s8', pg_temp.line('s8', 'split', 5000, '2026-08-20'));
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
values
  (pg_temp.id('co'), pg_temp.id('s8'), 1, pg_temp.id('elec'), pg_temp.id('house'), 2000),
  (pg_temp.id('co'), pg_temp.id('s8'), 2, pg_temp.id('water'), pg_temp.id('house'), 3000);
set constraints all immediate;
set constraints all deferred;
-- A line still in review this month does not count yet.
insert into pcm (label, id) values ('q9', pg_temp.line('q9', 'water', 99000, '2026-09-04'));
insert into public.review_queue (company_id, transaction_id, status, reason)
values (pg_temp.id('co'), pg_temp.id('q9'), 'open', 'suggested');

create function pg_temp.row(p_cat text, p_currency text default 'ILS') returns jsonb
language sql
as $$
  select x from jsonb_array_elements(
    public.project_category_months(pg_temp.id('house'), 6, '2026-09-20')->'categories') x
  where (x->>'id')::uuid = pg_temp.id(p_cat) and x->>'currency' = p_currency
$$;
grant execute on function pg_temp.row(text, text) to authenticated;

select tests.authenticate_as('pcm_owner');
select is(public.project_category_months(pg_temp.id('house'), 6, '2026-09-20')->'months',
  '["2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"]'::jsonb,
  'six complete months, oldest first');
select is(pg_temp.row('elec')->'months_minor', '[10000, 12000, 11000, 0, 13000, 12000]'::jsonb,
  'electricity by month: the June gap is 0, August has the split part, the void line is out');
select is((pg_temp.row('elec')->>'months_seen')::integer, 5, 'five months with a cost');
select is((pg_temp.row('elec')->>'expected_minor')::bigint, 12000::bigint, 'expected is the median of those five');
select is((pg_temp.row('elec')->>'this_month_minor')::bigint, 40000::bigint, 'this month so far');
select is(pg_temp.row('elec')->>'flag', 'high', 'well above usual is high');
select is(pg_temp.row('water')->>'flag', 'missing', 'a usual cost not seen yet after its day is missing');
select is((pg_temp.row('water')->>'this_month_minor')::bigint, 0::bigint, 'a line still in review does not count');
select is((pg_temp.row('water')->>'expected_minor')::bigint, 5000::bigint, 'water usually costs ₪50');
select is(pg_temp.row('roof')->>'flag', 'new', 'a large first cost is new');
select is(pg_temp.row('paint')->'expected_minor', 'null'::jsonb, 'two months are too few for an expected cost');
select is(pg_temp.row('paint')->'flag', 'null'::jsonb, 'and paint gets no flag');
select is(pg_temp.row('gas')->'flag', 'null'::jsonb, 'double a small usual cost stays under the floor');
select is(pg_temp.row('elec', 'USD')->'flag', 'null'::jsonb, 'the dollar row is its own, under the dollar floor');
select is(pg_temp.row('split'), null::jsonb, 'a split line counts by its parts, not its own category');
select is(public.project_category_months(pg_temp.id('house'), 6, '2026-09-04')->'categories'
    -> 0 ->> 'currency', 'ILS', 'shekel rows come first in a shekel company');
select is((select x->>'flag' from jsonb_array_elements(
    public.project_category_months(pg_temp.id('house'), 6, '2026-09-04')->'categories') x
  where (x->>'id')::uuid = pg_temp.id('water')), null, 'on the 4th, before water''s usual day, nothing is missing');
select throws_ok($$select public.project_category_months(pg_temp.id('house'), 2)$$, 'P0001', 'validation',
  'at least 3 months');

-- Groups.
select is(public.set_category_group(pg_temp.id('elec'), '  חשבונות ')->>'after', 'חשבונות', 'the owner groups electricity, trimmed');
select is((select x->>'group_name' from jsonb_array_elements(public.list_categories()) x where (x->>'id')::uuid = pg_temp.id('elec')),
  'חשבונות', 'list_categories gives the group');
select is(pg_temp.row('elec')->>'group_name', 'חשבונות', 'and so do the months');
select throws_ok($$select public.set_category_group(pg_temp.id('elec'), repeat('א', 41))$$, 'P0001', 'validation', 'a group is at most 40 letters');
select throws_ok($$select public.set_category_group(pg_temp.id('other_elec'), 'x')$$, 'P0001', 'category not found', 'not another company''s category');

select tests.authenticate_as('pcm_viewer');
select is((pg_temp.row('elec')->>'expected_minor')::bigint, 12000::bigint, 'a viewer reads the same months');
select throws_ok($$select public.set_category_group(pg_temp.id('elec'), null)$$, '42501', 'forbidden', 'but cannot change a group');

select tests.authenticate_as('pcm_other');
select is(public.project_category_months(pg_temp.id('house'), 6, '2026-09-20'), null::jsonb, 'another company reads nothing');

-- MCP set_category_group with undo.
reset role;
select public.store_mcp_credential(tests.get_supabase_uid('pcm_owner'), 'hash-pcm-write01', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into pcm (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-pcm-write01';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('pcm_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id(p_label))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

select pg_temp.as_mcp('write');
insert into pcm_out (label, body) values ('mcp', public.mcp_set_category_group('pcm-group-1', pg_temp.id('water'), 'חשבונות'));
select is((select body->'data'->>'undo_kind' || ':' || coalesce(body->'data'->>'prior', 'none') from pcm_out where label = 'mcp'),
  'category_group:none', 'MCP set_category_group answers with its undo kind and the group before');
select is(public.mcp_undo('pcm-undo-1', 'category_group', pg_temp.id('water'))->>'ok', 'true', 'undo takes it out again');
select is((select group_name from public.categories where id = pg_temp.id('water')), null, 'water has no group again');

select public.mcp_set_category_group('pcm-group-2', pg_temp.id('water'), 'חשבונות');
select public.set_category_group(pg_temp.id('water'), 'Utilities');
select is(public.mcp_undo('pcm-undo-2', 'category_group', pg_temp.id('water'))->'error'->>'code', 'conflict',
  'undo is a conflict once the group was changed again');

select * from finish();
rollback;
