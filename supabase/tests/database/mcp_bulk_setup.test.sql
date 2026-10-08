-- FLOW-206: create_projects and create_categories batches, and undo_batch for them.
-- Names are invented. Emails use @example.com.

begin;

select plan(24);

do $users$
begin
  perform tests.create_supabase_user('mbs_owner', 'owner@example.com');
  perform tests.create_supabase_user('mbs_other', 'other@example.com');
  perform tests.create_supabase_user('mbs_viewer', 'viewer@example.com');
end
$users$;

create temp table mbs (label text primary key, id uuid);
grant all on mbs to authenticated, service_role;
create temp table mbs_body (label text primary key, body jsonb);
grant all on mbs_body to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text, p_user text default 'mbs_owner')
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid(p_user);
  select id into tid from pg_temp.mbs where label = p_label;
  if uid is null or tid is null then
    raise exception 'missing mcp actor %', p_label;
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', uid,
      'role', 'authenticated',
      'aal', 'aal1',
      'mcp_tid', tid
    )::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp(text, text) to authenticated, service_role;

select tests.authenticate_as('mbs_owner');
select lives_ok($$select public.create_company('Fixture Co', true)$$, 'owner creates a company');
select lives_ok($$select public.upsert_project(null, 'Old Site', null, 'active')$$, 'owner opens Old Site');
insert into mbs (label, id) select 'company', id from public.companies;
insert into mbs (label, id) select 'old_site', id from public.projects where name = 'Old Site';

select tests.authenticate_as('mbs_other');
select lives_ok($$select public.create_company('Other Co', true)$$, 'other creates a company');
insert into mbs (label, id) select 'other_company', id from public.companies where name = 'Other Co';

reset role;

select lives_ok(
  format(
    $$select public.store_mcp_credential(%L::uuid, 'hash-mbs-write01', array['read','write'], now() + interval '90 days', 'pepper-1')$$,
    tests.get_supabase_uid('mbs_owner')
  ),
  'store write token'
);
insert into mbs (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-mbs-write01';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('mbs_owner'), c.id, 'hash-mbs-read001', 'pepper-1', array['read'], now() + interval '90 days'
from mbs c where c.label = 'company';
insert into mbs (label, id) select 'read', id from private.mcp_credentials where token_hash = 'hash-mbs-read001';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('mbs_other'), c.id, 'hash-mbs-otherw1', 'pepper-1', array['read','write'], now() + interval '90 days'
from mbs c where c.label = 'other_company';
insert into mbs (label, id) select 'other_write', id from private.mcp_credentials where token_hash = 'hash-mbs-otherw1';

update public.companies set is_demo = true where id = (select id from mbs where label = 'company');
insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('mbs_viewer'), c.id from mbs c where c.label = 'company';
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('mbs_viewer'), c.id, 'hash-mbs-viewer1', 'pepper-1', array['read','write'], now() + interval '90 days'
from mbs c where c.label = 'company';
insert into mbs (label, id) select 'viewer_write', id from private.mcp_credentials where token_hash = 'hash-mbs-viewer1';

-- 15 new projects, a taken name, and a bad status: 15 created, 2 refused.
insert into mbs_body (label, body)
select 'projects', jsonb_agg(item order by ord)
from (
  select n as ord, jsonb_build_object('name', 'Site ' || n) as item from generate_series(1, 15) n
  union all select 16, jsonb_build_object('name', ' Old Site ')
  union all select 17, jsonb_build_object('name', 'Site Bad', 'status', 'open')
) rows;

-- 15 new categories, an income and an expense of the same name, and a taken default name.
insert into mbs_body (label, body)
select 'categories', jsonb_agg(item order by ord)
from (
  select n as ord, jsonb_build_object('name', 'Cost ' || n, 'kind', 'expense') as item from generate_series(1, 14) n
  union all select 15, jsonb_build_object('name', 'Cost 1', 'kind', 'income')
  union all select 16, jsonb_build_object('name', 'חומרים', 'kind', 'expense')
) rows;

do $$ begin perform pg_temp.as_mcp('write'); end $$;

create temp table mbs_out (label text primary key, body jsonb);
grant all on mbs_out to authenticated, service_role;

insert into mbs_out (label, body)
select 'projects', public.mcp_create_projects('setup-p', (select body from mbs_body where label = 'projects'));

select is(
  (select body->'data'->>'ok_count' from mbs_out where label = 'projects'),
  '15',
  'the 15 new projects are created in one call'
);
select is(
  (select count(*)::int from public.projects where name like 'Site %'),
  15,
  'the projects exist'
);
select is(
  (select body->'data'->'results'->15 from mbs_out where label = 'projects'),
  jsonb_build_object(
    'name', 'Old Site',
    'ok', false,
    'code', 'refused',
    'existing_id', (select id from mbs where label = 'old_site')
  ),
  'a taken name is refused with the existing id'
);
select is(
  (select body->'data'->'results'->16->>'code' from mbs_out where label = 'projects'),
  'validation',
  'a bad status is a row validation error'
);
select is(
  (select body->'data'->'results'->0->>'id' from mbs_out where label = 'projects'),
  (select id::text from public.projects where name = 'Site 1'),
  'a created row returns its id'
);

select is(
  public.mcp_create_projects('setup-p', (select body from mbs_body where label = 'projects')),
  (select body from mbs_out where label = 'projects'),
  'the same key and rows replays the response'
);
select is(
  (select count(*)::int from public.projects where name like 'Site %'),
  15,
  'a replay creates nothing'
);
select is(
  public.mcp_create_projects('setup-p', '[{"name": "Site 99"}]'::jsonb)->'error'->>'code',
  'conflict',
  'the same key with other rows is a conflict'
);
select is(
  public.mcp_create_projects('setup-dup', '[{"name": "Site X"}, {"name": " Site X"}]'::jsonb)->'error'->>'code',
  'validation',
  'a name twice in one batch is refused before any write'
);
select is(
  public.mcp_create_projects('setup-big', (
    select jsonb_agg(jsonb_build_object('name', 'Bulk ' || n)) from generate_series(1, 101) n
  ))->'error'->>'code',
  'validation',
  'more than 100 rows is refused'
);

insert into mbs_out (label, body)
select 'categories', public.mcp_create_categories('setup-c', (select body from mbs_body where label = 'categories'));

select is(
  (select body->'data'->>'ok_count' from mbs_out where label = 'categories'),
  '15',
  'the 15 new categories are created in one call, same name allowed across kinds'
);
select is(
  (select body->'data'->'results'->15->>'existing_id' from mbs_out where label = 'categories'),
  (select id::text from public.categories where name = 'חומרים' and kind = 'expense'),
  'a taken category name returns the existing id'
);

-- undo_batch removes what the batch created, and names each row by id and name.
select is(
  public.mcp_undo_batch('undo-p', (select body->'data'->>'batch_key' from mbs_out where label = 'projects'))->'data'->>'ok_count',
  '15',
  'undo_batch removes the created projects'
);
select is(
  (select count(*)::int from public.projects where name like 'Site %'),
  0,
  'no created project is left'
);
select is(
  (select id from public.projects where name = 'Old Site'),
  (select id from mbs where label = 'old_site'),
  'the project that was already there stays'
);
select is(
  (
    select r - 'id'
    from jsonb_array_elements(
      public.mcp_undo_batch('undo-c', (select body->'data'->>'batch_key' from mbs_out where label = 'categories'))->'data'->'results'
    ) r
    limit 1
  ),
  '{"name": "Cost 1", "kind": "income", "ok": true}'::jsonb,
  'an undone category row is named, not a transaction'
);

do $$ begin perform pg_temp.as_mcp('read'); end $$;
select is(
  public.mcp_create_projects('setup-read', '[{"name": "Site R"}]'::jsonb)->'error'->>'code',
  'forbidden',
  'a read token cannot create'
);

do $$ begin perform pg_temp.as_mcp('viewer_write', 'mbs_viewer'); end $$;
select is(
  public.mcp_create_categories('setup-viewer', '[{"name": "Cost V", "kind": "expense"}]'::jsonb)->'error'->>'code',
  'forbidden',
  'a viewer cannot create'
);

do $$ begin perform pg_temp.as_mcp('other_write', 'mbs_other'); end $$;
select is(
  public.mcp_undo_batch('undo-other', (select body->'data'->>'batch_key' from mbs_out where label = 'projects'))->'error'->>'code',
  'not_found',
  'another company cannot undo the owner batch'
);
select is(
  public.mcp_create_projects('setup-other', '[{"name": "Old Site"}]'::jsonb)->'data'->>'ok_count',
  '1',
  'the other company creates its own Old Site without seeing the owner one'
);

reset role;

select * from finish();

rollback;
