-- FLOW-325, the #135 review items (decision 0138): get_project parts_minor is signed by the
-- part's kind, a kept-out reversal part needs no project, and a part with no project is the
-- same pair as one naming the line's project. Invented data only. Amounts are agorot.

begin;

select plan(18);

do $users$
begin
  perform tests.create_supabase_user('lsf_owner', 'lsf-owner@example.com');
end
$users$;

create temp table lsf (label text primary key, id uuid);
grant all on lsf to authenticated, service_role;

insert into lsf (label, id) values ('co', tests.fixture_company('lsf_owner', 'Example Split Follow-ups LLC'));
insert into lsf (label, id) values
  ('alpha', tests.fixture_project((select id from lsf where label = 'co'), 'Alpha')),
  ('beta', tests.fixture_project((select id from lsf where label = 'co'), 'Beta')),
  ('sales', tests.fixture_category((select id from lsf where label = 'co'), 'Sales', 'income')),
  ('costs', tests.fixture_category((select id from lsf where label = 'co'), 'Costs')),
  ('materials', tests.fixture_category((select id from lsf where label = 'co'), 'Materials')),
  ('draws', tests.fixture_category((select id from lsf where label = 'co'), 'Owner draws', 'expense', true));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.lsf where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- A refund that landed as income on Alpha, an expense on Alpha, and an expense with no project.
insert into lsf (label, id) values
  ('refund', tests.fixture_line(pg_temp.id('co'), 'lsf:refund', 10000, 'income', pg_temp.id('alpha'), pg_temp.id('sales'))),
  ('refund_b', tests.fixture_line(pg_temp.id('co'), 'lsf:refund_b', 10000, 'income', pg_temp.id('alpha'), pg_temp.id('sales'))),
  ('expense', tests.fixture_line(pg_temp.id('co'), 'lsf:expense', 10000, 'expense', pg_temp.id('alpha'), pg_temp.id('costs'))),
  ('refund_c', tests.fixture_line(pg_temp.id('co'), 'lsf:refund_c', 10000, 'income', pg_temp.id('alpha'), pg_temp.id('sales'))),
  ('bounce', tests.fixture_line(pg_temp.id('co'), 'lsf:bounce', 10000, 'income', pg_temp.id('alpha'), pg_temp.id('costs'))),
  ('loose', tests.fixture_line(pg_temp.id('co'), 'lsf:loose', 10000, 'expense', null, pg_temp.id('costs'), p_pnl_role => 'overhead'));

create or replace function pg_temp.parts_minor(p_project text, p_line text)
returns bigint
language sql
as $$
  select (r->>'parts_minor')::bigint
  from jsonb_array_elements(public.get_project(pg_temp.id(p_project), 'cash')->'transactions') r
  where r->>'id' = pg_temp.id(p_line)::text;
$$;
grant execute on function pg_temp.parts_minor(text, text) to authenticated, service_role;

select tests.authenticate_as('lsf_owner');

-- Kept-out reversal parts.
select lives_ok(
  format($$select public.save_line_split(%L, %L::jsonb)$$, pg_temp.id('refund'),
    jsonb_build_array(jsonb_build_object('category_id', pg_temp.id('draws'), 'amount_minor', 3000), jsonb_build_object('rest', true))),
  'a reversal part in a kept-out category needs no project');
select is(
  (select row(s.category_id = pg_temp.id('draws'), s.project_id is null, s.amount_minor)::text
   from public.line_splits s where s.transaction_id = pg_temp.id('refund') and s.ordinal = 1),
  '(t,t,3000)', 'and it is stored with no project');
select throws_ok(
  format($$select public.save_line_split(%L, %L::jsonb)$$, pg_temp.id('refund_b'),
    jsonb_build_array(jsonb_build_object('category_id', pg_temp.id('costs'), 'amount_minor', 3000), jsonb_build_object('rest', true))),
  'P0001', 'a reversal part needs a project', 'a reversal part in a P&L category still needs one');

-- Signed parts_minor on the project's line list.
select is(pg_temp.parts_minor('alpha', 'refund'), 4000::bigint,
  'the kept-out reversal part keeps the line''s project and counts minus: 70.00 less 30.00');
select lives_ok(
  format($$select public.save_line_split(%L, %L::jsonb)$$, pg_temp.id('refund_b'),
    jsonb_build_array(
      jsonb_build_object('category_id', pg_temp.id('costs'), 'project_id', pg_temp.id('alpha'), 'amount_minor', 3000),
      jsonb_build_object('category_id', pg_temp.id('costs'), 'project_id', pg_temp.id('beta'), 'amount_minor', 2000),
      jsonb_build_object('rest', true))),
  'reversal parts on Alpha and Beta, the rest on the line');
select is(pg_temp.parts_minor('alpha', 'refund_b'), 2000::bigint,
  'Alpha: the 50.00 rest less the 30.00 reversal');
select is(pg_temp.parts_minor('beta', 'refund_b'), -2000::bigint,
  'Beta: the 20.00 reversal counts minus');
select lives_ok(
  format($$select public.save_line_split(%L, %L::jsonb)$$, pg_temp.id('expense'),
    jsonb_build_array(
      jsonb_build_object('category_id', pg_temp.id('materials'), 'amount_minor', 4000),
      jsonb_build_object('category_id', pg_temp.id('materials'), 'project_id', pg_temp.id('beta'), 'amount_minor', 6000))),
  'an expense split between Alpha and Beta');
select is(pg_temp.parts_minor('alpha', 'expense'), 4000::bigint, 'parts of the line''s own kind count plus');

-- No project is the line's project.
select throws_ok(
  format($$select public.save_line_split(%L, %L::jsonb, true)$$, pg_temp.id('expense'),
    jsonb_build_array(
      jsonb_build_object('category_id', pg_temp.id('materials'), 'amount_minor', 4000),
      jsonb_build_object('category_id', pg_temp.id('materials'), 'project_id', pg_temp.id('alpha'), 'amount_minor', 6000))),
  'P0001', 'same category and project twice', 'no project and the line''s own project are the same pair');
select throws_ok(
  format($$select public.save_line_split(%L, %L::jsonb, true)$$, pg_temp.id('loose'),
    jsonb_build_array(
      jsonb_build_object('category_id', pg_temp.id('materials'), 'amount_minor', 4000),
      jsonb_build_object('category_id', pg_temp.id('materials'), 'amount_minor', 6000))),
  'P0001', 'same category and project twice', 'on a line with no project, two parts with none are the same pair (a guard: refused before too)');
select lives_ok(
  format($$select public.save_line_split(%L, %L::jsonb, true)$$, pg_temp.id('loose'),
    jsonb_build_array(
      jsonb_build_object('category_id', pg_temp.id('materials'), 'amount_minor', 4000),
      jsonb_build_object('category_id', pg_temp.id('materials'), 'project_id', pg_temp.id('alpha'), 'amount_minor', 6000))),
  'on a line with no project, a part on Alpha is another pair');

-- A line put in the P&L counts its kept-out parts, so there a kept-out reversal part needs a project.
select throws_ok(
  format($$select public.set_transaction_pnl(%L, true)$$, pg_temp.id('refund')),
  'P0001', 'a reversal part needs a project', 'putting a line with a kept-out reversal part on no project in the P&L is refused');
select lives_ok(format($$select public.set_transaction_pnl(%L, true)$$, pg_temp.id('refund_c')),
  'the owner puts another refund in the P&L');
select throws_ok(
  format($$select public.save_line_split(%L, %L::jsonb)$$, pg_temp.id('refund_c'),
    jsonb_build_array(jsonb_build_object('category_id', pg_temp.id('draws'), 'amount_minor', 3000), jsonb_build_object('rest', true))),
  'P0001', 'a reversal part needs a project', 'on a line in the P&L, a kept-out reversal part needs a project');

-- A whole reversal line (income filed in an expense category): its own kind is expense.
select lives_ok(
  format($$select public.save_line_split(%L, %L::jsonb)$$, pg_temp.id('bounce'),
    jsonb_build_array(
      jsonb_build_object('category_id', pg_temp.id('sales'), 'project_id', pg_temp.id('alpha'), 'amount_minor', 3000),
      jsonb_build_object('rest', true))),
  'a whole reversal line split with an income part on Alpha');
select is(pg_temp.parts_minor('alpha', 'bounce'), 4000::bigint,
  'the rest in the line''s own expense category counts plus, the income part minus');

reset role;
select is((select count(*)::int from public.line_splits where transaction_id = pg_temp.id('loose')), 0,
  'previews write nothing');

select * from finish();
rollback;
