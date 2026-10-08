-- rename_category and MCP rename_category with undo kind category_name (decision 0148). A
-- rename keeps the id, so lines, loan links and flags stay. Invented data only.

begin;

select plan(22);

do $users$
begin
  perform tests.create_supabase_user('crn_owner', 'crn-owner@example.com');
  perform tests.create_supabase_user('crn_viewer', 'crn-viewer@example.com');
  perform tests.create_supabase_user('crn_other', 'crn-other@example.com');
end
$users$;

create temp table crn (label text primary key, id uuid);
grant all on crn to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.crn where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into crn (label, id) values ('co', tests.fixture_company('crn_owner', 'Example Rename LLC', true));
insert into crn (label, id) values ('other_co', tests.fixture_company('crn_other', 'Example Other Rename LLC'));
insert into public.company_viewers (user_id, company_id)
values (tests.get_supabase_uid('crn_viewer'), pg_temp.id('co'));
insert into crn (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example House')),
  ('utilities', tests.fixture_category(pg_temp.id('co'), 'Utilities')),
  ('sales', tests.fixture_category(pg_temp.id('co'), 'Sales', 'income')),
  ('other_cat', tests.fixture_category(pg_temp.id('other_co'), 'Utilities'));
insert into crn (label, id)
select 'interest', c.id from public.categories c where c.company_id = pg_temp.id('co') and c.loan_part = 'interest';
insert into crn (label, id) values
  ('u1', tests.fixture_line(pg_temp.id('co'), 'crn:u1', 10000, p_project => pg_temp.id('house'), p_category => pg_temp.id('utilities')));
update public.categories set rehab = true where id = pg_temp.id('utilities');

select tests.authenticate_as('crn_owner');
select is(public.rename_category(pg_temp.id('utilities'), '  חשמל ומים ')::jsonb - 'id',
  '{"name": "חשמל ומים", "before": "Utilities", "after": "חשמל ומים"}'::jsonb, 'renamed, trimmed, with the name before');
select is((select category_id from public.transactions where id = pg_temp.id('u1')), pg_temp.id('utilities'), 'the line keeps its category');
select is((select rehab from public.categories where id = pg_temp.id('utilities')), true, 'its flags stay');
select is(public.rename_category(pg_temp.id('interest'), 'ריבית')->>'after', 'ריבית', 'a loan category can be renamed');
select is((select loan_part::text from public.categories where id = pg_temp.id('interest')), 'interest', 'and keeps its loan part');
select throws_ok($$select public.rename_category(pg_temp.id('utilities'), 'א')$$, 'P0001', 'category name is too short', 'two letters at least');
select throws_ok($$select public.rename_category(pg_temp.id('utilities'), repeat('א', 121))$$, 'P0001', 'category name is too long', '120 letters at most');
select throws_ok($$select public.rename_category(pg_temp.id('utilities'), 'אחר')$$, 'P0001', 'category already exists',
  'not a name another expense category has');
select is(public.rename_category(pg_temp.id('sales'), 'אחר')->>'after', 'אחר', 'an income category may share an expense name');
select throws_ok($$select public.rename_category(pg_temp.id('other_cat'), 'זר')$$, 'P0001', 'category not found', 'not another company''s');

select tests.authenticate_as('crn_viewer');
select throws_ok($$select public.rename_category(pg_temp.id('utilities'), 'צפייה')$$, '42501', 'forbidden', 'a viewer cannot rename');

-- MCP rename_category with undo.
reset role;
select public.store_mcp_credential(tests.get_supabase_uid('crn_owner'), 'hash-crn-write01', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into crn (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-crn-write01';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('crn_owner');
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
select is(public.mcp_rename_category('crn-1', pg_temp.id('utilities'), 'חשבונות בית')->'data'->>'undo_kind', 'category_name',
  'MCP rename answers with its undo kind');
select is(public.mcp_rename_category('crn-1', pg_temp.id('utilities'), 'חשבונות בית')->'data'->>'prior', 'חשמל ומים',
  'a replay answers the same');
select is(public.mcp_rename_category('crn-1', pg_temp.id('utilities'), 'אחר')->'error'->>'code', 'conflict',
  'the same key with another name is a conflict');
select is(public.mcp_rename_category('crn-2', pg_temp.id('utilities'), 'אחר')->'error'->>'code', 'refused',
  'a taken name is refused');
select is(public.mcp_undo('crn-u1', 'category_name', pg_temp.id('utilities'))->>'ok', 'true', 'undo puts the old name back');
select is((select name from public.categories where id = pg_temp.id('utilities')), 'חשמל ומים', 'it is the old name');

select public.mcp_rename_category('crn-3', pg_temp.id('utilities'), 'חשמל');
select public.rename_category(pg_temp.id('utilities'), 'מים');
select is(public.mcp_undo('crn-u2', 'category_name', pg_temp.id('utilities'))->'error'->>'code', 'conflict',
  'undo is a conflict once it was renamed again');

-- The P&L flag stays through a rename and its undo, whatever the new name.
reset role;
insert into crn (label, id) values
  ('repairs', tests.fixture_category(pg_temp.id('co'), 'Repairs')),
  ('capex', tests.fixture_category(pg_temp.id('co'), 'Capex & rehab'));
update public.categories set excluded_from_pnl = true where id = pg_temp.id('capex');
select pg_temp.as_mcp('write');
select public.mcp_rename_category('crn-4', pg_temp.id('repairs'), 'Capex and rehab costs');
select public.mcp_rename_category('crn-5', pg_temp.id('repairs'), 'Capex & Rehab');
select is((select excluded_from_pnl from public.categories where id = pg_temp.id('repairs')), false,
  'renaming to a non-P&L name keeps the category in the P&L');
select is(public.mcp_undo('crn-u5', 'category_name', pg_temp.id('repairs'))->>'ok', 'true', 'undo of that rename works');
select is((select excluded_from_pnl from public.categories where id = pg_temp.id('repairs')), false,
  'and the category stays in the P&L');
select public.rename_category(pg_temp.id('capex'), 'Renovation');
select is((select excluded_from_pnl from public.categories where id = pg_temp.id('capex')), true,
  'a category kept out of the P&L stays out after a rename');

select * from finish();
rollback;
