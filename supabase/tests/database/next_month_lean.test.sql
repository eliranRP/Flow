-- FLOW-1171. company_next_month_inputs gives each category four fields (id, name, currency, months_minor), read for
-- every project in one pass (private.project_category_months_lean), and leaves rest_edits out when asked
-- (p_rest false). The lean rows are the project page's rows (project_category_months_many, which the page still
-- reads whole: all eleven fields), field for field, in the same order; a line split between projects counts in
-- each part's project; another company's projects and a user with no company read nothing.
-- Invented data only. "Today" is 2026-09-20, so the complete months are March to August 2026 and next month is
-- October.

begin;

select plan(17);

do $users$
begin
  perform tests.create_supabase_user('nml_owner', 'nml-owner@example.com');
  perform tests.create_supabase_user('nml_other', 'nml-other@example.com');
  perform tests.create_supabase_user('nml_nobody', 'nml-nobody@example.com');
end
$users$;

create temp table nml (label text primary key, id uuid);
grant all on nml to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.nml where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into nml (label, id) values ('co', tests.fixture_company('nml_owner', 'Example Lean LLC'));
insert into nml (label, id) values ('other_co', tests.fixture_company('nml_other', 'Example Other Lean LLC'));
insert into nml (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example House')),
  ('shop', tests.fixture_project(pg_temp.id('co'), 'Example Shop')),
  ('yard', tests.fixture_project(pg_temp.id('co'), 'Example Yard')),
  ('elec', tests.fixture_category(pg_temp.id('co'), 'Electricity')),
  ('paint', tests.fixture_category(pg_temp.id('co'), 'Paint')),
  ('other_house', tests.fixture_project(pg_temp.id('other_co'), 'Example Other House')),
  ('other_paint', tests.fixture_category(pg_temp.id('other_co'), 'Paint'));

create function pg_temp.line(p_key text, p_cat text, p_amount bigint, p_date date, p_project text default null,
  p_role text default 'project', p_co text default 'co')
returns uuid language sql as $$
  select tests.fixture_line(pg_temp.id(p_co), 'nml:' || p_key, p_amount, p_project => pg_temp.id(p_project),
    p_category => pg_temp.id(p_cat), p_doc_date => p_date, p_pnl_role => p_role)
$$;

-- The house: electricity in July and August, paint in August and this month.
select pg_temp.line('h7', 'elec', 12000, '2026-07-12', 'house');
select pg_temp.line('h8', 'elec', 10000, '2026-08-12', 'house');
select pg_temp.line('hp8', 'paint', 40000, '2026-08-05', 'house');
select pg_temp.line('hp9', 'paint', 9000, '2026-09-02', 'house');
-- A paint line shared 60/40 by the house and the shop.
insert into nml (label, id) values ('s7', pg_temp.line('s7', 'paint', 20000, '2026-07-14', p_role => 'shared'));
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
values (pg_temp.id('co'), pg_temp.id('s7'), pg_temp.id('house'), 6000, -12000),
  (pg_temp.id('co'), pg_temp.id('s7'), pg_temp.id('shop'), 4000, -8000);
-- A line on the house split in two parts: 6000 electricity for the house, 4000 paint for the shop. The shop's
-- part counts for the shop though the line's own project is the house.
insert into nml (label, id) values ('sp8', pg_temp.line('sp8', 'elec', 10000, '2026-08-05', 'house'));
select private.set_line_parts(pg_temp.id('co'), pg_temp.id('sp8'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.id('elec'), 'project_id', pg_temp.id('house'), 'amount_minor', 6000),
  jsonb_build_object('category_id', pg_temp.id('paint'), 'project_id', pg_temp.id('shop'), 'amount_minor', 4000)));
-- The other company's line.
select pg_temp.line('o8', 'other_paint', 30000, '2026-08-03', 'other_house', p_co => 'other_co');

-- Edits: one for October and one for December (the later months' only), and the other company's.
insert into public.project_forecast_edits (company_id, project_id, kind, row_key, amount_minor, pace, start_month)
values
  (pg_temp.id('co'), pg_temp.id('house'), 'change', 'avg:x', 15000, 'once', '2026-10'),
  (pg_temp.id('co'), pg_temp.id('house'), 'change', 'avg:y', 25000, 'once', '2026-12'),
  (pg_temp.id('other_co'), pg_temp.id('other_house'), 'change', 'avg:z', 35000, 'once', '2026-10');

-- The project page's rows, as the four fields the forecast reads, in their order.
create function pg_temp.four(p_categories jsonb) returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object('id', e->'id', 'name', e->'name', 'currency', e->'currency', 'months_minor', e->'months_minor') order by o)
  from jsonb_array_elements(p_categories) with ordinality t(e, o);
$$;
grant execute on function pg_temp.four(jsonb) to authenticated;

create function pg_temp.lean(p_projects text[]) returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(m.project_id, m.categories), '{}'::jsonb)
  from private.project_category_months_lean(array(select pg_temp.id(l) from unnest(p_projects) l), 6, '2026-09-20') m;
$$;
grant execute on function pg_temp.lean(text[]) to authenticated;

create function pg_temp.many(p_projects text[]) returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(m.project_id, pg_temp.four(m.categories)), '{}'::jsonb)
  from private.project_category_months_many(array(select pg_temp.id(l) from unnest(p_projects) l), 6, '2026-09-20') m;
$$;
grant execute on function pg_temp.many(text[]) to authenticated;

create function pg_temp.keys(p_categories jsonb) returns boolean language sql immutable as $$
  select coalesce(bool_and((select array_agg(k order by k) from jsonb_object_keys(c) k) = array['currency', 'id', 'months_minor', 'name']), false)
  from jsonb_array_elements(p_categories) c;
$$;
grant execute on function pg_temp.keys(jsonb) to authenticated;

create function pg_temp.inputs(p_rest boolean default true) returns jsonb language sql stable as $$
  select public.company_next_month_inputs('2026-09-20', p_rest);
$$;
grant execute on function pg_temp.inputs(boolean) to authenticated;

select ok(not has_function_privilege('anon', 'private.project_category_months_lean(uuid[], integer, date)', 'execute'),
  'anon cannot call the lean read');
select ok(to_regprocedure('public.company_next_month_inputs(date)') is null
    and has_function_privilege('authenticated', 'public.company_next_month_inputs(date, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.company_next_month_inputs(date, boolean)', 'execute'),
  'company_next_month_inputs(date, boolean) replaces the one-argument form; clients but not anon call it');

select tests.authenticate_as('nml_owner');

select is(pg_temp.lean(array['house', 'shop', 'yard']), pg_temp.many(array['house', 'shop', 'yard']),
  'every project''s lean rows are the page''s rows (id, name, currency, months_minor), in the same order');
select is((select x->'months_minor' from jsonb_array_elements(pg_temp.lean(array['house'])->pg_temp.id('house')::text) x where x->>'name' = 'Electricity'),
  '[0, 0, 0, 0, 12000, 16000]'::jsonb, 'the house''s electricity: July, and August with its part of the split line');
select is((select x->'months_minor' from jsonb_array_elements(pg_temp.lean(array['shop'])->pg_temp.id('shop')::text) x where x->>'name' = 'Paint'),
  '[0, 0, 0, 0, 8000, 4000]'::jsonb, 'the shop''s paint: its 40% of the shared line in July and its part of the split line in August');
select ok(not (pg_temp.lean(array['house', 'shop', 'yard']) ? pg_temp.id('yard')::text), 'a project with no lines has no row');
select ok(pg_temp.keys(pg_temp.lean(array['house'])->pg_temp.id('house')::text), 'a lean row has exactly four fields');
select is(pg_temp.lean(array['other_house']), '{}'::jsonb, 'another company''s project reads nothing');

select ok(
  -- A project with no lines has an empty list (yard), which has no fields to check.
  (select bool_and(jsonb_array_length(x->'categories') = 0 or pg_temp.keys(x->'categories')) and count(*) = 3
    from jsonb_array_elements(pg_temp.inputs()->'projects') x),
  'company_next_month_inputs gives every project''s categories as the four fields');
select is(
  (select x->'categories' from jsonb_array_elements(pg_temp.inputs()->'projects') x where (x->>'project_id')::uuid = pg_temp.id('house')),
  pg_temp.four(public.project_category_months(pg_temp.id('house'), 6, '2026-09-20')->'categories'),
  'a project''s categories are its page''s, as the four fields');
select ok(
  (select bool_and((select array_agg(k order by k) from jsonb_object_keys(c) k) =
     array['currency', 'expected_minor', 'flag', 'group_name', 'id', 'months_minor', 'months_seen', 'name', 'parent_id', 'this_month_minor', 'typical_day'])
   from jsonb_array_elements(public.project_category_months(pg_temp.id('house'), 6, '2026-09-20')->'categories') c),
  'the project page still reads every field of a category');

select ok(not (pg_temp.inputs(false) ? 'rest_edits'), 'p_rest false leaves rest_edits out');
select ok(pg_temp.inputs() ? 'rest_edits' and pg_temp.inputs(true) ? 'rest_edits', 'by default, and with p_rest true, rest_edits is there');
select is(pg_temp.inputs(false)->'edits', pg_temp.inputs()->'edits', 'next month''s edits are the same either way');
select is(pg_temp.inputs(false), pg_temp.inputs() - 'rest_edits' - 'skips', 'without rest_edits and skips (FLOW-1195) it is the full answer, field for field');
select is((select array_agg(x->>'row_key' order by x->>'row_key') from jsonb_array_elements(pg_temp.inputs()->'rest_edits') x),
  array['avg:x', 'avg:y'], 'and rest_edits holds the October and December edits');

select tests.authenticate_as('nml_nobody');
select is(pg_temp.lean(array['house', 'shop']), '{}'::jsonb, 'a user with no company reads nothing');

select * from finish();
rollback;
