-- FLOW-1184: a row taken out of a project's forecast for one month only, or from that month on. A line added on a
-- pace and removed for its first month only is still expected in the months after; removed from it on, it goes.
-- The MCP removal takes the same pace. Invented data only.

begin;

select plan(22);

do $users$
begin
  perform tests.create_supabase_user('frp_owner', 'frp-owner@example.com');
end
$users$;

create temp table frp (label text primary key, id uuid);
grant all on frp to authenticated, service_role;
create temp table frp_month (label text primary key, m text);
grant all on frp_month to authenticated, service_role;
create temp table frp_out (label text primary key, body jsonb);
grant all on frp_out to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$ select id from frp where label = p_label; $$;
create function pg_temp.m(p_label text) returns text language sql stable as $$ select m from frp_month where label = p_label; $$;
create function pg_temp.out_of(p_label text) returns jsonb language sql stable as $$ select body from frp_out where label = p_label; $$;
-- Whether the row is out of the month: a removal of it applies there.
create function pg_temp.out_in(p_row_key text, p_month text) returns boolean language sql stable as $$
  select exists (select 1 from jsonb_array_elements(public.project_forecast_edits_for(pg_temp.id('project'), p_month)) x
    where x->>'kind' = 'remove' and x->>'row_key' = p_row_key);
$$;
-- Whether the added line is in the month's edits.
create function pg_temp.line_in(p_label text, p_month text) returns boolean language sql stable as $$
  select exists (select 1 from jsonb_array_elements(public.project_forecast_edits_for(pg_temp.id('project'), p_month)) x
    where x->>'kind' = 'add' and x->>'id' = pg_temp.out_of(p_label)->'edit'->>'id');
$$;
grant execute on function pg_temp.id(text), pg_temp.m(text), pg_temp.out_of(text), pg_temp.out_in(text, text), pg_temp.line_in(text, text)
  to authenticated, service_role;

insert into frp_month (label, m)
select label, to_char(date_trunc('month', private.flow_today()) + (n || ' month')::interval, 'YYYY-MM')
from (values ('now', 0), ('next', 1), ('next2', 2)) v(label, n);

select tests.authenticate_as('frp_owner');
select public.create_company('Removal Pace Books', true);
insert into frp (label, id) values ('project', public.upsert_project(p_name => 'Linden Ct', p_status => 'active'));
insert into frp (label, id) values ('category', public.create_category('Rental income', 'income'));

-- A monthly line added this month, removed for this month only: it stays, and the months after still expect it.
insert into frp_out (label, body) values ('line', public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('now'),
  jsonb_build_object('category_id', pg_temp.id('category'), 'amount_minor', 72900, 'pace', 'month')));
insert into frp_out (label, body) values ('once', public.remove_project_forecast_row(pg_temp.id('project'), pg_temp.m('now'),
  'add:' || (pg_temp.out_of('line')->'edit'->>'id'), 'once'));
select is(pg_temp.out_of('once')->'edit'->>'pace', 'once', 'a removal for this month only is once');
select ok(pg_temp.line_in('line', pg_temp.m('next')), 'the line is not deleted');
select ok(pg_temp.out_in('add:' || (pg_temp.out_of('line')->'edit'->>'id'), pg_temp.m('now')), 'the line is out of this month');
select ok(not pg_temp.out_in('add:' || (pg_temp.out_of('line')->'edit'->>'id'), pg_temp.m('next')), 'next month still expects it');
select is(pg_temp.out_of('once')->'undo'->'drop'->>0, pg_temp.out_of('once')->'edit'->>'id', 'its undo drops the removal');

-- A recurring row out for this month only, then asked out from it on: the removal now holds from this month on,
-- and its undo puts the one-month removal back.
select public.remove_project_forecast_row(pg_temp.id('project'), pg_temp.m('now'), 'rec:expense:00000000-0000-4000-8000-0000000000c2', 'once');
insert into frp_out (label, body) values ('on', public.remove_project_forecast_row(pg_temp.id('project'), pg_temp.m('now'),
  'rec:expense:00000000-0000-4000-8000-0000000000c2', 'month'));
select is(pg_temp.out_of('on')->'edit'->>'pace', 'month', 'asked from this month on, the removal holds from it on');
select ok(pg_temp.out_in('rec:expense:00000000-0000-4000-8000-0000000000c2', pg_temp.m('next2')), 'the row is out of the months after');
select is(pg_temp.out_of('on')->'undo'->'put'->0->>'pace', 'once', 'its undo puts the one-month removal back');
select is(public.undo_project_forecast(pg_temp.id('project'), pg_temp.out_of('on')->'undo')->>'put', '1', 'the undo runs');
select ok(not pg_temp.out_in('rec:expense:00000000-0000-4000-8000-0000000000c2', pg_temp.m('next')), 'after the undo next month expects it again');

-- Once more for this month only: already out, nothing to undo.
select is(
  public.remove_project_forecast_row(pg_temp.id('project'), pg_temp.m('now'), 'add:' || (pg_temp.out_of('line')->'edit'->>'id'), 'once')->'undo',
  '{"drop": [], "put": []}'::jsonb,
  'a row already out of the month stays out'
);

-- From this month on, for a line that starts this month: the line itself goes (as before).
select public.restore_project_forecast_row(pg_temp.id('project'), pg_temp.m('now'), 'add:' || (pg_temp.out_of('line')->'edit'->>'id'));
insert into frp_out (label, body) values ('gone', public.remove_project_forecast_row(pg_temp.id('project'), pg_temp.m('now'),
  'add:' || (pg_temp.out_of('line')->'edit'->>'id'), 'month'));
select ok(pg_temp.out_of('gone')->'edit' = 'null'::jsonb, 'a line that starts this month is deleted when it goes from it on');
select ok(not pg_temp.line_in('line', pg_temp.m('next')), 'and no month expects it');

-- A line for this month only, removed for this month only: it is deleted (it has no other month).
insert into frp_out (label, body) values ('single', public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('now'),
  jsonb_build_object('category_id', pg_temp.id('category'), 'amount_minor', 10000, 'pace', 'once')));
select ok(public.remove_project_forecast_row(pg_temp.id('project'), pg_temp.m('now'), 'add:' || (pg_temp.out_of('single')->'edit'->>'id'), 'once')->'edit' = 'null'::jsonb,
  'a line for its month only is deleted');

-- A monthly line added this month, removed next month only: this month and the month after keep it.
insert into frp_out (label, body) values ('line2', public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('now'),
  jsonb_build_object('category_id', pg_temp.id('category'), 'amount_minor', 80100, 'pace', 'month')));
select public.remove_project_forecast_row(pg_temp.id('project'), pg_temp.m('next'), 'add:' || (pg_temp.out_of('line2')->'edit'->>'id'), 'once');
select ok(pg_temp.out_in('add:' || (pg_temp.out_of('line2')->'edit'->>'id'), pg_temp.m('next')), 'out of the month it was removed from');
select ok(not pg_temp.out_in('add:' || (pg_temp.out_of('line2')->'edit'->>'id'), pg_temp.m('now')), 'this month keeps it');
select ok(not pg_temp.out_in('add:' || (pg_temp.out_of('line2')->'edit'->>'id'), pg_temp.m('next2')), 'the month after keeps it');

-- A recurring row, once: the next month expects it.
select public.remove_project_forecast_row(pg_temp.id('project'), pg_temp.m('now'), 'rec:expense:00000000-0000-4000-8000-0000000000c1', 'once');
select ok(not pg_temp.out_in('rec:expense:00000000-0000-4000-8000-0000000000c1', pg_temp.m('next')), 'a recurring row removed once is back next month');

-- No pace, as callers before this change: from the month on.
select is(
  public.remove_project_forecast_row(pg_temp.id('project'), pg_temp.m('now'), 'avg:none')->'edit'->>'pace',
  'month',
  'with no pace a removal holds from its month on'
);
select throws_ok(
  format('select public.remove_project_forecast_row(%L, %L, %L, %L)', pg_temp.id('project'), pg_temp.m('now'), 'avg:none', 'year'),
  '22023',
  'validation',
  'a removal takes once or month only'
);

-- MCP: the removal takes the pace too.
reset role;
select public.store_mcp_credential(tests.get_supabase_uid('frp_owner'), 'hash-frp-write-0001', array['read','write'],
  now() + interval '90 days', 'pepper-frp');
insert into frp (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-frp-write-0001';
do $as$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', tests.get_supabase_uid('frp_owner')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', tests.get_supabase_uid('frp_owner'), 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id('write'))::text, true);
end
$as$;
insert into frp_out (label, body) values ('mcp', public.mcp_remove_project_forecast_row('frp-r-1', pg_temp.id('project'), pg_temp.m('next'),
  'rec:income:00000000-0000-4000-8000-0000000000d1', 'once'));
select is(pg_temp.out_of('mcp')->'data'->'edit'->>'pace', 'once', 'the MCP removal for one month is once');
select is(
  public.mcp_remove_project_forecast_row('frp-r-2', pg_temp.id('project'), pg_temp.m('next'), 'rec:income:00000000-0000-4000-8000-0000000000d2')->'data'->'edit'->>'pace',
  'month',
  'the MCP removal with no pace holds from its month on'
);

select * from finish();

rollback;
