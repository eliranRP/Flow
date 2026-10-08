-- FLOW-405 (decision 0144). delete_category with lines (back to review, undo through
-- restore_category), move_category_lines with undo_category_move, merge_category on the same
-- move, and the MCP tools delete_category and move_category_lines with undo. Invented data
-- only. Amounts are agorot.

begin;

select plan(66);

do $users$
begin
  perform tests.create_supabase_user('cdm_owner', 'cdm-owner@example.com');
  perform tests.create_supabase_user('cdm_viewer', 'cdm-viewer@example.com');
  perform tests.create_supabase_user('cdm_other', 'cdm-other@example.com');
end
$users$;

create temp table cdm (label text primary key, id uuid);
grant all on cdm to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.cdm where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into cdm (label, id) values ('co', tests.fixture_company('cdm_owner', 'Example Categories LLC', true));
insert into cdm (label, id) values ('other_co', tests.fixture_company('cdm_other', 'Example Other Categories LLC'));
insert into cdm (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example House')),
  ('gone', tests.fixture_category(pg_temp.id('co'), 'Gone')),
  ('old', tests.fixture_category(pg_temp.id('co'), 'Old')),
  ('kept', tests.fixture_category(pg_temp.id('co'), 'Kept')),
  ('spare', tests.fixture_category(pg_temp.id('co'), 'Spare')),
  ('other', tests.fixture_category(pg_temp.id('co'), 'Other')),
  ('fees', tests.fixture_category(pg_temp.id('co'), 'Bank fees')),
  ('shut', tests.fixture_category(pg_temp.id('co'), 'Shut')),
  ('sales', tests.fixture_category(pg_temp.id('co'), 'Sales', 'income')),
  ('other_cat', tests.fixture_category(pg_temp.id('other_co'), 'Other company'));
update public.categories set hidden = true where id = pg_temp.id('shut');
insert into cdm (label, id)
select 'interest', c.id from public.categories c
where c.company_id = pg_temp.id('co') and c.loan_part = 'interest';
insert into public.company_viewers (user_id, company_id)
values (tests.get_supabase_uid('cdm_viewer'), pg_temp.id('co'));

-- Lines in Gone: two plain ones, one that already has an open review, one void, and a line
-- split between Gone and Spare.
insert into cdm (label, id) values
  ('g1', tests.fixture_line(pg_temp.id('co'), 'cdm:g1', 10000, p_project => pg_temp.id('house'), p_category => pg_temp.id('gone'))),
  ('g2', tests.fixture_line(pg_temp.id('co'), 'cdm:g2', 20000, p_project => pg_temp.id('house'), p_category => pg_temp.id('gone'))),
  ('g3', tests.fixture_line(pg_temp.id('co'), 'cdm:g3', 30000, p_project => pg_temp.id('house'), p_category => pg_temp.id('gone'))),
  ('gv', tests.fixture_line(pg_temp.id('co'), 'cdm:gv', 40000, p_project => pg_temp.id('house'), p_category => pg_temp.id('gone'), p_line_status => 'void')),
  ('gs', tests.fixture_line(pg_temp.id('co'), 'cdm:gs', 100000, p_project => pg_temp.id('house'), p_category => pg_temp.id('other'))),
  -- Lines in Old, one guessed (user_assigned false), and a line split between Old and Spare.
  ('o1', tests.fixture_line(pg_temp.id('co'), 'cdm:o1', 5000, p_project => pg_temp.id('house'), p_category => pg_temp.id('old'))),
  ('o2', tests.fixture_line(pg_temp.id('co'), 'cdm:o2', 6000, p_project => pg_temp.id('house'), p_category => pg_temp.id('old'), p_suggested => true)),
  ('os', tests.fixture_line(pg_temp.id('co'), 'cdm:os', 2000, p_project => pg_temp.id('house'), p_category => pg_temp.id('other'))),
  ('k1', tests.fixture_line(pg_temp.id('co'), 'cdm:k1', 7000, p_project => pg_temp.id('house'), p_category => pg_temp.id('kept')));
update public.transactions set user_assigned = false where id = pg_temp.id('o2');
insert into public.review_queue (company_id, transaction_id, status, reason)
values (pg_temp.id('co'), pg_temp.id('g3'), 'open', 'suggested');
insert into public.suppliers (company_id, name, remembered_category_id) values
  (pg_temp.id('co'), 'Example Gone Supplier', pg_temp.id('gone')),
  (pg_temp.id('co'), 'Example Old Supplier', pg_temp.id('old'));
insert into cdm (label, id)
select case s.name when 'Example Gone Supplier' then 'sup_gone' else 'sup_old' end, s.id
from public.suppliers s where s.company_id = pg_temp.id('co');

-- A loan whose fees part is Bank fees.
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency, fees_category_id
)
values (pg_temp.id('co'), 'Example loan', 12000000, 60000, 360, '2026-01-01', 100000, 0, 'ILS', pg_temp.id('fees'));

create function pg_temp.part(p_category text, p_amount bigint) returns jsonb
language sql
as $$
  select jsonb_build_object('category_id', pg_temp.id(p_category), 'amount_minor', p_amount, 'project_id', pg_temp.id('house'))
$$;
grant execute on function pg_temp.part(text, bigint) to authenticated;

create function pg_temp.cat_of(p_line text) returns uuid
language sql
as $$ select category_id from public.transactions where id = pg_temp.id(p_line) $$;
grant execute on function pg_temp.cat_of(text) to authenticated;

create function pg_temp.parts(p_line text) returns text
language sql
as $$
  select coalesce(string_agg(c.name || ':' || abs(s.amount_minor), ',' order by s.ordinal), '')
  from public.line_splits s join public.categories c on c.id = s.category_id
  where s.transaction_id = pg_temp.id(p_line)
$$;
grant execute on function pg_temp.parts(text) to authenticated;

create function pg_temp.open_reviews(p_line text) returns integer
language sql
as $$ select count(*)::integer from public.review_queue where transaction_id = pg_temp.id(p_line) and status = 'open' $$;
grant execute on function pg_temp.open_reviews(text) to authenticated;

create function pg_temp.remembered(p_supplier text) returns uuid
language sql
as $$ select remembered_category_id from public.suppliers where id = pg_temp.id(p_supplier) $$;
grant execute on function pg_temp.remembered(text) to authenticated;

create temp table cdm_out (label text primary key, body jsonb);
grant all on cdm_out to authenticated, service_role;

select tests.authenticate_as('cdm_owner');
select public.save_line_split(pg_temp.id('gs'), jsonb_build_array(pg_temp.part('gone', 40000), pg_temp.part('spare', 60000)));
select public.save_line_split(pg_temp.id('os'), jsonb_build_array(pg_temp.part('old', 500), pg_temp.part('spare', 1500)));
reset role;
-- Whatever review rows the splits opened go, so the counts below are the delete's.
delete from public.review_queue where transaction_id in (pg_temp.id('gs'), pg_temp.id('os'));

-- Delete with lines.
select tests.authenticate_as('cdm_owner');
insert into cdm_out (label, body) values ('del', public.delete_category(pg_temp.id('gone')));
select is((select (body->>'lines')::integer from cdm_out where label = 'del'), 4,
  'delete counts the lines on the books: three plain ones and the split one, not the void one');
select is((select body->>'name' from cdm_out where label = 'del'), 'Gone', 'and names the category');
select is((select count(*)::integer from public.categories where id = pg_temp.id('gone')), 0, 'the category is gone');
select is(pg_temp.cat_of('g1'), null::uuid, 'its lines have no category');
select is((select category_assigned from public.transactions where id = pg_temp.id('g1')), true,
  'and are marked as left without one, so nothing guesses a category');
select is(pg_temp.parts('gs'), '', 'a split line loses its whole split');
select is(pg_temp.cat_of('gs'), null::uuid, 'and has no category');
select is(pg_temp.open_reviews('g1') + pg_temp.open_reviews('g2') + pg_temp.open_reviews('gs'), 3,
  'each line goes back to review');
select is((select reason from public.review_queue where transaction_id = pg_temp.id('g1') and status = 'open'),
  'missing_category', 'as a line with no category');
select is(pg_temp.open_reviews('g3'), 1, 'a line already in review gets no second row');
select is(pg_temp.open_reviews('gv'), 0, 'a void line does not go to review');
select is(pg_temp.remembered('sup_gone'), null::uuid, 'the supplier forgets the category');

reset role;
update public.transactions set description = 'touched' where id = pg_temp.id('g2');
select is(pg_temp.cat_of('g2'), null::uuid, 'a later edit of the line does not guess a category');
select tests.authenticate_as('cdm_owner');

-- Restore.
select lives_ok(format('select public.restore_category(%L)', pg_temp.id('gone')), 'restore puts the category back');
select is((select name from public.categories where id = pg_temp.id('gone')), 'Gone', 'with its id and name');
select is(pg_temp.cat_of('g1'), pg_temp.id('gone'), 'its lines are back in it');
select is((select category_assigned from public.transactions where id = pg_temp.id('g1')), true,
  'with their old flags');
select is(pg_temp.parts('gs'), 'Gone:40000,Spare:60000', 'the split is back');
select is(pg_temp.open_reviews('g1') + pg_temp.open_reviews('g2') + pg_temp.open_reviews('gs'), 0,
  'the reviews the delete opened are gone');
select is(pg_temp.open_reviews('g3'), 1, 'the review that was there before stays');
select is(pg_temp.remembered('sup_gone'), pg_temp.id('gone'), 'the supplier remembers it again');
select throws_ok(format('select public.restore_category(%L)', pg_temp.id('gone')),
  'P0001', 'category not found', 'a second restore finds nothing to restore');

-- A restore after a line was re-tagged is refused and changes nothing.
select public.delete_category(pg_temp.id('gone'));
reset role;
update public.transactions set category_id = pg_temp.id('kept') where id = pg_temp.id('g1');
select tests.authenticate_as('cdm_owner');
select throws_ok(format('select public.restore_category(%L)', pg_temp.id('gone')),
  '23514', 'category cannot be restored', 'restore is refused once a line has a category again');
select is((select count(*)::integer from public.categories where id = pg_temp.id('gone')), 0, 'and changes nothing');
select is(pg_temp.cat_of('g2'), null::uuid, 'the other lines stay untagged');

-- A restore when the name was taken again is refused too.
reset role;
update public.transactions set category_id = null where id = pg_temp.id('g1');
insert into cdm (label, id) values ('gone2', tests.fixture_category(pg_temp.id('co'), 'Gone'));
select tests.authenticate_as('cdm_owner');
select throws_ok(format('select public.restore_category(%L)', pg_temp.id('gone')),
  '23514', 'category cannot be restored', 'restore is refused when the name is taken again');
reset role;
delete from public.categories where id = pg_temp.id('gone2');
select tests.authenticate_as('cdm_owner');
select lives_ok(format('select public.restore_category(%L)', pg_temp.id('gone')), 'and works once it is free');

-- Refusals.
select throws_ok(format('select public.delete_category(%L)', pg_temp.id('interest')),
  'P0001', 'loan category is fixed', 'a loan category cannot be deleted');
select throws_ok(format('select public.delete_category(%L)', pg_temp.id('fees')),
  'P0001', 'a loan uses this category', 'nor one a loan uses');
select throws_ok(format('select public.delete_category(%L)', pg_temp.id('other_cat')),
  'P0001', 'category not found', 'nor another company''s');

-- Move all lines from Old to Kept.
insert into cdm_out (label, body) values ('move', public.move_category_lines(pg_temp.id('old'), pg_temp.id('kept')));
select is((select (body->>'lines')::integer from cdm_out where label = 'move'), 3,
  'the move counts two lines and the split one');
select is(pg_temp.cat_of('o1'), pg_temp.id('kept'), 'the lines are in Kept');
select is((select user_assigned from public.transactions where id = pg_temp.id('o2')), true,
  'a guessed line becomes the owner''s choice');
select is(pg_temp.parts('os'), 'Kept:500,Spare:1500', 'the split part moves');
select is(pg_temp.remembered('sup_old'), pg_temp.id('kept'), 'and the remembered category');
select is((select hidden from public.categories where id = pg_temp.id('old')), false, 'Old stays and is not hidden');

select lives_ok(format('select public.undo_category_move(%L)', (select body->>'move_id' from cdm_out where label = 'move')),
  'undo moves them back');
select is(pg_temp.cat_of('o1'), pg_temp.id('old'), 'the lines are in Old again');
select is((select user_assigned from public.transactions where id = pg_temp.id('o2')), false, 'with their old flags');
select is(pg_temp.parts('os'), 'Old:500,Spare:1500', 'the split part too');
select is(pg_temp.cat_of('k1'), pg_temp.id('kept'), 'a line that was in Kept before stays there');
select is(pg_temp.remembered('sup_old'), pg_temp.id('old'), 'the supplier remembers Old again');
select throws_ok(format('select public.undo_category_move(%L)', (select body->>'move_id' from cdm_out where label = 'move')),
  'P0001', 'move not found', 'a second undo finds nothing');

-- An undo after a moved line was re-tagged is refused and changes nothing.
insert into cdm_out (label, body) values ('move2', public.move_category_lines(pg_temp.id('old'), pg_temp.id('kept')));
reset role;
update public.transactions set category_id = pg_temp.id('spare') where id = pg_temp.id('o1');
select tests.authenticate_as('cdm_owner');
select throws_ok(format('select public.undo_category_move(%L)', (select body->>'move_id' from cdm_out where label = 'move2')),
  '23514', 'category move cannot be undone', 'undo is refused once a moved line was re-tagged');
select is(pg_temp.cat_of('o2'), pg_temp.id('kept'), 'and changes nothing');

select throws_ok(format('select public.move_category_lines(%L, %L)', pg_temp.id('kept'), pg_temp.id('sales')),
  'P0001', 'categories must be the same kind', 'a move between kinds is refused');
select throws_ok(format('select public.move_category_lines(%L, %L)', pg_temp.id('kept'), pg_temp.id('kept')),
  'P0001', 'pick a different category', 'a move into itself is refused');
select throws_ok(format('select public.move_category_lines(%L, %L)', pg_temp.id('kept'), pg_temp.id('shut')),
  'P0001', 'category not found', 'a move into a hidden category is refused');

-- Merge is the move plus hiding the source.
select public.merge_category(pg_temp.id('spare'), pg_temp.id('other'));
select is((select hidden from public.categories where id = pg_temp.id('spare')), true, 'merge hides the source');
select is(pg_temp.parts('os'), 'Kept:500,Other:1500', 'and moves its split parts');

-- A viewer cannot.
select tests.authenticate_as('cdm_viewer');
select throws_ok(format('select public.delete_category(%L)', pg_temp.id('kept')), '42501', 'forbidden',
  'a viewer cannot delete a category');
select throws_ok(format('select public.move_category_lines(%L, %L)', pg_temp.id('kept'), pg_temp.id('old')), '42501', 'forbidden',
  'nor move its lines');

-- MCP.
reset role;
select public.store_mcp_credential(tests.get_supabase_uid('cdm_owner'), 'hash-cdm-write01', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into cdm (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-cdm-write01';
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('cdm_owner'), pg_temp.id('co'), 'hash-cdm-read001', 'pepper-1', array['read'], now() + interval '90 days');
insert into cdm (label, id) select 'read', id from private.mcp_credentials where token_hash = 'hash-cdm-read001';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('cdm_owner');
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
insert into cdm_out (label, body) values ('mcp_del', public.mcp_delete_category('cdm-del-1', pg_temp.id('gone')));
select is((select body->'data'->>'undo_kind' from cdm_out where label = 'mcp_del'), 'category_delete',
  'MCP delete_category answers with its undo kind');
select is((select (body->'data'->>'lines')::integer from cdm_out where label = 'mcp_del'), 4, 'and the line count');
select is(public.mcp_delete_category('cdm-del-1', pg_temp.id('gone')), (select body from cdm_out where label = 'mcp_del'),
  'a replay returns the same answer');
select is(public.mcp_undo('cdm-undo-1', 'category_delete', pg_temp.id('gone'))->>'ok', 'true', 'undo puts it back');
select is(pg_temp.cat_of('g2'), pg_temp.id('gone'), 'with its lines');
select is(public.mcp_undo('cdm-undo-2', 'category_delete', pg_temp.id('gone'))->'error'->>'code', 'not_found',
  'a second undo finds nothing');
select is(public.mcp_delete_category('cdm-del-2', pg_temp.id('fees'))->'error'->>'message', 'a loan uses this category',
  'a refusal names the reason');

-- An MCP delete the app already restored has nothing to undo.
select public.mcp_delete_category('cdm-del-3', pg_temp.id('gone'));
select public.restore_category(pg_temp.id('gone'));
select is(public.mcp_undo('cdm-undo-3', 'category_delete', pg_temp.id('gone'))->'error'->>'code', 'not_found',
  'undo after the app restored it finds nothing');

select is((public.mcp_move_category_lines('cdm-move-1', pg_temp.id('gone'), pg_temp.id('kept'))->'data'->>'lines')::integer, 4,
  'MCP move_category_lines moves the lines and counts those on the books');
select is(pg_temp.cat_of('gv'), pg_temp.id('kept'), 'a void line moves too');
select is(public.mcp_undo('cdm-undo-4', 'category_move', pg_temp.id('gone'))->>'ok', 'true', 'undo moves them back');
select is(pg_temp.cat_of('g2'), pg_temp.id('gone'), 'to the source');

select public.mcp_move_category_lines('cdm-move-2', pg_temp.id('gone'), pg_temp.id('kept'));
reset role;
update public.transactions set category_id = pg_temp.id('old') where id = pg_temp.id('g2');
select pg_temp.as_mcp('write');
select is(public.mcp_undo('cdm-undo-5', 'category_move', pg_temp.id('gone'))->'error'->>'code', 'conflict',
  'undo after a moved line was re-tagged is a conflict');

select pg_temp.as_mcp('read');
select is(public.mcp_delete_category('cdm-del-4', pg_temp.id('kept'))->'error'->>'code', 'forbidden',
  'a read-only token cannot delete');

select * from finish();
rollback;
