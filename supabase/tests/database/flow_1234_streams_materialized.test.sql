-- FLOW-1234 (20261119104156): the `streams` CTE of company_next_month_inputs is `as materialized`, so the planner
-- computes the recurring charges' lines once instead of rescanning private.recurring_charge_lines_of_projects for
-- each row of the anti join. The answer must not change. Checked against a copy of the body with the CTE's
-- `materialized` taken back out (pg_temp.old_cni_1234), on the same invented fixture as flow_1216_next_month_streams:
-- "today" is 2026-09-20 and amounts are agorot.

begin;

select plan(5);

do $users$
begin
  perform tests.create_supabase_user('st_owner', 'st-owner@example.com');
end
$users$;

create temp table st (label text primary key, id uuid);
grant all on st to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.st where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into st (label, id) values ('co', tests.fixture_company('st_owner', 'Example Materialized LLC'));
insert into st (label, id) values
  ('site', tests.fixture_project(pg_temp.id('co'), 'Example Site')),
  ('old', tests.fixture_project(pg_temp.id('co'), 'Example Old Site', 'finished')),
  ('util', tests.fixture_category(pg_temp.id('co'), 'Example Utility')),
  ('misc', tests.fixture_category(pg_temp.id('co'), 'Example Misc'));

insert into public.suppliers (company_id, name)
select pg_temp.id('co'), n
from unnest(array['Example Steady', 'Example Quarter', 'Example Annual', 'Example Forced', 'Example Ended',
  'Example Loose', 'Example Oldp', 'Example Three']) n;
insert into st (label, id)
select lower(replace(s.name, 'Example ', '')), s.id from public.suppliers s where s.company_id = pg_temp.id('co');

-- label, party, project, date, category
create temp table st_lines (label text, party text, project text, doc_date date, category text);
-- Steady: monthly, on the site from March to May, then with no project (so the site's, by the closest project).
insert into st_lines values
  ('steady_03', 'steady', 'site', '2026-03-05', 'util'), ('steady_04', 'steady', 'site', '2026-04-05', 'util'),
  ('steady_05', 'steady', 'site', '2026-05-05', 'util'), ('steady_06', 'steady', null, '2026-06-05', 'util'),
  ('steady_07', 'steady', null, '2026-07-05', 'util'), ('steady_08', 'steady', null, '2026-08-05', 'util');
-- Quarter: every third month, the last one with no project.
insert into st_lines values
  ('quarter_1125', 'quarter', 'site', '2025-11-10', 'util'), ('quarter_0226', 'quarter', 'site', '2026-02-10', 'util'),
  ('quarter_0526', 'quarter', 'site', '2026-05-10', 'util'), ('quarter_0826', 'quarter', null, '2026-08-10', 'util');
-- Annual: a bill a year, September 2024 and 2025.
insert into st_lines values
  ('annual_2409', 'annual', 'site', '2024-09-12', 'util'), ('annual_2509', 'annual', 'site', '2025-09-12', 'util'),
  ('annual_2509u', 'annual', null, '2025-09-14', 'util');
-- Forced: one line this month, the owner says it is recurring.
insert into st_lines values ('forced_09', 'forced', 'site', '2026-09-02', 'util');
-- Ended: steady's pattern, but the owner says it is not recurring: its lines with no project are general costs.
insert into st_lines values
  ('ended_03', 'ended', 'site', '2026-03-06', 'misc'), ('ended_04', 'ended', 'site', '2026-04-06', 'misc'),
  ('ended_05', 'ended', 'site', '2026-05-06', 'misc'), ('ended_06', 'ended', null, '2026-06-06', 'misc'),
  ('ended_07', 'ended', null, '2026-07-06', 'misc'), ('ended_08', 'ended', null, '2026-08-06', 'misc');
-- Loose: monthly with no project at all: general costs.
insert into st_lines
select 'loose_' || to_char(d, 'MM'), 'loose', null, d::date + 7, 'misc'
from generate_series('2026-03-01'::date, '2026-08-01'::date, interval '1 month') d;
-- Three: monthly on the site, only June to August (the least that makes a monthly charge).
insert into st_lines values
  ('three_06', 'three', 'site', '2026-06-15', 'util'), ('three_07', 'three', 'site', '2026-07-15', 'util'),
  ('three_08', 'three', 'site', '2026-08-15', 'util');
-- Oldp: monthly on a finished project, the last three with no project (the finished project's, so general costs).
insert into st_lines values
  ('oldp_03', 'oldp', 'old', '2026-03-08', 'misc'), ('oldp_04', 'oldp', 'old', '2026-04-08', 'misc'),
  ('oldp_05', 'oldp', 'old', '2026-05-08', 'misc'), ('oldp_06', 'oldp', null, '2026-06-08', 'misc'),
  ('oldp_07', 'oldp', null, '2026-07-08', 'misc'), ('oldp_08', 'oldp', null, '2026-08-08', 'misc');

insert into st (label, id)
select l.label, tests.fixture_line(
  pg_temp.id('co'), 'st:' || l.label, 10000, 'expense', pg_temp.id(l.project), pg_temp.id(l.category), l.doc_date,
  p_pnl_role => case when l.project is null then null else 'project' end
)
from st_lines l;
update public.transactions t
set supplier_id = pg_temp.id(l.party)
from st_lines l
where t.id = pg_temp.id(l.label);

insert into public.recurring_overrides (company_id, direction, party_id, currency, project_id, recurring)
values (pg_temp.id('co'), 'expense', pg_temp.id('forced'), 'ILS', pg_temp.id('site'), true),
  (pg_temp.id('co'), 'expense', pg_temp.id('ended'), 'ILS', null, false);

-- The body with the CTE's `materialized` taken back out: the answer before this change.
do $old$
declare
  def text := pg_get_functiondef('public.company_next_month_inputs(date,boolean)'::regprocedure);
begin
  execute replace(replace(def, 'with streams as materialized (', 'with streams as ('),
    'public.company_next_month_inputs', 'pg_temp.old_cni_1234');
end
$old$;
grant execute on function pg_temp.old_cni_1234(date, boolean) to authenticated;

select ok(position('with streams as materialized (' in pg_get_functiondef(
    'public.company_next_month_inputs(date,boolean)'::regprocedure)) > 0,
  'the streams CTE of company_next_month_inputs is as materialized');

select tests.authenticate_as('st_owner');

select is(public.company_next_month_inputs('2026-09-20', true), pg_temp.old_cni_1234('2026-09-20', true),
  'the whole answer is the answer before the CTE was materialized');
select is(public.company_next_month_inputs('2026-09-20', false), pg_temp.old_cni_1234('2026-09-20', false),
  'and without rest_edits');
select is((select array_agg(g->>'name' order by g->>'name') from jsonb_array_elements(public.company_next_month_inputs('2026-09-20')->'general') g),
  array['Example Misc'], 'the general costs leave out the recurring charges'' lines (utility), and keep the others (misc)');
select is((select g->'months_minor' from jsonb_array_elements(public.company_next_month_inputs('2026-09-20')->'general') g
    where g->>'name' = 'Example Misc'),
  '[10000, 10000, 10000, 30000, 30000, 30000]'::jsonb,
  'the misc months: the party with no project, the ended charge from June, the finished project''s from June');

select * from finish();
rollback;
