-- FLOW-406 server 1a (decision 0164): one level of sub-categories, the rules, the group_name
-- mirror, writes on a parent, list_categories and MCP set_category_parent with undo.
-- Invented data only.

begin;

select plan(29);

do $users$
begin
  perform tests.create_supabase_user('sc_owner', 'sc-owner@example.com');
  perform tests.create_supabase_user('sc_other', 'sc-other@example.com');
end
$users$;

create temp table sc (label text primary key, id uuid);
grant all on sc to authenticated, service_role;
create temp table sc_out (label text primary key, body jsonb);
grant all on sc_out to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from sc where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create function pg_temp.parent_of(p_label text) returns uuid language sql stable security definer as $$
  select c.parent_id from public.categories c where c.id = (select id from sc where label = p_label);
$$;
grant execute on function pg_temp.parent_of(text) to authenticated, service_role;

select tests.authenticate_as('sc_other');
do $o$ begin perform public.create_company('Other Books', true); end $o$;
insert into sc (label, id) select 'other_cat', public.create_category('Other Bills', 'expense');

select tests.authenticate_as('sc_owner');
do $c$ begin perform public.create_company('Sub Books', true); end $c$;
insert into sc (label, id) select 'co', id from public.companies where name = 'Sub Books';
insert into sc (label, id) values
  ('bills', public.create_category('Bills', 'expense')),
  ('water', public.create_category('Water', 'expense')),
  ('power', public.create_category('Power', 'expense')),
  ('rent_in', public.create_category('Rent In', 'income'));
insert into sc (label, id) select 'loan_cat', c.id from public.categories c
where c.company_id = pg_temp.id('co') and c.loan_part = 'principal';

-- Set a parent.
select is(
  public.set_category_parent(pg_temp.id('water'), pg_temp.id('bills')),
  jsonb_build_object('before', null, 'after', pg_temp.id('bills')),
  'the owner puts a category under a parent'
);
select is(pg_temp.parent_of('water'), pg_temp.id('bills'), 'the parent is stored');
select is(
  (select group_name from public.categories where id = pg_temp.id('water')),
  'Bills',
  'the group label mirrors the parent''s name for older app builds'
);
insert into sc (label, id) values ('gas', public.create_category('Gas', 'expense', pg_temp.id('bills')));
select is(pg_temp.parent_of('gas'), pg_temp.id('bills'), 'a category can be created under a parent');

-- The rules.
select throws_ok(
  format($$select public.set_category_parent(%L, %L)$$, pg_temp.id('power'), pg_temp.id('water')),
  '23514', 'category_parent_nested', 'a sub-category can''t be a parent'
);
select throws_ok(
  format($$select public.set_category_parent(%L, %L)$$, pg_temp.id('bills'), pg_temp.id('power')),
  '23514', 'category_parent_nested', 'a parent can''t get a parent'
);
select throws_ok(
  format($$select public.set_category_parent(%L, %L)$$, pg_temp.id('rent_in'), pg_temp.id('bills')),
  '23514', 'category_parent_kind', 'a parent is the same kind'
);
select throws_ok(
  format($$select public.set_category_parent(%L, %L)$$, pg_temp.id('loan_cat'), pg_temp.id('bills')),
  '23514', 'category_parent_loan_part', 'a loan category is never a sub-category'
);
select throws_ok(
  format($$select public.set_category_parent(%L, %L)$$, pg_temp.id('power'), pg_temp.id('loan_cat')),
  '23514', 'category_parent_loan_part', 'a loan category is never a parent'
);
select throws_ok(
  format($$select public.set_category_parent(%L, %L)$$, pg_temp.id('power'), pg_temp.id('power')),
  '23514', null, 'a category is not its own parent'
);
select throws_ok(
  format($$select public.set_category_parent(%L, %L)$$, pg_temp.id('power'), pg_temp.id('other_cat')),
  'P0001', 'parent not found', 'a parent from another company is refused'
);

-- The old group writes move the parent.
select lives_ok(
  format($$select public.set_category_group(%L, 'Utilities')$$, pg_temp.id('power')),
  'set_category_group still works'
);
insert into sc (label, id) select 'utilities', c.id from public.categories c
where c.company_id = pg_temp.id('co') and c.name = 'Utilities' and c.kind = 'expense';
select is(pg_temp.parent_of('power'), pg_temp.id('utilities'), 'a group name becomes a parent category of that name');
select lives_ok(
  format($$select public.set_category_group(%L, null)$$, pg_temp.id('power')),
  'clearing the group'
);
select is(pg_temp.parent_of('power'), null::uuid, 'clears the parent');

-- A renamed parent renames its children's label.
select lives_ok(format($$select public.rename_category(%L, 'House Bills')$$, pg_temp.id('bills')), 'the parent is renamed');
select is(
  (select group_name from public.categories where id = pg_temp.id('water')),
  'House Bills',
  'its children''s label follows'
);

-- Writes on a parent.
select throws_ok(
  format($$select public.delete_category(%L)$$, pg_temp.id('bills')),
  '23514', 'category_has_children', 'a parent with sub-categories can''t be deleted'
);
select throws_ok(
  format($$select public.merge_category(%L, %L)$$, pg_temp.id('bills'), pg_temp.id('power')),
  '23514', 'category_has_children', 'or merged away'
);
select lives_ok(format($$select public.delete_category(%L)$$, pg_temp.id('gas')), 'a sub-category can be deleted');

-- list_categories.
select is(
  (select jsonb_build_object('parent_id', e->'parent_id', 'children', e->'children_count')
   from jsonb_array_elements(public.list_categories()) e where e->>'id' = pg_temp.id('bills')::text),
  jsonb_build_object('parent_id', null, 'children', 1),
  'list_categories shows a parent''s sub-category count'
);
select is(
  (select e->>'parent_id' from jsonb_array_elements(public.list_categories()) e where e->>'id' = pg_temp.id('water')::text),
  pg_temp.id('bills')::text,
  'and each sub-category''s parent'
);

-- Other users.
select tests.authenticate_as('sc_other');
select throws_ok(
  format($$select public.set_category_parent(%L, null)$$, pg_temp.id('water')),
  'P0001', 'category not found', 'another company''s category is not found'
);

-- MCP set_category_parent with undo.
reset role;
select public.store_mcp_credential(tests.get_supabase_uid('sc_owner'), 'hash-sc-write-0001', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into sc (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-sc-write-0001';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('sc_owner');
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
insert into sc_out (label, body) values ('mcp', public.mcp_set_category_parent('sc-parent-1', pg_temp.id('power'), pg_temp.id('bills')));
select is(
  (select body->'data'->>'undo_kind' || ':' || coalesce(body->'data'->>'prior', 'none') from sc_out where label = 'mcp'),
  'category_parent:none',
  'MCP set_category_parent answers with its undo kind and the parent before'
);
select is(public.mcp_undo('sc-undo-1', 'category_parent', pg_temp.id('power'))->>'ok', 'true', 'undo takes it out again');
select is(pg_temp.parent_of('power'), null::uuid, 'the parent is gone after undo');
select is(
  public.mcp_set_category_parent('sc-parent-2', pg_temp.id('power'), pg_temp.id('water'))->'error'->>'code',
  'refused',
  'the rules hold through MCP'
);
select is(
  public.mcp_create_category('sc-create-1', 'Sewer', 'expense', pg_temp.id('bills'))->'data'->>'parent_id',
  pg_temp.id('bills')::text,
  'MCP create_category takes a parent'
);
select is(
  (public.mcp_create_categories('sc-batch-1', jsonb_build_array(
    jsonb_build_object('name', 'Trash', 'kind', 'expense', 'parent_id', pg_temp.id('bills')),
    jsonb_build_object('name', 'Rent Bonus', 'kind', 'income', 'parent_id', pg_temp.id('bills'))
  ))->'data'->>'ok_count')::int,
  1,
  'MCP create_categories sets parents row by row; a wrong-kind parent fails only its row'
);

select * from finish();
rollback;
