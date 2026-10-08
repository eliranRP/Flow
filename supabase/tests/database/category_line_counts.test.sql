-- list_categories lines, split_lines and loan_used (FLOW-405 delete confirm). lines is the set
-- delete_category sends back to review: lines on the books in the category, whole or by a split
-- part, each once. Invented data only. Amounts are agorot.

begin;

select plan(12);

do $users$
begin
  perform tests.create_supabase_user('clc_owner', 'clc-owner@example.com');
  perform tests.create_supabase_user('clc_viewer', 'clc-viewer@example.com');
  perform tests.create_supabase_user('clc_other', 'clc-other@example.com');
end
$users$;

create temp table clc (label text primary key, id uuid);
grant all on clc to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.clc where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into clc (label, id) values ('co', tests.fixture_company('clc_owner', 'Example Counts LLC', true));
insert into clc (label, id) values ('other_co', tests.fixture_company('clc_other', 'Example Other Counts LLC'));
insert into clc (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example House')),
  ('wood', tests.fixture_category(pg_temp.id('co'), 'Wood')),
  ('paint', tests.fixture_category(pg_temp.id('co'), 'Paint')),
  ('empty', tests.fixture_category(pg_temp.id('co'), 'Empty')),
  ('fees', tests.fixture_category(pg_temp.id('co'), 'Bank fees')),
  ('other_wood', tests.fixture_category(pg_temp.id('other_co'), 'Wood'));
insert into public.company_viewers (user_id, company_id)
values (tests.get_supabase_uid('clc_viewer'), pg_temp.id('co'));

-- Wood: two plain lines, a void one, a removed one, and a line split between Wood and Paint
-- (its own category is null). Paint: one plain line besides the split. The other company has a
-- Wood line too.
insert into clc (label, id) values
  ('w1', tests.fixture_line(pg_temp.id('co'), 'clc:w1', 10000, p_project => pg_temp.id('house'), p_category => pg_temp.id('wood'))),
  ('w2', tests.fixture_line(pg_temp.id('co'), 'clc:w2', 20000, p_project => pg_temp.id('house'), p_category => pg_temp.id('wood'))),
  ('wv', tests.fixture_line(pg_temp.id('co'), 'clc:wv', 30000, p_project => pg_temp.id('house'), p_category => pg_temp.id('wood'), p_line_status => 'void')),
  ('wr', tests.fixture_line(pg_temp.id('co'), 'clc:wr', 40000, p_project => pg_temp.id('house'), p_category => pg_temp.id('wood'))),
  ('ws', tests.fixture_line(pg_temp.id('co'), 'clc:ws', 8000, p_project => pg_temp.id('house'))),
  ('p1', tests.fixture_line(pg_temp.id('co'), 'clc:p1', 5000, p_project => pg_temp.id('house'), p_category => pg_temp.id('paint'))),
  ('ow', tests.fixture_line(pg_temp.id('other_co'), 'clc:ow', 5000, p_category => pg_temp.id('other_wood')));
update public.transactions set removed_at = now() where id = pg_temp.id('wr');
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
values
  (pg_temp.id('co'), pg_temp.id('ws'), 1, pg_temp.id('wood'), pg_temp.id('house'), 3000),
  (pg_temp.id('co'), pg_temp.id('ws'), 2, pg_temp.id('paint'), pg_temp.id('house'), 5000);
set constraints all immediate;
set constraints all deferred;

-- A loan whose fees part is Bank fees.
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency, fees_category_id
)
values (pg_temp.id('co'), 'Example loan', 12000000, 60000, 360, '2026-01-01', 100000, 0, 'ILS', pg_temp.id('fees'));

create function pg_temp.cat(p_label text) returns jsonb
language sql
as $$ select x from jsonb_array_elements(public.list_categories()) x where (x->>'id')::uuid = pg_temp.id(p_label) $$;
grant execute on function pg_temp.cat(text) to authenticated;

select tests.authenticate_as('clc_owner');
select is((pg_temp.cat('wood')->>'lines')::integer, 3, 'Wood counts its two lines and the split line, not the void or removed ones');
select is((pg_temp.cat('wood')->>'split_lines')::integer, 1, 'one of them is split by category');
select is((pg_temp.cat('paint')->>'lines')::integer, 2, 'Paint counts its line and the same split line');
select is((pg_temp.cat('paint')->>'split_lines')::integer, 1, 'and the split once');
select is(pg_temp.cat('empty')->'lines', '0'::jsonb, 'an unused category has 0 lines');
select is(pg_temp.cat('empty')->'split_lines', '0'::jsonb, 'and 0 split lines');
select is(pg_temp.cat('fees')->'loan_used', 'true'::jsonb, 'a category a loan uses is loan_used');
select is(pg_temp.cat('wood')->'loan_used', 'false'::jsonb, 'Wood is not');
select is((select count(*)::integer from jsonb_array_elements(public.list_categories()) x where (x->>'loan_used')::boolean),
  1, 'only Bank fees is loan_used (the loan categories themselves are loan_part, not loan_used)');
select throws_ok($$select public.delete_category(pg_temp.id('fees'))$$, 'P0001', 'a loan uses this category',
  'delete refuses exactly when loan_used is true');

select tests.authenticate_as('clc_viewer');
select is((pg_temp.cat('wood')->>'lines')::integer, 3, 'a viewer reads the same counts');

select tests.authenticate_as('clc_other');
select is((select (x->>'lines')::integer from jsonb_array_elements(public.list_categories()) x where x->>'name' = 'Wood'),
  1, 'another company counts only its own lines');

select * from finish();
rollback;
