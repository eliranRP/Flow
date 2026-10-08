-- FLOW-808. The shared fixture helpers in supabase/tests/helpers.sql make the rows a test
-- expects, and only postgres can call them. Invented data only. Amounts are agorot.

begin;

select plan(14);

do $users$
begin
  perform tests.create_supabase_user('tfx_owner', 'tfx-owner@example.com');
end
$users$;

create temp table tfx (label text primary key, id uuid);
grant all on tfx to authenticated, service_role;

insert into tfx (label, id) values ('co', tests.fixture_company('tfx_owner', 'Example Fixture LLC'));
insert into tfx (label, id) values ('harbor', tests.fixture_project((select id from tfx where label = 'co'), 'Harbor'));
insert into tfx (label, id) values ('done', tests.fixture_project((select id from tfx where label = 'co'), 'Done', 'finished'));
insert into tfx (label, id) values ('materials', tests.fixture_category((select id from tfx where label = 'co'), 'Materials'));
insert into tfx (label, id) values ('draw', tests.fixture_category((select id from tfx where label = 'co'), 'Owner draw', 'expense', true));
insert into tfx (label, id) values ('sales', tests.fixture_category((select id from tfx where label = 'co'), 'Sales', 'income'));
insert into tfx (label, id) values ('cost', tests.fixture_line(
  (select id from tfx where label = 'co'), 'tfx:cost', 5000,
  p_project => (select id from tfx where label = 'harbor'), p_category => (select id from tfx where label = 'materials')));
insert into tfx (label, id) values ('sale', tests.fixture_line(
  (select id from tfx where label = 'co'), 'tfx:sale', 9000, 'income',
  (select id from tfx where label = 'harbor'), (select id from tfx where label = 'sales'), p_doc_kind => 'invoice_receipt'));
insert into tfx (label, id) values ('guess', tests.fixture_line(
  (select id from tfx where label = 'co'), 'tfx:guess', 700,
  p_category => (select id from tfx where label = 'draw'), p_line_status => 'pending', p_suggested => true));
insert into tfx (label, id) values ('usd', tests.fixture_line(
  (select id from tfx where label = 'co'), 'tfx:usd', 1200, p_currency => 'USD', p_source => 'mercury', p_pnl_role => 'overhead'));

select is(
  (select owner_id from public.companies where id = (select id from tfx where label = 'co')),
  tests.get_supabase_uid('tfx_owner'), 'fixture_company: owned by the test user');
select is(
  (select count(*)::integer from public.categories
   where company_id = (select id from tfx where label = 'co') and loan_part is not null),
  3, 'fixture_company: the interest, escrow and principal categories come with it');
select is((select status::text from public.projects where id = (select id from tfx where label = 'done')),
  'finished', 'fixture_project: takes a status');
select is((select excluded_from_pnl from public.categories where id = (select id from tfx where label = 'draw')),
  true, 'fixture_category: a kept-out category');
select is((select kind::text from public.categories where id = (select id from tfx where label = 'sales')),
  'income', 'fixture_category: an income category');

select is(
  (select row(amount_net, amount_gross, amount_original, direction::text, line_status::text, cash_date = doc_date)::text
   from public.transactions where id = (select id from tfx where label = 'cost')),
  '(-5000,-5000,5000,expense,posted,t)', 'fixture_line: an expense is negative, paid on its date');
select is(
  (select amount_net from public.transactions where id = (select id from tfx where label = 'sale')),
  9000::bigint, 'fixture_line: income is positive');
select is(
  (select row(user_assigned, category_suggested)::text from public.transactions where id = (select id from tfx where label = 'cost')),
  '(t,f)', 'fixture_line: filed by the owner by default');
select is(
  (select row(user_assigned, category_suggested, line_status::text)::text
   from public.transactions where id = (select id from tfx where label = 'guess')),
  '(f,t,pending)', 'fixture_line: p_suggested leaves the category a guess');
select is(
  (select row(currency, source::text, pnl_role::text)::text from public.transactions where id = (select id from tfx where label = 'usd')),
  '(USD,mercury,overhead)', 'fixture_line: currency, source and role');
select is(
  (select description from public.transactions where id = (select id from tfx where label = 'cost')),
  'tfx:cost', 'fixture_line: the key is the description');

-- The lines count like any other.
select tests.authenticate_as('tfx_owner');
select is(
  (public.get_project((select id from tfx where label = 'harbor'), 'cash')->>'income_agorot')::bigint,
  9000::bigint, 'a fixture line counts in get_project');

-- Only postgres writes fixtures.
select throws_ok(
  $$select tests.fixture_project((select id from tfx where label = 'co'), 'Sneaky')$$,
  '42501', null, 'an authenticated user cannot call a fixture');
reset role;
select is(
  (select count(*)::integer from public.projects where name = 'Sneaky'), 0, 'and nothing was written');

select * from finish();
rollback;
