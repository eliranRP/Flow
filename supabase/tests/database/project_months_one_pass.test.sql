-- FLOW-977. private.project_category_months_many reads many projects' category months in one pass:
-- each project's categories are exactly project_category_months' (a line shared by two projects is in
-- each at its share), a project with no lines has no row, another company's projects read nothing, and
-- clients outside a company cannot call it. company_next_month_inputs takes its projects from it.
-- Invented data only. "Today" is 2026-09-20, so the complete months are March to August 2026.

begin;

select plan(8);

do $users$
begin
  perform tests.create_supabase_user('pmo_owner', 'pmo-owner@example.com');
  perform tests.create_supabase_user('pmo_other', 'pmo-other@example.com');
end
$users$;

create temp table pmo (label text primary key, id uuid);
grant all on pmo to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.pmo where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into pmo (label, id) values ('co', tests.fixture_company('pmo_owner', 'Example Pass LLC'));
insert into pmo (label, id) values ('other_co', tests.fixture_company('pmo_other', 'Example Other Pass LLC'));
insert into pmo (label, id) values
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
  select tests.fixture_line(pg_temp.id(p_co), 'pmo:' || p_key, p_amount, p_project => pg_temp.id(p_project),
    p_category => pg_temp.id(p_cat), p_doc_date => p_date, p_pnl_role => p_role)
$$;

-- The house: electricity every month from March, and paint in August and this month.
select pg_temp.line('h' || to_char(d, 'MM'), 'elec', 10000 + extract(month from d)::bigint * 100, d::date + 11, 'house')
from generate_series('2026-03-01'::date, '2026-08-01', interval '1 month') d;
select pg_temp.line('hp8', 'paint', 40000, '2026-08-05', 'house');
select pg_temp.line('hp9', 'paint', 9000, '2026-09-02', 'house');
-- A paint line shared 60/40 by the house and the shop.
insert into pmo (label, id) values ('s7', pg_temp.line('s7', 'paint', 20000, '2026-07-14', p_role => 'shared'));
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
values (pg_temp.id('co'), pg_temp.id('s7'), pg_temp.id('house'), 6000, -12000),
  (pg_temp.id('co'), pg_temp.id('s7'), pg_temp.id('shop'), 4000, -8000);
-- The other company's line.
select pg_temp.line('o8', 'other_paint', 30000, '2026-08-03', 'other_house', p_co => 'other_co');

create function pg_temp.many(p_projects text[]) returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(m.project_id, m.categories), '{}'::jsonb)
  from private.project_category_months_many(array(select pg_temp.id(l) from unnest(p_projects) l), 6, '2026-09-20') m;
$$;
grant execute on function pg_temp.many(text[]) to authenticated;

select ok(not has_function_privilege('anon', 'private.project_category_months_many(uuid[], integer, date)', 'execute'),
  'anon cannot call it');

select tests.authenticate_as('pmo_owner');
select is(pg_temp.many(array['house', 'shop', 'yard'])->pg_temp.id('house')::text,
  public.project_category_months(pg_temp.id('house'), 6, '2026-09-20')->'categories',
  'the house''s categories, read with others, are its own page''s');
select is(pg_temp.many(array['house', 'shop', 'yard'])->pg_temp.id('shop')::text,
  public.project_category_months(pg_temp.id('shop'), 6, '2026-09-20')->'categories',
  'the shop''s too');
select is(pg_temp.many(array['house', 'shop', 'yard'])->pg_temp.id('shop')::text->0->'months_minor',
  '[0, 0, 0, 0, 8000, 0]'::jsonb, 'the shop holds its 40% of the shared paint line in July');
select is(pg_temp.many(array['house'])->pg_temp.id('house')::text->0->>'this_month_minor', '9000',
  'this month''s paint first, then electricity');
select ok(not (pg_temp.many(array['house', 'shop', 'yard']) ? pg_temp.id('yard')::text), 'a project with no lines has no row');
select is(
  (select x->'categories' from jsonb_array_elements(public.company_next_month_inputs('2026-09-20')->'projects') x
   where (x->>'project_id')::uuid = pg_temp.id('house')),
  public.project_category_months(pg_temp.id('house'), 6, '2026-09-20')->'categories',
  'company_next_month_inputs takes each project''s categories from the one pass');
select is(pg_temp.many(array['other_house']), '{}'::jsonb, 'another company''s project reads nothing');


select * from finish();
rollback;
