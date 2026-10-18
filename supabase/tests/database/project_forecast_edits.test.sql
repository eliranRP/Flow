-- The project next-month forecast edits: the app's RPCs (set, remove, restore, reset, undo, list),
-- paces across months, the viewer and cross-company rules, a month that has ended, and the MCP
-- writes (idempotency, undo, conflict). Invented data only.

begin;

select plan(37);

do $users$
begin
  perform tests.create_supabase_user('pfe_owner', 'pfe-owner@example.com');
  perform tests.create_supabase_user('pfe_viewer', 'pfe-viewer@example.com');
  perform tests.create_supabase_user('pfe_other', 'pfe-other@example.com');
end
$users$;

create temp table pfe (label text primary key, id uuid);
grant all on pfe to authenticated, service_role;
create temp table pfe_month (label text primary key, m text);
grant all on pfe_month to authenticated, service_role;
create temp table pfe_out (label text primary key, body jsonb);
grant all on pfe_out to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pfe where label = p_label;
$$;
create function pg_temp.m(p_label text) returns text language sql stable as $$
  select m from pfe_month where label = p_label;
$$;
create function pg_temp.out_of(p_label text) returns jsonb language sql stable as $$
  select body from pfe_out where label = p_label;
$$;
-- How many of the project's edits apply to a month, as the app reads them.
create function pg_temp.count_for(p_month text) returns integer language sql stable as $$
  select jsonb_array_length(public.project_forecast_edits_for(pg_temp.id('project'), p_month));
$$;
grant execute on function pg_temp.id(text), pg_temp.m(text), pg_temp.out_of(text), pg_temp.count_for(text)
  to authenticated, service_role;

-- This month (Israel time), the months after it, and the month before.
insert into pfe_month (label, m)
select label, to_char(date_trunc('month', private.flow_today()) + (n || ' month')::interval, 'YYYY-MM')
from (values ('past', -1), ('now', 0), ('next', 1), ('next2', 2), ('next3', 3), ('next12', 12)) v(label, n);

-- The other company first, with a project and a category of its own.
select tests.authenticate_as('pfe_other');
select public.create_company('Other Forecast Edits Co', true);
insert into pfe (label, id) values ('other_project', public.upsert_project(p_name => 'Birch Ct', p_status => 'active'));
insert into pfe (label, id) values ('other_category', public.create_category('Other upkeep', 'expense'));

select tests.authenticate_as('pfe_owner');
select public.create_company('Forecast Edits Books', true);
insert into pfe (label, id) values ('project', public.upsert_project(p_name => 'Juniper Ct', p_status => 'active'));
insert into pfe (label, id) values ('category', public.create_category('Pest control', 'expense'));

reset role;
insert into public.company_members (company_id, user_id, role)
select p.company_id, tests.get_supabase_uid('pfe_viewer'), 'viewer'
from public.projects p where p.id = pg_temp.id('project');

-- No direct table access, even for the owner.
select tests.authenticate_as('pfe_owner');
select throws_ok(
  'select count(*) from public.project_forecast_edits',
  '42501',
  null,
  'the table is read only through the functions'
);

-- A change of an average row for this month only.
insert into pfe_out (label, body)
values ('set1', public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('now'), '{"row_key": "avg:repairs", "amount_minor": 120000}'));
select is(pg_temp.out_of('set1')->'edit'->>'amount_minor', '120000', 'the change is stored with its amount');
select is(pg_temp.out_of('set1')->'edit'->>'pace', 'once', 'a change with no pace is for its month only');
select is(
  pg_temp.out_of('set1')->'undo'->'drop'->>0,
  pg_temp.out_of('set1')->'edit'->>'id',
  'the undo of a new change drops it'
);
select is(pg_temp.count_for(pg_temp.m('now')), 1, 'the month lists its change');
select is(pg_temp.count_for(pg_temp.m('next')), 0, 'a once change does not reach the next month');

-- The same row and month again replaces the change; the undo puts the old amount back.
insert into pfe_out (label, body)
values ('set2', public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('now'), '{"row_key": "avg:repairs", "amount_minor": 90000}'));
select is(pg_temp.out_of('set2')->'edit'->>'id', pg_temp.out_of('set1')->'edit'->>'id', 'a second change of the row replaces the first');
select is(pg_temp.out_of('set2')->'undo'->'put'->0->>'amount_minor', '120000', 'its undo holds the amount it replaced');
select is(
  public.undo_project_forecast(pg_temp.id('project'), pg_temp.out_of('set2')->'undo')->>'put',
  '1',
  'the undo puts the replaced change back'
);
select is(
  public.project_forecast_edits_for(pg_temp.id('project'), pg_temp.m('now'))->0->>'amount_minor',
  '120000',
  'the row reads its first amount again'
);
select is(
  public.undo_project_forecast(pg_temp.id('project'), pg_temp.out_of('set1')->'undo')->>'dropped',
  '1',
  'the undo of the first change drops it'
);
select is(pg_temp.count_for(pg_temp.m('now')), 0, 'the month is back at Flow''s numbers');

-- Paces: a monthly change and a quarterly added line, from this month on.
select public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('now'), '{"row_key": "rec:income:p-rent", "amount_minor": 200000, "pace": "month"}');
insert into pfe_out (label, body)
values ('add1', public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('now'),
  jsonb_build_object('category_id', pg_temp.id('category'), 'amount_minor', 6500, 'pace', 'quarter')));
select is(pg_temp.out_of('add1')->'edit'->>'direction', 'expense', 'an added line takes its category''s direction');
select is(pg_temp.count_for(pg_temp.m('now')), 2, 'both apply to the month they start in');
select is(pg_temp.count_for(pg_temp.m('next')), 1, 'next month has the monthly change only');
select is(pg_temp.count_for(pg_temp.m('next3')), 2, 'a quarter later both apply again');
select is(
  (select x->>'category_name' from jsonb_array_elements(public.project_forecast_edits_for(pg_temp.id('project'), pg_temp.m('next3'))) x where x->>'kind' = 'add'),
  'Pest control',
  'an added line is listed with its category name'
);
select public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('next'), jsonb_build_object('category_id', pg_temp.id('category'), 'amount_minor', 9000, 'pace', 'year'));
select is(pg_temp.count_for(pg_temp.m('next2')), 1, 'a yearly line skips the months between');

-- Removal and restore of one row, and the undo of the restore.
insert into pfe_out (label, body)
values ('remove1', public.remove_project_forecast_row(pg_temp.id('project'), pg_temp.m('now'), 'avg:utilities'));
select is(pg_temp.out_of('remove1')->'edit'->>'kind', 'remove', 'a row is taken out of the month');
select is(
  public.remove_project_forecast_row(pg_temp.id('project'), pg_temp.m('now'), 'avg:utilities')->'undo',
  '{"drop": [], "put": []}'::jsonb,
  'a row already out stays out, with nothing to undo'
);
insert into pfe_out (label, body)
values ('restore1', public.restore_project_forecast_row(pg_temp.id('project'), pg_temp.m('now'), 'avg:utilities'));
select is(pg_temp.out_of('restore1')->>'removed', '1', 'the restore brings the row back');
select is(
  public.undo_project_forecast(pg_temp.id('project'), pg_temp.out_of('restore1')->'undo')->>'put',
  '1',
  'the undo of the restore takes it out again'
);

-- A month that has ended, and a bad edit.
select throws_ok(
  format($$select public.set_project_forecast_edit(%L, %L, '{"row_key": "avg:repairs", "amount_minor": 1}')$$, pg_temp.id('project'), pg_temp.m('past')),
  '22023',
  'month ended',
  'a write to a month that has ended is refused'
);
select throws_ok(
  format($$select public.set_project_forecast_edit(%L, %L, '{"row_key": "avg:repairs", "amount_minor": 1, "pace": "weekly"}')$$, pg_temp.id('project'), pg_temp.m('now')),
  '22023',
  'validation',
  'an unknown pace is refused'
);
select throws_ok(
  format($$select public.set_project_forecast_edit(%L, %L, %L)$$, pg_temp.id('project'), pg_temp.m('now'),
    jsonb_build_object('category_id', pg_temp.id('other_category'), 'amount_minor', 100)),
  'P0002',
  'category not found',
  'a line of another company''s category is refused'
);

-- The viewer reads but cannot write.
select tests.authenticate_as('pfe_viewer');
select is(pg_temp.count_for(pg_temp.m('now')), 3, 'a viewer reads the month''s edits');
select throws_ok(
  format($$select public.remove_project_forecast_row(%L, %L, 'avg:repairs')$$, pg_temp.id('project'), pg_temp.m('now')),
  '42501',
  null,
  'a viewer cannot edit the forecast'
);

-- Another company reads nothing of this project and writes nothing to it.
select tests.authenticate_as('pfe_other');
select is(pg_temp.count_for(pg_temp.m('now')), 0, 'another company reads no edits of this project');
select throws_ok(
  format($$select public.reset_project_forecast(%L)$$, pg_temp.id('project')),
  'P0002',
  'project not found',
  'another company cannot reset this project''s forecast'
);
select is(
  public.undo_project_forecast(pg_temp.id('other_project'),
    jsonb_build_object('drop', jsonb_build_array(pg_temp.out_of('add1')->'edit'->>'id'), 'put', jsonb_build_array(pg_temp.out_of('remove1')->'edit'))),
  '{"dropped": 0, "put": 0}'::jsonb,
  'an undo on its own project cannot drop or take over this project''s rows'
);

-- Reset of every edit, and its undo.
select tests.authenticate_as('pfe_owner');
insert into pfe_out (label, body) values ('reset1', public.reset_project_forecast(pg_temp.id('project')));
select is(pg_temp.out_of('reset1')->>'removed', '4', 'the reset drops every edit of the project');
select is(
  public.undo_project_forecast(pg_temp.id('project'), pg_temp.out_of('reset1')->'undo')->>'put',
  '4',
  'its undo puts them all back'
);

-- MCP writes, with a write token for the owner.
reset role;
select public.store_mcp_credential(tests.get_supabase_uid('pfe_owner'), 'hash-pfe-write-0001', array['read','write'],
  now() + interval '90 days', 'pepper-pfe');
insert into pfe (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-pfe-write-0001';

create function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('pfe_owner');
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
insert into pfe_out (label, body)
values ('mcp1', public.mcp_set_project_forecast_edit('pfe-s-1', pg_temp.id('project'), pg_temp.m('next'), '{"row_key": "avg:taxes", "amount_minor": 30000}'));
select is(pg_temp.out_of('mcp1')->'data'->>'undo_kind', 'project_forecast', 'the MCP set returns the project_forecast undo kind');
select is(
  public.mcp_set_project_forecast_edit('pfe-s-1', pg_temp.id('project'), pg_temp.m('next'), '{"row_key": "avg:taxes", "amount_minor": 30000}'),
  pg_temp.out_of('mcp1'),
  'the same key and the same call replays the response'
);
select is(
  public.mcp_undo('pfe-u-1', 'project_forecast', (pg_temp.out_of('mcp1')->'data'->>'id')::uuid)->>'ok',
  'true',
  'the MCP undo of the set succeeds'
);
select is(
  public.mcp_undo('pfe-u-2', 'project_forecast', (pg_temp.out_of('mcp1')->'data'->>'id')::uuid)->'error'->>'code',
  'not_found',
  'a second undo of the same write finds nothing'
);

-- An MCP reset, a change since it, and its undo refused as a conflict.
insert into pfe_out (label, body) values ('mcp2', public.mcp_reset_project_forecast('pfe-r-1', pg_temp.id('project'), null));
select public.mcp_set_project_forecast_edit('pfe-s-2', pg_temp.id('project'), pg_temp.m('now'), '{"row_key": "avg:repairs", "amount_minor": 5000}');
select public.mcp_set_project_forecast_edit('pfe-s-3', pg_temp.id('project'), pg_temp.m('now'), '{"row_key": "rec:income:p-rent", "amount_minor": 1, "pace": "month"}');
select is(
  public.mcp_undo('pfe-u-3', 'project_forecast', (pg_temp.out_of('mcp2')->'data'->>'id')::uuid)->'error'->>'code',
  'conflict',
  'the undo of a reset is a conflict once a row it would put back was set again'
);

select * from finish();

rollback;
