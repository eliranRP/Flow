-- FLOW-1010: set_project_forecast_edit on an added line (row_key add:<id>) in the month it starts edits the
-- line itself, its amount and its pace, so it can repeat; its undo puts it back; a later month's edit of it is
-- still a change of that month. Invented data only.

begin;

select plan(10);

do $users$
begin
  perform tests.create_supabase_user('flp_owner', 'flp-owner@example.com');
end
$users$;

create temp table flp (label text primary key, id uuid);
grant all on flp to authenticated, service_role;
create temp table flp_month (label text primary key, m text);
grant all on flp_month to authenticated, service_role;
create temp table flp_out (label text primary key, body jsonb);
grant all on flp_out to authenticated, service_role;
create function pg_temp.id(p_label text) returns uuid language sql stable as $$ select id from flp where label = p_label; $$;
create function pg_temp.m(p_label text) returns text language sql stable as $$ select m from flp_month where label = p_label; $$;
create function pg_temp.out_of(p_label text) returns jsonb language sql stable as $$ select body from flp_out where label = p_label; $$;
grant execute on function pg_temp.id(text), pg_temp.m(text), pg_temp.out_of(text) to authenticated, service_role;

insert into flp_month (label, m)
select label, to_char(date_trunc('month', private.flow_today()) + (n || ' month')::interval, 'YYYY-MM')
from (values ('now', 0), ('next', 1)) v(label, n);

select tests.authenticate_as('flp_owner');
select public.create_company('Line Pace Books', true);
insert into flp (label, id) values ('project', public.upsert_project(p_name => 'Green Ct', p_status => 'active'));
insert into flp (label, id) values ('category', public.create_category('Rent in', 'income'));

-- A line added for this month only.
insert into flp_out (label, body)
values ('add', public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('now'),
  jsonb_build_object('category_id', pg_temp.id('category'), 'amount_minor', 72900, 'pace', 'once')));
insert into flp (label, id) select 'line', (pg_temp.out_of('add')->'edit'->>'id')::uuid;

-- Made to repeat every month, in the month it starts: the line itself changes.
insert into flp_out (label, body)
values ('pace', public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('now'),
  jsonb_build_object('row_key', 'add:' || pg_temp.id('line'), 'amount_minor', 75000, 'pace', 'month')));
select is(pg_temp.out_of('pace')->'edit'->>'id', pg_temp.id('line')::text, 'the edit is the line itself');
select is(pg_temp.out_of('pace')->'edit'->>'kind', 'add', 'it stays an added line');
select is(
  (select count(*)::integer from jsonb_array_elements(public.project_forecast_edits_for(pg_temp.id('project'), pg_temp.m('next'))) x
   where x->>'id' = pg_temp.id('line')::text and x->>'amount_minor' = '75000'),
  1,
  'it now repeats into next month, with its new amount'
);

-- Its undo puts the line back as it was.
select public.undo_project_forecast(pg_temp.id('project'), pg_temp.out_of('pace')->'undo');
select is(
  (select x->>'pace' from jsonb_array_elements(public.project_forecast_edits_for(pg_temp.id('project'), pg_temp.m('now'))) x
   where x->>'id' = pg_temp.id('line')::text),
  'once',
  'the undo puts the line back to once'
);
select is(jsonb_array_length(public.project_forecast_edits_for(pg_temp.id('project'), pg_temp.m('next'))), 0, 'and it is gone from next month again');

-- Repeat it again, then edit it next month: that is a change of next month, not the line.
select public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('now'),
  jsonb_build_object('row_key', 'add:' || pg_temp.id('line'), 'amount_minor', 72900, 'pace', 'month'));
insert into flp_out (label, body)
values ('later', public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('next'),
  jsonb_build_object('row_key', 'add:' || pg_temp.id('line'), 'amount_minor', 80000)));
select is(pg_temp.out_of('later')->'edit'->>'kind', 'change', 'a later month''s edit of the line is a change');
select isnt(pg_temp.out_of('later')->'edit'->>'id', pg_temp.id('line')::text, 'and not the line itself');

-- A change of the line for its first month, made the old way: the next save there drops it, and its undo
-- puts it back.
reset role;
insert into public.project_forecast_edits (company_id, project_id, kind, row_key, amount_minor, pace, start_month)
select p.company_id, p.id, 'change', 'add:' || pg_temp.id('line'), 50000, 'once', pg_temp.m('now')
from public.projects p where p.id = pg_temp.id('project');
select tests.authenticate_as('flp_owner');
insert into flp_out (label, body)
values ('over', public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('now'),
  jsonb_build_object('row_key', 'add:' || pg_temp.id('line'), 'amount_minor', 90000, 'pace', 'month')));
select is(
  (select count(*)::integer from jsonb_array_elements(public.project_forecast_edits_for(pg_temp.id('project'), pg_temp.m('now'))) x
   where x->>'kind' = 'change' and x->>'row_key' = 'add:' || pg_temp.id('line')),
  0,
  'an older change of the line for its first month goes, so the new amount is the one used'
);
select is(jsonb_array_length(pg_temp.out_of('over')->'undo'->'put'), 2, 'the undo holds the line and the change');
select public.undo_project_forecast(pg_temp.id('project'), pg_temp.out_of('over')->'undo');
select is(
  (select x->>'amount_minor' from jsonb_array_elements(public.project_forecast_edits_for(pg_temp.id('project'), pg_temp.m('now'))) x
   where x->>'kind' = 'change' and x->>'row_key' = 'add:' || pg_temp.id('line')),
  '50000',
  'and the undo puts the change back'
);

select * from finish();
rollback;
