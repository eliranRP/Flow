-- FLOW-406 server 2 (decision 0164): project groups. A group is a sum of its projects' rows,
-- company totals never change, viewers read, other companies see nothing, and the MCP writes
-- undo. Invented data only.

begin;

select plan(43);

do $users$
begin
  perform tests.create_supabase_user('pg_owner', 'pg-owner@example.com');
  perform tests.create_supabase_user('pg_other', 'pg-other@example.com');
  perform tests.create_supabase_user('pg_viewer', 'pg-viewer@example.com');
end
$users$;

create temp table pg (label text primary key, id uuid);
grant all on pg to authenticated, service_role;
create temp table pg_out (label text primary key, body jsonb);
grant all on pg_out to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create function pg_temp.group_of(p_label text) returns uuid language sql stable security definer as $$
  select p.group_id from public.projects p where p.id = (select id from pg where label = p_label);
$$;
grant execute on function pg_temp.group_of(text) to authenticated, service_role;

select tests.authenticate_as('pg_other');
do $o$ begin perform public.create_company('Other Groups', true); end $o$;
do $p$ begin perform public.upsert_project(null, 'Site Other', null, 'active'); end $p$;
insert into pg (label, id) select 'other_proj', id from public.projects where name = 'Site Other';

select tests.authenticate_as('pg_owner');
do $c$ begin perform public.create_company('Group Books', true); end $c$;
do $p$ begin
  perform public.upsert_project(null, 'Site Alpha', null, 'active');
  perform public.upsert_project(null, 'Site Beta', null, 'active');
  perform public.upsert_project(null, 'Site Gamma', null, 'active');
end $p$;
insert into pg (label, id) select 'co', id from public.companies where name = 'Group Books';
insert into pg (label, id) select 'alpha', id from public.projects where name = 'Site Alpha';
insert into pg (label, id) select 'beta', id from public.projects where name = 'Site Beta';
insert into pg (label, id) select 'gamma', id from public.projects where name = 'Site Gamma';

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description
)
select
  pg_temp.id('co'), v.dir::public.txn_direction, v.kind::public.doc_kind, 'project', 'posted', v.cur,
  v.amount, v.amount, abs(v.amount), 0, 'source', '2026-09-10'::date, '2026-09-10'::date, 'manual', v.ikey,
  pg_temp.id(v.proj), v.ikey
from (values
  ('income', 'invoice', 'ILS', 10000, 'pg:alpha-in', 'alpha'),
  ('expense', 'expense', 'ILS', -3000, 'pg:alpha-out', 'alpha'),
  ('expense', 'expense', 'ILS', -2000, 'pg:beta-out', 'beta'),
  ('expense', 'expense', 'USD', -500, 'pg:beta-usd', 'beta'),
  ('expense', 'expense', 'ILS', -1000, 'pg:gamma-out', 'gamma')
) as v(dir, kind, cur, amount, ikey, proj);

select tests.authenticate_as('pg_owner');
insert into pg_out (label, body) values ('before', public.get_dashboard(null, null, 'invoiced'));

-- Writes.
insert into pg (label, id) values ('north', public.upsert_project_group(null, '  North  '));
insert into pg (label, id) values ('south', public.upsert_project_group(null, 'South'));
select is(
  (select name || ':' || sort_order from public.project_groups where id = pg_temp.id('north')),
  'North:1',
  'a group is made with a trimmed name, first in order'
);
select throws_ok(
  $$select public.upsert_project_group(null, 'North')$$,
  'P0001', 'project group already exists', 'a name is taken once'
);
select throws_ok(
  $$select public.upsert_project_group(null, ' x ')$$,
  'P0001', 'group name is too short', 'a name has at least two letters'
);
select throws_ok(
  format($$select public.upsert_project_group(null, %L)$$, 'Ea' || chr(8203) || 'st'),
  '23514', 'name has an invisible or control character', 'a name has no hidden character'
);
select is(
  public.upsert_project_group(pg_temp.id('south'), 'South Side'),
  pg_temp.id('south'),
  'a group is renamed in place'
);
select is(
  public.set_project_group(pg_temp.id('alpha'), pg_temp.id('north')),
  jsonb_build_object('before', null, 'after', pg_temp.id('north')),
  'set_project_group answers with the group before and after'
);
do $s$ begin perform public.set_project_group(pg_temp.id('beta'), pg_temp.id('north')); end $s$;
select is(pg_temp.group_of('beta'), pg_temp.id('north'), 'a second project joins the group');

-- company_pnl.
insert into pg_out (label, body) values ('after', public.get_dashboard(null, null, 'invoiced'));
select is(
  (select body - 'projects' - 'groups' from pg_out where label = 'after'),
  (select body - 'projects' - 'groups' from pg_out where label = 'before'),
  'the company totals do not change'
);
select is(
  (select jsonb_agg(r - 'group_id' order by r->>'id') from pg_out, jsonb_array_elements(body->'projects') r where label = 'after'),
  (select jsonb_agg(r - 'group_id' order by r->>'id') from pg_out, jsonb_array_elements(body->'projects') r where label = 'before'),
  'the project rows do not change, apart from group_id'
);
select is(
  (select r->>'group_id' from pg_out, jsonb_array_elements(body->'projects') r
   where label = 'after' and r->>'id' = pg_temp.id('alpha')::text),
  pg_temp.id('north')::text,
  'a project row names its group'
);
select is(
  (select r->'group_id' from pg_out, jsonb_array_elements(body->'projects') r
   where label = 'after' and r->>'id' = pg_temp.id('gamma')::text),
  'null'::jsonb,
  'a project with no group has a null group_id'
);
select is(
  (select jsonb_agg(g->>'name' order by o) from pg_out, jsonb_array_elements(body->'groups') with ordinality x(g, o)
   where label = 'after'),
  '["North", "South Side"]'::jsonb,
  'groups[] lists every group in order, an empty one too'
);
select is(
  (select g - 'id' - 'name' - 'sort_order' from pg_out, jsonb_array_elements(body->'groups') g
   where label = 'after' and g->>'id' = pg_temp.id('north')::text),
  jsonb_build_object(
    'project_count', 2,
    'income_agorot', 10000,
    'direct_agorot', 5000,
    'shared_agorot', 0,
    'profit_before_shared_agorot', 5000,
    'profit_agorot', 5000,
    'by_currency', jsonb_build_array(
      jsonb_build_object('currency', 'ILS', 'income_minor', 10000, 'direct_minor', 5000, 'shared_minor', 0, 'profit_minor', 5000),
      jsonb_build_object('currency', 'USD', 'income_minor', 0, 'direct_minor', 500, 'shared_minor', 0, 'profit_minor', -500)
    )
  ),
  'a group is the sum of its projects, per currency, the company currency first'
);
select is(
  (select (g->>'profit_agorot')::bigint from pg_out, jsonb_array_elements(body->'groups') g
   where label = 'after' and g->>'id' = pg_temp.id('north')::text),
  (select sum((r->>'profit_agorot')::bigint)::bigint from pg_out, jsonb_array_elements(body->'projects') r
   where label = 'after' and r->>'group_id' = pg_temp.id('north')::text),
  'the group profit equals its projects'' profit'
);
select is(
  (select jsonb_build_array(g->'project_count', g->'profit_agorot', g->'by_currency') from pg_out, jsonb_array_elements(body->'groups') g
   where label = 'after' and g->>'id' = pg_temp.id('south')::text),
  '[0, 0, []]'::jsonb,
  'an empty group is all zeros'
);

-- get_project_group and list_project_groups.
insert into pg_out (label, body) values ('north', public.get_project_group(pg_temp.id('north'), 'invoiced'));
select is(
  (select body->>'name' || ':' || (body->>'profit_agorot') || ':' || (body->>'basis') from pg_out where label = 'north'),
  'North:5000:invoiced',
  'get_project_group has the group''s figures'
);
select is(
  (select jsonb_agg(r->>'id' order by r->>'id') from pg_out, jsonb_array_elements(body->'projects') r where label = 'north'),
  (select jsonb_agg(x order by x) from (values (pg_temp.id('alpha')::text), (pg_temp.id('beta')::text)) v(x)),
  'and its projects'
);
select is(
  (select r - 'group_id' from pg_out, jsonb_array_elements(body->'projects') r
   where label = 'north' and r->>'id' = pg_temp.id('alpha')::text),
  (select r - 'group_id' from pg_out, jsonb_array_elements(body->'projects') r
   where label = 'before' and r->>'id' = pg_temp.id('alpha')::text),
  'each the same row as list_projects'
);
select is(
  (public.get_project_group(pg_temp.id('north'), 'invoiced', '2026-10-01', '2026-10-31')->>'profit_agorot')::bigint,
  0::bigint,
  'a period with no lines is zero'
);
select is(public.get_project_group(gen_random_uuid()), null, 'an unknown group is null');
select is(
  public.list_project_groups(),
  jsonb_build_array(
    jsonb_build_object('id', pg_temp.id('north'), 'name', 'North', 'sort_order', 1, 'project_count', 2),
    jsonb_build_object('id', pg_temp.id('south'), 'name', 'South Side', 'sort_order', 2, 'project_count', 0)
  ),
  'list_project_groups lists them with their project counts'
);

-- Another company.
select tests.authenticate_as('pg_other');
select is(public.get_project_group(pg_temp.id('north')), null, 'another company can''t read the group');
select is(public.list_project_groups(), '[]'::jsonb, 'nor list it');
select is((select count(*)::integer from public.project_groups), 0, 'nor select it');
select is(
  (select jsonb_array_length(public.get_dashboard()->'groups')),
  0,
  'and its own dashboard has no groups'
);
select throws_ok(
  format($$select public.set_project_group(%L, null)$$, pg_temp.id('alpha')),
  'P0001', 'project not found', 'another company''s project is not found'
);
select throws_ok(
  format($$select public.set_project_group(%L, %L)$$, pg_temp.id('other_proj'), pg_temp.id('north')),
  'P0001', 'group not found', 'another company''s group is not found'
);
select throws_ok(
  format($$insert into public.project_groups (company_id, name) values (%L, 'Sneaky')$$, pg_temp.id('co')),
  '42501', null, 'nor can it insert one there'
);
select throws_ok(
  format($$select public.delete_project_group(%L)$$, pg_temp.id('north')),
  'P0001', 'group not found', 'nor delete one'
);

-- A viewer reads and cannot write.
reset role;
update public.companies set is_demo = true where id = pg_temp.id('co');
insert into public.company_viewers (user_id, company_id) values (tests.get_supabase_uid('pg_viewer'), pg_temp.id('co'));
select tests.authenticate_as('pg_viewer');
select is(jsonb_array_length(public.list_project_groups()), 2, 'a viewer lists the groups');
select is(
  (public.get_project_group(pg_temp.id('north'), 'invoiced')->>'profit_agorot')::bigint,
  5000::bigint,
  'and reads a group'
);
select throws_ok(
  $$select public.upsert_project_group(null, 'Viewer Group')$$,
  '42501', 'forbidden', 'a viewer cannot make a group'
);

-- MCP create_project_group and set_project_group with undo.
reset role;
select public.store_mcp_credential(tests.get_supabase_uid('pg_owner'), 'hash-pg-write-0001', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into pg (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-pg-write-0001';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('pg_owner');
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
insert into pg_out (label, body) values ('mcp_create', public.mcp_create_project_group('pg-create-1', 'East'));
insert into pg (label, id) select 'east', (body->'data'->>'id')::uuid from pg_out where label = 'mcp_create';
select is(
  (select body->'data'->>'name' || ':' || (body->'data'->>'undo_kind') from pg_out where label = 'mcp_create'),
  'East:project_group',
  'MCP create_project_group answers with the group and its undo kind'
);
select is(
  public.mcp_create_project_group('pg-create-1', 'East'),
  (select body from pg_out where label = 'mcp_create'),
  'the same key replays the answer'
);
select is(
  public.mcp_create_project_group('pg-create-2', 'North')->'error'->>'code',
  'refused',
  'a taken name is refused'
);
select is(
  (select r->'data'->>'undo_kind' || ':' || coalesce(r->'data'->>'prior', 'none')
   from (select public.mcp_set_project_group('pg-set-1', pg_temp.id('gamma'), pg_temp.id('east')) r) x),
  'project_group_member:none',
  'MCP set_project_group answers with its undo kind and the group before'
);
select is(
  public.mcp_set_project_group('pg-set-2', pg_temp.id('gamma'), gen_random_uuid())->'error'->>'code',
  'not_found',
  'an unknown group is not_found'
);
select is(
  public.mcp_undo('pg-undo-1', 'project_group', pg_temp.id('east'))->'error'->>'code',
  'conflict',
  'a group with a project in it is not undone'
);
select is(public.mcp_undo('pg-undo-2', 'project_group_member', pg_temp.id('gamma'))->>'ok', 'true', 'undo takes the project out');
select is(pg_temp.group_of('gamma'), null::uuid, 'and it has no group again');
select is(public.mcp_undo('pg-undo-3', 'project_group', pg_temp.id('east'))->>'ok', 'true', 'then the group''s undo deletes it');

-- Deleting a group keeps its projects and the totals.
select tests.authenticate_as('pg_owner');
select is(
  public.delete_project_group(pg_temp.id('north'))->'project_ids',
  (select jsonb_agg(x order by n) from (values (pg_temp.id('alpha'), 'Site Alpha'), (pg_temp.id('beta'), 'Site Beta')) v(x, n)),
  'delete_project_group answers with the projects it held'
);
select is(
  (select public.get_dashboard(null, null, 'invoiced') - 'projects' - 'groups'),
  (select body - 'projects' - 'groups' from pg_out where label = 'before'),
  'the projects keep their lines and the totals stay'
);

select * from finish();
rollback;
