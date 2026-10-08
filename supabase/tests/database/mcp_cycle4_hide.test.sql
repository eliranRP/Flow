-- MCP cycle 4: hiding a category this user created through MCP, then undoing both.
-- Emails use @example.com.

begin;

select plan(6);

select tests.create_supabase_user('mcp4h_owner', 'hide-owner@example.com');

create temp table mcp4h (label text primary key, id uuid);
grant all on mcp4h to authenticated, service_role;

select tests.authenticate_as('mcp4h_owner');
select public.create_company('Hide Co', true);
reset role;

select public.store_mcp_credential(
  tests.get_supabase_uid('mcp4h_owner'), 'hash-mcp4h-write', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into mcp4h (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-mcp4h-write';

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claim.sub', tests.get_supabase_uid('mcp4h_owner')::text, true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', tests.get_supabase_uid('mcp4h_owner'),
    'role', 'authenticated',
    'mcp_tid', (select id from mcp4h where label = 'write')
  )::text,
  true
);

insert into mcp4h (label, id)
select 'cat', (public.mcp_create_category('h-new', 'Scaffold Hire', 'expense')->'data'->>'id')::uuid;

select is(
  public.mcp_hide_category('h-hide', (select id from mcp4h where label = 'cat'))->'data'->>'undo_kind',
  'category_hidden',
  'a category created through MCP can be hidden'
);
select is(
  (select hidden from public.categories where id = (select id from mcp4h where label = 'cat')),
  true,
  'it is hidden'
);
select is(
  public.mcp_hide_category('h-hide-2', (select id from mcp4h where label = 'cat'))->>'ok',
  'true',
  'a second hide of the same category succeeds and keeps the one undoable write (FLOW-205)'
);
select is(
  public.mcp_undo('h-undo-hide', 'category_hidden', (select id from mcp4h where label = 'cat'))->'data'->>'kind',
  'category_hidden',
  'undo the hide'
);
select is(
  public.mcp_undo('h-undo-cat', 'category', (select id from mcp4h where label = 'cat'))->'data'->>'kind',
  'category',
  'undo the create'
);
select is(
  (select count(*)::int from public.categories where id = (select id from mcp4h where label = 'cat')),
  0,
  'the created category is gone'
);

select * from finish();

rollback;
