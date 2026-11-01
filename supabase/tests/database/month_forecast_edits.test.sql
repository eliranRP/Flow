-- FLOW-1005: company_forecast_edits_for, the project forecast edits the month-end forecast counts:
-- every active project's and the overhead project's edits that apply to the month, with their project
-- and category name; a finished project's are left out; viewers read; another company reads nothing.
-- Invented data only.

begin;

select plan(9);

do $users$
begin
  perform tests.create_supabase_user('mfe_owner', 'mfe-owner@example.com');
  perform tests.create_supabase_user('mfe_viewer', 'mfe-viewer@example.com');
  perform tests.create_supabase_user('mfe_other', 'mfe-other@example.com');
end
$users$;

create temp table mfe (label text primary key, id uuid);
grant all on mfe to authenticated, service_role;
create temp table mfe_month (label text primary key, m text);
grant all on mfe_month to authenticated, service_role;
create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from mfe where label = p_label;
$$;
create function pg_temp.m(p_label text) returns text language sql stable as $$
  select m from mfe_month where label = p_label;
$$;
grant execute on function pg_temp.id(text), pg_temp.m(text) to authenticated, service_role;

insert into mfe_month (label, m)
select label, to_char(date_trunc('month', private.flow_today()) + (n || ' month')::interval, 'YYYY-MM')
from (values ('now', 0), ('next', 1)) v(label, n);

select tests.authenticate_as('mfe_other');
select public.create_company('Other Month Edits Co', true);

select tests.authenticate_as('mfe_owner');
select public.create_company('Month Edits Books', true);
insert into mfe (label, id) values ('project', public.upsert_project(p_name => 'Juniper Ct', p_status => 'active'));
insert into mfe (label, id) values ('office', public.upsert_project(p_name => 'Office', p_status => 'active'));
insert into mfe (label, id) values ('done', public.upsert_project(p_name => 'Old Ct', p_status => 'active'));
insert into mfe (label, id) values ('category', public.create_category('Utility refund', 'income'));
select public.set_overhead_project(pg_temp.id('office'));

-- An added line every month, a removed recurring charge, a changed one; one for next month only; a project that ends.
select public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('now'), jsonb_build_object('category_id', pg_temp.id('category'), 'amount_minor', 17176, 'pace', 'month'));
select public.remove_project_forecast_row(pg_temp.id('project'), pg_temp.m('now'), 'rec:expense:00000000-0000-4000-8000-0000000000c1');
select public.set_project_forecast_edit(pg_temp.id('office'), pg_temp.m('now'), '{"row_key": "rec:expense:00000000-0000-4000-8000-0000000000c2", "amount_minor": 5000}');
select public.set_project_forecast_edit(pg_temp.id('project'), pg_temp.m('next'), '{"row_key": "rec:income:00000000-0000-4000-8000-0000000000c3", "amount_minor": 9000}');
select public.set_project_forecast_edit(pg_temp.id('done'), pg_temp.m('now'), '{"row_key": "rec:expense:00000000-0000-4000-8000-0000000000c4", "amount_minor": 100}');
select public.upsert_project(p_id => pg_temp.id('done'), p_name => 'Old Ct', p_status => 'finished');

create function pg_temp.read(p_month text) returns jsonb language sql stable as $$
  select public.company_forecast_edits_for(p_month);
$$;
grant execute on function pg_temp.read(text) to authenticated, service_role;

select is(jsonb_array_length(pg_temp.read(pg_temp.m('now'))->'edits'), 3, 'the month lists the edits that apply to it, of active projects and the overhead project');
select is(pg_temp.read(pg_temp.m('now'))->>'overhead_project_id', pg_temp.id('office')::text, 'it names the overhead project');
select is(
  (select x->>'category_name' from jsonb_array_elements(pg_temp.read(pg_temp.m('now'))->'edits') x where x->>'kind' = 'add'),
  'Utility refund',
  'an added line comes with its category name'
);
select is(
  (select x->>'project_id' from jsonb_array_elements(pg_temp.read(pg_temp.m('now'))->'edits') x where x->>'kind' = 'remove'),
  pg_temp.id('project')::text,
  'each edit names its project'
);
select ok(
  (select x ? 'matched_transaction_id' from jsonb_array_elements(pg_temp.read(pg_temp.m('now'))->'edits') x where x->>'kind' = 'add'),
  'an added line carries its match for the month (none yet)'
);
select is(jsonb_array_length(pg_temp.read(pg_temp.m('next'))->'edits'), 3, 'next month: the monthly line, the removal from this month on, and its own change');

select throws_ok($$select public.company_forecast_edits_for('2026-13')$$, '22023', 'validation', 'a month that is not one is refused');

select tests.authenticate_as('mfe_viewer');
select throws_ok($$select public.company_forecast_edits_for('2026-11')$$, '42501', 'forbidden', 'a user with no company reads nothing');

select tests.authenticate_as('mfe_other');
select is(jsonb_array_length(pg_temp.read(pg_temp.m('now'))->'edits'), 0, 'another company reads none of these edits');

select * from finish();
rollback;
