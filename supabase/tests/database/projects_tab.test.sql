-- FLOW-445 server: the Projects tab. The type text and the finish date, delete_project, one
-- month's cash per project adding up to Home's month (cash_months), the overhead project and the
-- unassigned bucket, and the MCP wrappers update_project, delete_project and create_project
-- (type and budget) with idempotency, refusals and undo. Invented data only.

begin;

select plan(46);

do $users$
begin
  perform tests.create_supabase_user('pt_owner', 'pt-owner@example.com');
  perform tests.create_supabase_user('pt_viewer', 'pt-viewer@example.com');
  perform tests.create_supabase_user('pt_other', 'pt-other@example.com');
end
$users$;

create temp table pt (label text primary key, id uuid);
grant all on pt to authenticated, service_role;
create temp table pt_out (label text primary key, body jsonb);
grant all on pt_out to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pt where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create function pg_temp.out_of(p_label text) returns jsonb language sql stable as $$
  select body from pt_out where label = p_label;
$$;
grant execute on function pg_temp.out_of(text) to authenticated, service_role;

create function pg_temp.proj(p_month jsonb, p_name text) returns jsonb
language sql immutable
as $$ select x from jsonb_array_elements(p_month -> 'projects') x where x ->> 'name' = p_name $$;

create function pg_temp.net(p_row jsonb) returns bigint
language sql immutable
as $$ select (x ->> 'net_minor')::bigint from jsonb_array_elements(p_row -> 'cash') x where x ->> 'currency' = 'ILS' $$;
grant execute on function pg_temp.proj(jsonb, text), pg_temp.net(jsonb) to authenticated, service_role;

-- The other company first, so the owner's company is the one the rest of the file uses.
select tests.authenticate_as('pt_other');
select public.create_company('Other Projects Co', true);
select public.upsert_project(null, 'Other Site', null, 'active', null);
insert into pt (label, id) select 'other_proj', id from public.projects where name = 'Other Site';

select tests.authenticate_as('pt_owner');
select public.create_company('Projects Books', true);
insert into pt (label, id) select 'co', id from public.companies where name = 'Projects Books';
select public.upsert_project(null, 'Lark Hill', 500000, 'active', 'flip');
select public.upsert_project(null, 'Okafor', null, 'active', 'client');
select public.upsert_project(null, 'Fenwick', null, 'active', 'rental');
select public.upsert_project(null, 'Office', null, 'active', null);
insert into pt (label, id) select 'lark', id from public.projects where name = 'Lark Hill';
insert into pt (label, id) select 'okafor', id from public.projects where name = 'Okafor';
insert into pt (label, id) select 'fenwick', id from public.projects where name = 'Fenwick';
insert into pt (label, id) select 'office', id from public.projects where name = 'Office';

-- Lines. Dated in September 2026 unless noted; invented amounts, in agorot.
reset role;
insert into pt (label, id) values
  ('lark_in', tests.fixture_line(pg_temp.id('co'), 'pt:lark-in', 100000, 'income', pg_temp.id('lark'), null,
    '2026-09-10', 'ILS', 'posted', 'manual', 'project', 'invoice_receipt')),
  ('lark_out', tests.fixture_line(pg_temp.id('co'), 'pt:lark-out', 30000, 'expense', pg_temp.id('lark'), null,
    '2026-09-11', 'ILS', 'posted', 'manual', 'project', 'receipt')),
  ('lark_aug', tests.fixture_line(pg_temp.id('co'), 'pt:lark-aug', 9999, 'income', pg_temp.id('lark'), null,
    '2026-08-20', 'ILS', 'posted', 'manual', 'project', 'invoice_receipt')),
  ('okafor_out', tests.fixture_line(pg_temp.id('co'), 'pt:okafor-out', 4000, 'expense', pg_temp.id('okafor'), null,
    '2026-09-14', 'ILS', 'posted', 'manual', 'project', 'receipt')),
  ('shared_10000', tests.fixture_line(pg_temp.id('co'), 'pt:shared-10000', 10000, 'expense', null, null,
    '2026-09-12', 'ILS', 'posted', 'manual', 'shared', 'receipt')),
  ('shared_5', tests.fixture_line(pg_temp.id('co'), 'pt:shared-5', 5, 'expense', null, null,
    '2026-09-12', 'ILS', 'posted', 'manual', 'shared', 'receipt')),
  ('office_out', tests.fixture_line(pg_temp.id('co'), 'pt:office-out', 5000, 'expense', pg_temp.id('office'), null,
    '2026-09-13', 'ILS', 'posted', 'manual', 'project', 'receipt')),
  ('unassigned_in', tests.fixture_line(pg_temp.id('co'), 'pt:unassigned-in', 20000, 'income', null, null,
    '2026-09-15', 'ILS', 'posted', 'manual', null, 'invoice_receipt')),
  ('unassigned_out', tests.fixture_line(pg_temp.id('co'), 'pt:unassigned-out', 7000, 'expense', null, null,
    '2026-09-16', 'ILS', 'posted', 'manual', null, 'receipt'));

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select pg_temp.id('co'), pt.id, pg_temp.id('lark'), 6000, -6000 from pt where label = 'shared_10000'
union all
select pg_temp.id('co'), pt.id, pg_temp.id('okafor'), 4000, -4000 from pt where label = 'shared_10000'
union all
select pg_temp.id('co'), pt.id, pg_temp.id('lark'), 5000, -5 from pt where label = 'shared_5'
union all
select pg_temp.id('co'), pt.id, pg_temp.id('okafor'), 5000, -5 from pt where label = 'shared_5';

-- The viewer reads the company but cannot write it.
insert into public.company_members (company_id, user_id, role)
values (pg_temp.id('co'), tests.get_supabase_uid('pt_viewer'), 'viewer');

-- Office is the overhead project.
select tests.authenticate_as('pt_owner');
select public.set_overhead_project(pg_temp.id('office'));

-- The type text and the finish date.
select is(
  (select state_label from public.projects where id = pg_temp.id('lark')),
  'flip',
  'upsert_project stores the type text'
);
select throws_ok(
  $$select public.upsert_project(null, 'Long Type', null, 'active', repeat('x', 41))$$,
  'P0001', 'project type is too long', 'a type over 40 characters is refused'
);
select throws_ok(
  $$select public.upsert_project(null, 'Hidden Type', null, 'active', 'flip' || chr(8207))$$,
  '23514', 'type has an invisible or control character', 'a type with a hidden character is refused'
);
select public.upsert_project(pg_temp.id('lark'), 'Lark Hill', 500000, 'finished', 'flip');
select is(
  (select finished_on is not null from public.projects where id = pg_temp.id('lark')),
  true,
  'finishing a project sets finished_on'
);
select public.upsert_project(pg_temp.id('lark'), 'Lark Hill', 500000, 'active', 'flip');
select is(
  (select finished_on from public.projects where id = pg_temp.id('lark')),
  null::date,
  'reactivating a project clears finished_on'
);
select public.upsert_project(pg_temp.id('lark'), 'Lark Hill', 500000, 'finished');
select is(
  (select state_label from public.projects where id = pg_temp.id('lark')),
  'flip',
  'an update without a type keeps the stored type'
);
select public.upsert_project(pg_temp.id('lark'), 'Lark Hill', 500000, 'active', 'flip');

-- The list's figures: one month, per project, overhead and unassigned.
insert into pt_out (label, body)
values ('sept', public.projects_cash_month('2026-09-01', '2026-09-20'));
select is(
  pg_temp.out_of('sept') ->> 'month', '2026-09-01',
  'projects_cash_month echoes the month'
);
select is(
  (select (pg_temp.proj(pg_temp.out_of('sept'), 'Office') ->> 'is_overhead')),
  'true',
  'the overhead project is marked is_overhead'
);
select is(
  pg_temp.net(pg_temp.proj(pg_temp.out_of('sept'), 'Office')),
  -5000::bigint,
  'the overhead project counts its own cost'
);
select is(
  pg_temp.net(pg_temp.proj(pg_temp.out_of('sept'), 'Lark Hill')) + pg_temp.net(pg_temp.proj(pg_temp.out_of('sept'), 'Okafor')),
  55995::bigint,
  'the flip and the client job carry their part, shared lines split by allocation, August left out'
);
select is(
  (pg_temp.out_of('sept') -> 'unassigned' -> 'cash' -> 0 ->> 'net_minor')::bigint,
  13000::bigint,
  'unassigned holds the income and the cost with no project'
);
select is(
  (pg_temp.out_of('sept') -> 'unassigned' ->> 'count')::int,
  2,
  'unassigned counts its lines'
);
select is(
  (select sum(pg_temp.net(p))::bigint
     from jsonb_array_elements(pg_temp.out_of('sept') -> 'projects') p)
    + (pg_temp.out_of('sept') -> 'unassigned' -> 'cash' -> 0 ->> 'net_minor')::bigint,
  (select (x ->> 'net_minor')::bigint
     from jsonb_array_elements((public.cash_months(1, '2026-09-20') -> 'months' -> 0 -> 'by_currency')) x
     where x ->> 'currency' = 'ILS'),
  'projects plus unassigned add up to cash_months'' net for the month'
);
select is(
  pg_temp.proj(pg_temp.out_of('sept'), 'Lark Hill') ->> 'first_month',
  '2026-08-01',
  'first_month is the first month with a line'
);
select is(
  pg_temp.proj(pg_temp.out_of('sept'), 'Lark Hill') ->> 'deletable',
  'false',
  'a project with lines is not deletable'
);
select is(
  pg_temp.proj(pg_temp.out_of('sept'), 'Okafor') ->> 'deletable',
  'false',
  'a project with an allocation is not deletable'
);
select is(
  pg_temp.proj(pg_temp.out_of('sept'), 'Fenwick') ->> 'deletable',
  'true',
  'an empty project is deletable'
);
select is(
  public.projects_cash_month('2026-09-01', '2026-09-20', pg_temp.id('other_proj')) is null,
  true,
  'another company''s project is not read'
);
select tests.authenticate_as('pt_viewer');
select is(
  public.projects_cash_month('2026-09-01', '2026-09-20') is not null,
  true,
  'a viewer reads the month'
);
select throws_ok(
  $$select public.delete_project(pg_temp.id('okafor'))$$,
  '42501', 'forbidden', 'a viewer cannot delete a project'
);

-- delete_project: refused while anything refers to a project, deletes an empty one.
select tests.authenticate_as('pt_owner');
select throws_ok(
  $$select public.delete_project(pg_temp.id('lark'))$$,
  'P0001', 'in use', 'a project with a line is in use'
);
select throws_ok(
  $$select public.delete_project(pg_temp.id('office'))$$,
  '23514', 'the overhead project cannot be deleted', 'the company overhead project is refused'
);
select is(
  (select overhead_project_id from public.companies where id = pg_temp.id('co')),
  pg_temp.id('office'),
  'the overhead project stays set after a refused delete'
);
insert into pt_out (label, body)
select 'fenwick_gone', public.delete_project(pg_temp.id('fenwick'));
select is(
  (select count(*)::int from public.projects where id = pg_temp.id('fenwick')),
  0,
  'the owner deletes an empty project'
);
select is(
  pg_temp.out_of('fenwick_gone') ->> 'name',
  'Fenwick',
  'delete_project returns the row, for an undo'
);

-- MCP: a write token for the owner.
reset role;
select public.store_mcp_credential(tests.get_supabase_uid('pt_owner'), 'hash-pt-write-0001', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into pt (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-pt-write-0001';

create function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('pt_owner');
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
insert into pt_out (label, body)
values ('quarry', public.mcp_create_project('pt-c-1', 'Quarry Rd', 'active', 'flip', 250000));
insert into pt (label, id) select 'quarry', (body -> 'data' ->> 'id')::uuid from pt_out where label = 'quarry';
select is(
  pg_temp.out_of('quarry') -> 'data' ->> 'undo_kind',
  'project',
  'create_project with a type and a budget returns the create undo kind'
);
select is(
  (select state_label || ':' || budget_agorot from public.projects where id = pg_temp.id('quarry')),
  'flip:250000',
  'create_project stores the type and the budget'
);
select is(
  public.mcp_create_project('pt-c-1', 'Quarry Rd', 'active', 'flip', 250000),
  pg_temp.out_of('quarry'),
  'the same key and the same call replays the response'
);
select is(
  public.mcp_create_project('pt-c-1', 'Quarry Rd', 'active', 'flip', 1)->'error'->>'code',
  'conflict',
  'the same key with another budget is a conflict'
);
select is(
  public.mcp_create_project('pt-c-2', 'Quarry Two', 'active', 'flip', -1)->'error'->>'code',
  'validation',
  'a negative budget is a validation error'
);

-- MCP update_project: the name, the type, the budget cleared, the status.
insert into pt_out (label, body)
values ('upd1', public.mcp_update_project('pt-u-1', pg_temp.id('quarry'), '{"name":"Quarry Road","type":"rental","budget_minor":null}'));
select is(
  pg_temp.out_of('upd1') ->> 'ok',
  'true',
  'update_project changes the name, the type and clears the budget'
);
select is(
  (select name || ':' || state_label || ':' || coalesce(budget_agorot::text, 'none') from public.projects where id = pg_temp.id('quarry')),
  'Quarry Road:rental:none',
  'the changed fields are stored and the others stay'
);
insert into pt_out (label, body)
values ('upd2', public.mcp_update_project('pt-u-2', pg_temp.id('quarry'), '{"status":"finished"}'));
select is(
  (select finished_on is not null from public.projects where id = pg_temp.id('quarry')),
  true,
  'update_project to finished sets finished_on'
);
select is(
  public.mcp_update_project('pt-u-3', pg_temp.id('quarry'), '{"colour":"red"}')->'error'->>'code',
  'validation',
  'an unknown field is a validation error'
);
select is(
  public.mcp_update_project('pt-u-4', pg_temp.id('other_proj'), '{"name":"Taken Over"}')->'error'->>'code',
  'not_found',
  'another company''s project is not_found'
);
select is(
  public.mcp_undo('pt-undo-1', 'project_update', pg_temp.id('quarry'))->>'ok',
  'true',
  'undo of the last update puts its before values back'
);
select is(
  (select status::text from public.projects where id = pg_temp.id('quarry')),
  'active',
  'and the status is active again'
);

-- An update undone after the project changed again is a conflict.
insert into pt_out (label, body)
values ('upd5', public.mcp_update_project('pt-u-5', pg_temp.id('quarry'), '{"name":"Quarry Lane"}'));
select public.upsert_project(pg_temp.id('quarry'), 'Quarry Other', null, 'active', 'rental');
select is(
  public.mcp_undo('pt-undo-5', 'project_update', pg_temp.id('quarry'))->'error'->>'code',
  'conflict',
  'an update is not undone after the project changed'
);

-- MCP delete_project: refused with a line, then deleted and put back by undo.
select is(
  public.mcp_delete_project('pt-d-1', pg_temp.id('lark'))->'error'->>'message',
  'in use',
  'delete_project is refused while a project is in use'
);
select is(
  public.mcp_delete_project('pt-d-3', pg_temp.id('office'))->'error'->>'code',
  'validation',
  'the MCP delete refuses the company overhead project as a validation error'
);
insert into pt_out (label, body)
values ('del', public.mcp_delete_project('pt-d-2', pg_temp.id('quarry')));
select is(
  pg_temp.out_of('del') -> 'data' ->> 'undo_kind',
  'project_delete',
  'mcp delete_project returns the project delete undo kind'
);
select is(
  (select count(*)::int from public.projects where id = pg_temp.id('quarry')),
  0,
  'the empty project is gone'
);
select is(
  public.mcp_undo('pt-undo-6', 'project_delete', pg_temp.id('quarry'))->>'ok',
  'true',
  'undo puts the deleted project back'
);
select is(
  (select name from public.projects where id = pg_temp.id('quarry')),
  'Quarry Other',
  'with the same id and the name it had'
);

-- Undo of a create deletes the new project while it is empty.
insert into pt (label, id)
select 'sable', (public.mcp_create_project('pt-c-3', 'Sable Ave', 'active', null, null)->'data'->>'id')::uuid;
select is(
  public.mcp_undo('pt-undo-7', 'project', pg_temp.id('sable'))->>'ok',
  'true',
  'undo of a create deletes an empty project'
);
select is(
  public.mcp_undo('pt-undo-8', 'project_delete', pg_temp.id('quarry'))->'error'->>'code',
  'not_found',
  'a delete is undone once'
);

select * from finish();
rollback;
