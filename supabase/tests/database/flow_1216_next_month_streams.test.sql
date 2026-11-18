-- FLOW-1216 (20261118094256): company_next_month_inputs reads the lines of the recurring charges from
-- private.recurring_charge_lines_of_projects, no longer from recurring_stream_lines joined to recurring_parties
-- (which built the usual amounts, the last bills and the categories nobody read here). Checked against a copy of
-- the body from before this change (pg_temp.old_cni_1216: the new body with the old `streams` CTE put back):
--  - the lines the new function returns are the old join's lines, with a monthly, a quarterly and a yearly charge,
--    a charge the owner marked recurring before a complete month (forced), a charge the owner ended, a party with no
--    project, and a charge on a finished project;
--  - the whole answer is the old answer, with and without rest_edits;
--  - the general costs leave out the recurring charges' lines, and keep the others.
-- Invented data only. Amounts are agorot. "Today" is 2026-09-20: the complete months are March to August 2026.

begin;

select plan(8);

do $users$
begin
  perform tests.create_supabase_user('sm_owner', 'sm-owner@example.com');
end
$users$;

create temp table sm (label text primary key, id uuid);
grant all on sm to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.sm where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into sm (label, id) values ('co', tests.fixture_company('sm_owner', 'Example Streams LLC'));
insert into sm (label, id) values
  ('site', tests.fixture_project(pg_temp.id('co'), 'Example Site')),
  ('old', tests.fixture_project(pg_temp.id('co'), 'Example Old Site', 'finished')),
  ('util', tests.fixture_category(pg_temp.id('co'), 'Example Utility')),
  ('misc', tests.fixture_category(pg_temp.id('co'), 'Example Misc'));

insert into public.suppliers (company_id, name)
select pg_temp.id('co'), n
from unnest(array['Example Steady', 'Example Quarter', 'Example Annual', 'Example Forced', 'Example Ended',
  'Example Loose', 'Example Oldp', 'Example Three']) n;
insert into sm (label, id)
select lower(replace(s.name, 'Example ', '')), s.id from public.suppliers s where s.company_id = pg_temp.id('co');

-- label, party, project, date, category
create temp table sm_lines (label text, party text, project text, doc_date date, category text);
-- Steady: monthly 100.00, on the site from March to May, then with no project (so the site's, by the closest
-- project) June to August.
insert into sm_lines values
  ('steady_03', 'steady', 'site', '2026-03-05', 'util'), ('steady_04', 'steady', 'site', '2026-04-05', 'util'),
  ('steady_05', 'steady', 'site', '2026-05-05', 'util'), ('steady_06', 'steady', null, '2026-06-05', 'util'),
  ('steady_07', 'steady', null, '2026-07-05', 'util'), ('steady_08', 'steady', null, '2026-08-05', 'util');
-- Quarter: every third month, the last one with no project.
insert into sm_lines values
  ('quarter_1125', 'quarter', 'site', '2025-11-10', 'util'), ('quarter_0226', 'quarter', 'site', '2026-02-10', 'util'),
  ('quarter_0526', 'quarter', 'site', '2026-05-10', 'util'), ('quarter_0826', 'quarter', null, '2026-08-10', 'util');
-- Annual: a bill a year, September 2024 and 2025.
insert into sm_lines values
  ('annual_2409', 'annual', 'site', '2024-09-12', 'util'), ('annual_2509', 'annual', 'site', '2025-09-12', 'util'),
  ('annual_2509u', 'annual', null, '2025-09-14', 'util');
-- Forced: one line this month, the owner says it is recurring.
insert into sm_lines values ('forced_09', 'forced', 'site', '2026-09-02', 'util');
-- Ended: steady's pattern, but the owner says it is not recurring: its lines with no project are general costs.
insert into sm_lines values
  ('ended_03', 'ended', 'site', '2026-03-06', 'misc'), ('ended_04', 'ended', 'site', '2026-04-06', 'misc'),
  ('ended_05', 'ended', 'site', '2026-05-06', 'misc'), ('ended_06', 'ended', null, '2026-06-06', 'misc'),
  ('ended_07', 'ended', null, '2026-07-06', 'misc'), ('ended_08', 'ended', null, '2026-08-06', 'misc');
-- Loose: monthly with no project at all: general costs.
insert into sm_lines
select 'loose_' || to_char(d, 'MM'), 'loose', null, d::date + 7, 'misc'
from generate_series('2026-03-01'::date, '2026-08-01'::date, interval '1 month') d;
-- Three: monthly on the site, only June to August (the least that makes a monthly charge).
insert into sm_lines values
  ('three_06', 'three', 'site', '2026-06-15', 'util'), ('three_07', 'three', 'site', '2026-07-15', 'util'),
  ('three_08', 'three', 'site', '2026-08-15', 'util');
-- Oldp: monthly on a finished project, the last three with no project (the finished project's, so general costs).
insert into sm_lines values
  ('oldp_03', 'oldp', 'old', '2026-03-08', 'misc'), ('oldp_04', 'oldp', 'old', '2026-04-08', 'misc'),
  ('oldp_05', 'oldp', 'old', '2026-05-08', 'misc'), ('oldp_06', 'oldp', null, '2026-06-08', 'misc'),
  ('oldp_07', 'oldp', null, '2026-07-08', 'misc'), ('oldp_08', 'oldp', null, '2026-08-08', 'misc');

insert into sm (label, id)
select l.label, tests.fixture_line(
  pg_temp.id('co'), 'sm:' || l.label, 10000, 'expense', pg_temp.id(l.project), pg_temp.id(l.category), l.doc_date,
  p_pnl_role => case when l.project is null then null else 'project' end
)
from sm_lines l;
update public.transactions t
set supplier_id = pg_temp.id(l.party)
from sm_lines l
where t.id = pg_temp.id(l.label);

insert into public.recurring_overrides (company_id, direction, party_id, currency, project_id, recurring)
values (pg_temp.id('co'), 'expense', pg_temp.id('forced'), 'ILS', pg_temp.id('site'), true),
  (pg_temp.id('co'), 'expense', pg_temp.id('ended'), 'ILS', null, false);

-- The body from before this change: the new body with the old `streams` CTE put back.
do $old$
declare
  def text := pg_get_functiondef('public.company_next_month_inputs(date,boolean)'::regprocedure);
  a text := $a$    select sl.id
    from private.recurring_charge_lines_of_projects(cid, today) sl
    join public.projects sp on sp.id = sl.stream_project and sp.status = 'active'
    where sl.stream_project is distinct from overhead
  ),$a$;
  b text := $b$    select sl.id
    from private.recurring_stream_lines(cid, today) sl
    join private.recurring_parties(cid, today) rp
      on rp.direction = sl.direction and rp.party_id = sl.party_id and rp.currency = sl.currency
      and rp.project_id = sl.stream_project
    join public.projects sp on sp.id = sl.stream_project and sp.status = 'active'
    where sl.stream_project is not null
      and sl.stream_project is distinct from overhead
  ),$b$;
begin
  if position(a in def) = 0 then
    raise exception 'the new body does not read the new function';
  end if;
  execute replace(replace(def, a, b), 'public.company_next_month_inputs', 'pg_temp.old_cni_1216');
end
$old$;
grant execute on function pg_temp.old_cni_1216(date, boolean) to authenticated;

select ok(not has_function_privilege('anon', 'private.recurring_charge_lines_of_projects(uuid, date)', 'execute')
    and not has_function_privilege('authenticated', 'private.recurring_charge_lines_of_projects(uuid, date)', 'execute'),
  'the new function is closed to the API roles');

create temp table sm_new as
select h.id from private.recurring_charge_lines_of_projects(pg_temp.id('co'), '2026-09-20') h;
create temp table sm_old as
select sl.id
from private.recurring_stream_lines(pg_temp.id('co'), '2026-09-20') sl
join private.recurring_parties(pg_temp.id('co'), '2026-09-20') rp
  on rp.direction = sl.direction and rp.party_id = sl.party_id and rp.currency = sl.currency
  and rp.project_id = sl.stream_project
where sl.stream_project is not null;

select ok((select count(*) from sm_new) >= 20
    and exists (select 1 from sm_new where id = pg_temp.id('steady_07'))
    and exists (select 1 from sm_new where id = pg_temp.id('forced_09'))
    and exists (select 1 from sm_new where id = pg_temp.id('three_08'))
    and not exists (select 1 from sm_new where id in (pg_temp.id('loose_05'), pg_temp.id('ended_07'))),
  'the recurring charges'' lines are there: the monthly ones (one with its lines with no project, one with the least months), the forced one; not the ended one or the party with no project');
select is((select coalesce(array_agg(id order by id), '{}') from sm_new),
  (select coalesce(array_agg(id order by id), '{}') from sm_old),
  'the lines are the ones the join of recurring_stream_lines and recurring_parties gave');

select tests.authenticate_as('sm_owner');

select is(public.company_next_month_inputs('2026-09-20', true), pg_temp.old_cni_1216('2026-09-20', true),
  'the whole answer is the old answer');
select is(public.company_next_month_inputs('2026-09-20', false), pg_temp.old_cni_1216('2026-09-20', false),
  'and without rest_edits');
select is((select array_agg(g->>'name' order by g->>'name') from jsonb_array_elements(public.company_next_month_inputs('2026-09-20')->'general') g),
  array['Example Misc'], 'the general costs leave out the recurring charges'' lines (utility), and keep the others (misc)');
select is((select g->'months_minor' from jsonb_array_elements(public.company_next_month_inputs('2026-09-20')->'general') g
    where g->>'name' = 'Example Misc'),
  '[10000, 10000, 10000, 30000, 30000, 30000]'::jsonb,
  'the misc months: the party with no project, the ended charge from June, the finished project''s from June');
select is(pg_temp.old_cni_1216('2026-09-20')->'general', public.company_next_month_inputs('2026-09-20')->'general',
  'general is the old general');

select * from finish();
rollback;
