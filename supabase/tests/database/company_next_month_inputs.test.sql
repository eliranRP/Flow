-- FLOW-143 (decision 0196 point 5). company_next_month_inputs: every project's category months as
-- project_category_months gives them, the general costs' months (no project, or overhead; lines shared
-- by allocation stay in their projects), and every project's forecast edits for next month. A viewer
-- reads the same; another company reads its own. Invented data only. "Today" is 2026-09-20, so the
-- complete months are March to August 2026 and next month is October.

begin;

select plan(13);

do $users$
begin
  perform tests.create_supabase_user('cni_owner', 'cni-owner@example.com');
  perform tests.create_supabase_user('cni_viewer', 'cni-viewer@example.com');
  perform tests.create_supabase_user('cni_other', 'cni-other@example.com');
end
$users$;

create temp table cni (label text primary key, id uuid);
grant all on cni to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.cni where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into cni (label, id) values ('co', tests.fixture_company('cni_owner', 'Example Sum LLC', true));
insert into cni (label, id) values ('other_co', tests.fixture_company('cni_other', 'Example Other Sum LLC'));
insert into public.company_viewers (user_id, company_id) values (tests.get_supabase_uid('cni_viewer'), pg_temp.id('co'));
insert into cni (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example House')),
  ('shop', tests.fixture_project(pg_temp.id('co'), 'Example Shop')),
  ('elec', tests.fixture_category(pg_temp.id('co'), 'Electricity')),
  ('office', tests.fixture_category(pg_temp.id('co'), 'Office')),
  ('other_house', tests.fixture_project(pg_temp.id('other_co'), 'Example Other House')),
  ('other_office', tests.fixture_category(pg_temp.id('other_co'), 'Office'));

create function pg_temp.line(p_key text, p_cat text, p_amount bigint, p_date date, p_project text default null,
  p_role text default 'project', p_suggested boolean default false, p_co text default 'co')
returns uuid language sql as $$
  select tests.fixture_line(pg_temp.id(p_co), 'cni:' || p_key, p_amount, p_project => pg_temp.id(p_project),
    p_category => pg_temp.id(p_cat), p_doc_date => p_date, p_pnl_role => p_role, p_suggested => p_suggested)
$$;

-- The house: electricity in July and August.
select pg_temp.line('h7', 'elec', 12000, '2026-07-12', 'house');
select pg_temp.line('h8', 'elec', 10000, '2026-08-12', 'house');
-- A shared electricity line, all of it allocated to the house: the house's months, not the general ones.
insert into cni (label, id) values ('s8', pg_temp.line('s8', 'elec', 5000, '2026-08-20', p_role => 'shared'));
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
values (pg_temp.id('co'), pg_temp.id('s8'), pg_temp.id('house'), 10000, -5000);
-- General: an office line with no project in August, an overhead one in July.
select pg_temp.line('g8', 'office', 6000, '2026-08-03');
select pg_temp.line('g7', 'office', 3000, '2026-07-03', p_role => 'overhead');
-- Not counted: this month's, a suggested category, one still in review.
select pg_temp.line('g9', 'office', 70000, '2026-09-03');
select pg_temp.line('gs', 'office', 80000, '2026-08-04', p_suggested => true);
insert into cni (label, id) values ('gq', pg_temp.line('gq', 'office', 90000, '2026-08-05'));
insert into public.review_queue (company_id, transaction_id, status, reason)
values (pg_temp.id('co'), pg_temp.id('gq'), 'open', 'suggested');
-- The other company's general line.
select pg_temp.line('o8', 'other_office', 44000, '2026-08-03', p_co => 'other_co');

-- Edits: the house's change for October, and one for December that does not apply; the other company's.
insert into public.project_forecast_edits (company_id, project_id, kind, row_key, amount_minor, pace, start_month)
values
  (pg_temp.id('co'), pg_temp.id('house'), 'change', 'avg:x', 15000, 'once', '2026-10'),
  (pg_temp.id('co'), pg_temp.id('house'), 'change', 'avg:y', 25000, 'once', '2026-12'),
  (pg_temp.id('other_co'), pg_temp.id('other_house'), 'change', 'avg:z', 35000, 'once', '2026-10');

create function pg_temp.inputs() returns jsonb language sql stable as $$
  select public.company_next_month_inputs('2026-09-20');
$$;
grant execute on function pg_temp.inputs() to authenticated;

select tests.authenticate_as('cni_owner');
select is(pg_temp.inputs()->>'month', '2026-10', 'next month');
select is(jsonb_array_length(pg_temp.inputs()->'projects'), 2, 'every project of the company');
select is(
  (select x->'categories' from jsonb_array_elements(pg_temp.inputs()->'projects') x where (x->>'project_id')::uuid = pg_temp.id('house')),
  public.project_category_months(pg_temp.id('house'), 6, '2026-09-20')->'categories',
  'a project''s months are the ones its own page reads');
select is(
  (select x->'categories'->0->'months_minor' from jsonb_array_elements(pg_temp.inputs()->'projects') x where (x->>'project_id')::uuid = pg_temp.id('house')),
  '[0, 0, 0, 0, 12000, 15000]'::jsonb,
  'the house''s electricity holds its shared line');
select is(
  (select x->'categories' from jsonb_array_elements(pg_temp.inputs()->'projects') x where (x->>'project_id')::uuid = pg_temp.id('shop')),
  '[]'::jsonb,
  'a project with no lines has no categories');
select is(jsonb_array_length(pg_temp.inputs()->'general'), 1, 'one general category');
select is(pg_temp.inputs()->'general'->0->>'id', pg_temp.id('office')::text, 'office, the general costs');
select is(pg_temp.inputs()->'general'->0->'months_minor', '[0, 0, 0, 0, 3000, 6000]'::jsonb,
  'overhead and no-project lines; not this month''s, a suggested or a reviewed one, or a shared one');
select is(jsonb_array_length(pg_temp.inputs()->'edits'), 1, 'the edits that apply to next month');
select is(pg_temp.inputs()->'edits'->0->>'project_id', pg_temp.id('house')::text, 'each with its project');

select tests.authenticate_as('cni_viewer');
select is(pg_temp.inputs()->'general'->0->'months_minor', '[0, 0, 0, 0, 3000, 6000]'::jsonb, 'a viewer reads the same');

select tests.authenticate_as('cni_other');
select is(pg_temp.inputs()->'general'->0->'months_minor', '[0, 0, 0, 0, 0, 44000]'::jsonb, 'another company reads its own');
select is(pg_temp.inputs()->'edits'->0->>'project_id', pg_temp.id('other_house')::text, 'and its own edits');

select * from finish();
rollback;
