-- FLOW-323 server part (decision 0140): search_transactions filters by date, project, category,
-- direction and review state, matches the customer, and says how each row stands. Invented
-- data only. Amounts are agorot.

begin;

select plan(42);

do $users$
begin
  perform tests.create_supabase_user('sfl_owner', 'sfl-owner@example.com');
  perform tests.create_supabase_user('sfl_viewer', 'sfl-viewer@example.com');
  perform tests.create_supabase_user('sfl_other', 'sfl-other@example.com');
end
$users$;

create temp table sfl (label text primary key, id uuid);
grant all on sfl to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.sfl where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into sfl (label, id) values ('co', tests.fixture_company('sfl_owner', 'Example Search LLC', true));
insert into sfl (label, id) values ('other_co', tests.fixture_company('sfl_other', 'Example Other Search LLC'));
insert into public.company_viewers (user_id, company_id)
values (tests.get_supabase_uid('sfl_viewer'), pg_temp.id('co'));

insert into sfl (label, id) values
  ('alpha', tests.fixture_project(pg_temp.id('co'), 'Alpha')),
  ('beta', tests.fixture_project(pg_temp.id('co'), 'Beta')),
  ('sales', tests.fixture_category(pg_temp.id('co'), 'Sales', 'income')),
  ('materials', tests.fixture_category(pg_temp.id('co'), 'Materials', 'expense')),
  ('tools', tests.fixture_category(pg_temp.id('co'), 'Tools', 'expense')),
  ('interest', tests.fixture_category(pg_temp.id('co'), 'Loan interest', 'expense')),
  ('draws', tests.fixture_category(pg_temp.id('co'), 'Owner draws', 'expense', true)),
  ('other_alpha', tests.fixture_project(pg_temp.id('other_co'), 'Other Alpha')),
  ('other_materials', tests.fixture_category(pg_temp.id('other_co'), 'Other Materials', 'expense'));

insert into public.suppliers (company_id, name) values (pg_temp.id('co'), 'Example Cement Works');
insert into sfl (label, id) select 'cement', id from public.suppliers where company_id = pg_temp.id('co');
insert into public.customers (company_id, name) values (pg_temp.id('co'), 'Example Tenant Ltd');
insert into sfl (label, id) select 'tenant', id from public.customers where company_id = pg_temp.id('co');

-- Lines. fixture_line sets the description to the key.
insert into sfl (label, id) values
  ('rent', tests.fixture_line(pg_temp.id('co'), 'sfl:rent', 500000, 'income',
    pg_temp.id('alpha'), pg_temp.id('sales'), '2026-06-05')),
  ('bricks', tests.fixture_line(pg_temp.id('co'), 'sfl:bricks', 120000, 'expense',
    pg_temp.id('alpha'), pg_temp.id('materials'), '2026-06-10')),
  ('drill', tests.fixture_line(pg_temp.id('co'), 'sfl:drill', 30000, 'expense',
    pg_temp.id('beta'), pg_temp.id('tools'), '2026-07-02', 'USD')),
  ('shared', tests.fixture_line(pg_temp.id('co'), 'sfl:shared', 40000, 'expense',
    null, pg_temp.id('materials'), '2026-06-12', 'ILS', 'posted', 'manual', 'shared')),
  ('split', tests.fixture_line(pg_temp.id('co'), 'sfl:split', 100000, 'expense',
    pg_temp.id('alpha'), pg_temp.id('materials'), '2026-06-15')),
  ('loan', tests.fixture_line(pg_temp.id('co'), 'sfl:loan', 80000, 'expense',
    null, null, '2026-06-20')),
  ('loose', tests.fixture_line(pg_temp.id('co'), 'sfl:loose_100%', 9000, 'expense',
    null, null, '2026-05-01')),
  ('draw', tests.fixture_line(pg_temp.id('co'), 'sfl:draw', 20000, 'expense',
    null, pg_temp.id('draws'), '2026-06-21')),
  ('removed', tests.fixture_line(pg_temp.id('co'), 'sfl:removed', 1000, 'expense',
    pg_temp.id('alpha'), pg_temp.id('materials'), '2026-06-11')),
  ('other_line', tests.fixture_line(pg_temp.id('other_co'), 'sfl:other', 7000, 'expense',
    pg_temp.id('other_alpha'), pg_temp.id('other_materials'), '2026-06-10'));

update public.transactions set supplier_id = pg_temp.id('cement') where id = pg_temp.id('bricks');
update public.transactions set customer_id = pg_temp.id('tenant') where id = pg_temp.id('rent');
update public.transactions set removed_at = now() where id = pg_temp.id('removed');

-- The shared cost is split between Alpha and Beta.
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
values
  (pg_temp.id('co'), pg_temp.id('shared'), pg_temp.id('alpha'), 5000, -20000),
  (pg_temp.id('co'), pg_temp.id('shared'), pg_temp.id('beta'), 5000, -20000);

-- The split line puts a part on Beta under Tools; the rest stays on the line's project.
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
values
  (pg_temp.id('co'), pg_temp.id('split'), 1, pg_temp.id('materials'), null, 60000),
  (pg_temp.id('co'), pg_temp.id('split'), 2, pg_temp.id('tools'), pg_temp.id('beta'), 40000);

-- The loan payment's parts.
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values (pg_temp.id('co'), 'Example mortgage', 12000000, 60000, 360, '2026-01-01', 80000, 0, 'ILS');
insert into sfl (label, id) select 'mortgage', id from public.loans where company_id = pg_temp.id('co');
insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, category_id, scheduled_minor)
values
  (pg_temp.id('co'), pg_temp.id('mortgage'), pg_temp.id('loan'), 'interest', 60000, pg_temp.id('interest'), 60000),
  (pg_temp.id('co'), pg_temp.id('mortgage'), pg_temp.id('loan'), 'principal', 20000, pg_temp.id('draws'), 20000);

-- Two lines wait for review.
delete from public.review_queue where company_id = pg_temp.id('co');
insert into public.review_queue (company_id, transaction_id, status, reason)
values
  (pg_temp.id('co'), pg_temp.id('loose'), 'open', 'missing_project'),
  (pg_temp.id('co'), pg_temp.id('drill'), 'open', 'missing_project');

create or replace function pg_temp.keys(p_result jsonb)
returns text
language sql
as $$
  select coalesce(string_agg(e->>'description', ',' order by e->>'description'), '')
  from jsonb_array_elements(p_result->'expenses') e;
$$;
grant execute on function pg_temp.keys(jsonb) to authenticated, service_role;

create or replace function pg_temp.row_of(p_label text)
returns jsonb
language sql
as $$
  select e from jsonb_array_elements(public.search_transactions(p_limit => 100)->'expenses') e
  where (e->>'id')::uuid = pg_temp.id(p_label);
$$;
grant execute on function pg_temp.row_of(text) to authenticated, service_role;

select tests.authenticate_as('sfl_owner');

-- The old call still reads every line that is not removed.
select is((public.search_transactions(null, 'all', 50, 0)->>'total')::int, 8,
  'the 4-argument call reads every line that is not removed');

-- Dates.
select is(pg_temp.keys(public.search_transactions(p_from => '2026-06-01', p_to => '2026-06-15')),
  'sfl:bricks,sfl:rent,sfl:shared,sfl:split', 'a date range reads the lines dated in it, both ends included');
select is(pg_temp.keys(public.search_transactions(p_from => '2026-06-20')),
  'sfl:draw,sfl:drill,sfl:loan', 'from alone');
select throws_ok($$select public.search_transactions(p_from => '2026-07-01', p_to => '2026-06-01')$$,
  'P0001', 'validation', 'from after to is validation');

-- Direction.
select is(pg_temp.keys(public.search_transactions(p_direction => 'income')), 'sfl:rent',
  'income lines only');
select is((public.search_transactions(p_direction => 'expense')->>'total')::int, 7, 'expense lines only');
select throws_ok($$select public.search_transactions(p_direction => 'transfer')$$,
  'P0001', 'validation', 'an unknown direction is validation');

-- Project.
select is(pg_temp.keys(public.search_transactions(p_project => pg_temp.id('alpha')::text)),
  'sfl:bricks,sfl:rent,sfl:shared,sfl:split', 'Alpha: its own lines, its share of a shared cost and the split filed on it');
select is(pg_temp.keys(public.search_transactions(p_project => pg_temp.id('beta')::text)),
  'sfl:drill,sfl:shared,sfl:split', 'Beta: its line, its share, and the split part on it');
select is(pg_temp.keys(public.search_transactions(p_project => 'none')),
  'sfl:draw,sfl:loan,sfl:loose_100%', 'none: no project, no share and no part on a project');
select throws_ok($$select public.search_transactions(p_project => 'alpha')$$,
  'P0001', 'validation', 'a project that is not an id or none is validation');

-- Category.
select is(pg_temp.keys(public.search_transactions(p_category => pg_temp.id('tools')::text)),
  'sfl:drill,sfl:split', 'Tools: its line and the split part in it');
select is(pg_temp.keys(public.search_transactions(p_category => pg_temp.id('interest')::text)),
  'sfl:loan', 'a loan split part counts under its category');
select is(pg_temp.keys(public.search_transactions(p_category => 'none')),
  'sfl:loose_100%', 'none: no category and no parts');

-- A line split whose parts all name a project holds nothing on the line's own project, and a
-- split line holds nothing under its own category. A loan payment with a part waiting for
-- review counts whole under its own category.
reset role;
insert into sfl (label, id) values
  ('moved', tests.fixture_line(pg_temp.id('co'), 'sfl:moved', 50000, 'expense',
    pg_temp.id('alpha'), pg_temp.id('materials'), '2026-04-01'));
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
values
  (pg_temp.id('co'), pg_temp.id('moved'), 1, pg_temp.id('tools'), pg_temp.id('beta'), 30000),
  (pg_temp.id('co'), pg_temp.id('moved'), 2, pg_temp.id('interest'), pg_temp.id('beta'), 20000);
select tests.authenticate_as('sfl_owner');
select is((public.search_transactions(p_project => pg_temp.id('alpha')::text, p_to => '2026-04-30')->>'total')::int
  + (public.search_transactions(p_category => pg_temp.id('materials')::text, p_to => '2026-04-30')->>'total')::int,
  0, 'a line split away from its project and category is not listed under them');
select is(pg_temp.keys(public.search_transactions(p_project => pg_temp.id('beta')::text, p_to => '2026-04-30')),
  'sfl:moved', 'it is listed under the project its parts name');
reset role;
update public.transactions set category_id = pg_temp.id('tools') where id = pg_temp.id('loan');
update public.loan_splits set needs_review = true where transaction_id = pg_temp.id('loan') and part = 'principal';
select tests.authenticate_as('sfl_owner');
select is(pg_temp.keys(public.search_transactions(p_category => pg_temp.id('tools')::text, p_from => '2026-06-16')),
  'sfl:drill,sfl:loan', 'a loan payment with a part waiting for review is listed under its own category');
reset role;
update public.loan_splits set needs_review = false where transaction_id = pg_temp.id('loan');
delete from public.line_splits where transaction_id = pg_temp.id('moved');
update public.transactions set removed_at = now(), category_id = null where id in (pg_temp.id('moved'), pg_temp.id('loan'));
update public.transactions set removed_at = null where id = pg_temp.id('loan');
select tests.authenticate_as('sfl_owner');

-- Combined.
select is(pg_temp.keys(public.search_transactions(
    p_project => pg_temp.id('alpha')::text, p_category => pg_temp.id('materials')::text,
    p_from => '2026-06-11')),
  'sfl:shared,sfl:split', 'filters combine');

-- Scope.
select is(pg_temp.keys(public.search_transactions(p_scope => 'pending')),
  'sfl:drill,sfl:loose_100%', 'pending: lines waiting for review');
select is((public.search_transactions(p_scope => 'filed')->>'total')::int, 6, 'filed: the rest');
select throws_ok($$select public.search_transactions(p_scope => 'open')$$,
  'P0001', 'validation', 'an unknown scope is validation');

-- Text.
select is(pg_temp.keys(public.search_transactions('tenant')), 'sfl:rent',
  'the text matches the customer, so income is found by payer');
select is(pg_temp.keys(public.search_transactions('CEMENT')), 'sfl:bricks',
  'and the supplier, in any case');
select is(pg_temp.keys(public.search_transactions('100%')), 'sfl:loose_100%',
  '% in the text is a literal character');
select is((public.search_transactions('_')->>'total')::int, 1, 'and so is _: only the line with one matches');

-- Row fields.
select is(pg_temp.row_of('drill')->>'currency', 'USD', 'a row says its currency');
select ok((pg_temp.row_of('drill')->>'waiting_review')::boolean
  and not (pg_temp.row_of('bricks')->>'waiting_review')::boolean, 'a row says whether it waits for review');
select is(pg_temp.row_of('rent')->>'customer_name', 'Example Tenant Ltd', 'a row names its customer');
select ok((pg_temp.row_of('draw')->>'kept_out')::boolean
  and not (pg_temp.row_of('bricks')->>'kept_out')::boolean, 'a row says whether it is kept out of the P&L');
select ok((pg_temp.row_of('split')->>'split_parts')::int = 2 and (pg_temp.row_of('loan')->>'loan_matched')::boolean
  and (pg_temp.row_of('bricks')->>'split_parts')::int = 0, 'a row says how it is split');

-- Amount (FLOW-211): the bank figure without its sign, in the line's own currency.
select is(pg_temp.keys(public.search_transactions(p_amount_min => 120000, p_amount_max => 120000)), 'sfl:bricks',
  'an exact amount finds the expense whatever its sign');
select is(pg_temp.keys(public.search_transactions(p_amount_min => 30000, p_amount_max => 30000)), 'sfl:drill',
  'a dollar line is found by its dollar figure');
select is(pg_temp.keys(public.search_transactions(p_amount_min => 100000)), 'sfl:bricks,sfl:rent,sfl:split',
  'a minimum alone includes its end, income too');
select is(pg_temp.keys(public.search_transactions(p_amount_max => 9000, p_scope => 'pending')), 'sfl:loose_100%',
  'a maximum combines with the other filters');
select is((pg_temp.row_of('bricks')->>'amount_gross')::bigint, -120000::bigint, 'a row carries its bank amount');
select throws_ok($$select public.search_transactions(p_amount_min => 5, p_amount_max => 4)$$,
  'P0001', 'validation', 'a minimum above the maximum is validation');
select throws_ok($$select public.search_transactions(p_amount_min => -1)$$,
  'P0001', 'validation', 'a negative amount is validation');

-- Paging: lines on the same date never repeat across pages.
select is(
  (select count(distinct e->>'id')::int from (
    select jsonb_array_elements(public.search_transactions(p_limit => 3, p_offset => o)->'expenses') e
    from generate_series(0, 6, 3) o) pages),
  8, 'paging reads every line once');

-- Tenancy.
select is((public.search_transactions(p_project => pg_temp.id('other_alpha')::text)->>'total')::int, 0,
  'another company''s project matches nothing');
select is((public.search_transactions(p_category => pg_temp.id('other_materials')::text)->>'total')::int, 0,
  'another company''s category matches nothing');

select tests.authenticate_as('sfl_other');
select is(pg_temp.keys(public.search_transactions()), 'sfl:other',
  'the other company reads only its own line (positive control)');

select tests.authenticate_as('sfl_viewer');
select is((public.search_transactions(p_project => pg_temp.id('alpha')::text)->>'total')::int, 4,
  'a viewer reads with the same filters');

select * from finish();
rollback;
