-- FLOW-1202: company_next_month_inputs without p_rest (Company profit's month view, next month's card) carries
-- skips for next month only, the keys forecast_overrides_for(next month) gives for its moved_out rows, so the app
-- sends no forecast_overrides_for beside it. The full answer (p_rest true) is as FLOW-1195 made it.
-- "Today" is 2026-11-06, so next month is 2026-12. Invented data only.

begin;

select plan(9);

do $users$
begin
  perform tests.create_supabase_user('ss_owner', 'ss-owner@example.com');
  perform tests.create_supabase_user('ss_other', 'ss-other@example.com');
end
$users$;

create temp table ss (label text primary key, id uuid);
grant all on ss to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.ss where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into ss (label, id) values ('co', tests.fixture_company('ss_owner', 'Example Slim Skips LLC'));
insert into ss (label, id) values ('other_co', tests.fixture_company('ss_other', 'Example Other Slim LLC'));

-- December (next month): two skips, out of key order, and an amount change; later months and this month: a skip each;
-- the other company's December skip.
insert into public.forecast_overrides (company_id, month, item_key, amount_minor, due_on, moved_out) values
  (pg_temp.id('co'), '2026-12', 'party:expense:power:ILS', null, null, true),
  (pg_temp.id('co'), '2026-12', 'party:expense:hoa:ILS', null, null, true),
  (pg_temp.id('co'), '2026-12', 'party:income:rent:ILS', 90000, null, false),
  (pg_temp.id('co'), '2027-03', 'party:expense:tax:ILS:none', null, null, true),
  (pg_temp.id('co'), '2026-11', 'party:expense:this-month:ILS', null, null, true),
  (pg_temp.id('other_co'), '2026-12', 'party:expense:other:ILS', null, null, true);

create function pg_temp.inputs(p_rest boolean default true) returns jsonb language sql stable as $$
  select public.company_next_month_inputs('2026-11-06', p_rest);
$$;
grant execute on function pg_temp.inputs(boolean) to authenticated;

-- forecast_overrides_for's moved_out keys, in its order.
create function pg_temp.old_skips(p_month text) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(o->>'item_key' order by ord) filter (where (o->>'moved_out')::boolean), '[]'::jsonb)
  from jsonb_array_elements(public.forecast_overrides_for(p_month)) with ordinality t(o, ord);
$$;
grant execute on function pg_temp.old_skips(text) to authenticated;

select tests.authenticate_as('ss_owner');

select is(pg_temp.inputs(false)->'skips', '{"2026-12": ["party:expense:hoa:ILS", "party:expense:power:ILS"]}'::jsonb,
  'the slim answer''s skips are next month''s moved-out keys, in item_key order, under its month');
select is(pg_temp.inputs(false)->'skips'->'2026-12', pg_temp.old_skips('2026-12'),
  'and equal forecast_overrides_for(next month)''s moved_out keys, in its order');
select ok(not (pg_temp.inputs(false)->'skips' ?| array['2026-11', '2027-03']), 'no other month is in it: not this month, not a later one');
select is(pg_temp.inputs(true)->'skips', '{"2026-12": ["party:expense:hoa:ILS", "party:expense:power:ILS"], "2027-03": ["party:expense:tax:ILS:none"]}'::jsonb,
  'the full answer''s skips are unchanged: next month to the horizon');
select is(pg_temp.inputs(false) - 'skips', pg_temp.inputs(true) - 'skips' - 'rest_edits', 'the slim answer is the full one less rest_edits, field for field but the skips');
select ok(not (pg_temp.inputs(false) ? 'rest_edits') and pg_temp.inputs(true) ? 'rest_edits', 'only the full answer has rest_edits');
select is(pg_temp.inputs(true), public.company_next_month_inputs('2026-11-06'), 'p_rest true is still the default answer');

select tests.authenticate_as('ss_other');
select is(pg_temp.inputs(false)->'skips', '{"2026-12": ["party:expense:other:ILS"]}'::jsonb, 'another company reads only its own skips');

reset role;
delete from public.forecast_overrides where company_id = pg_temp.id('co') and month = '2026-12';
select tests.authenticate_as('ss_owner');
select is(pg_temp.inputs(false)->'skips', '{}'::jsonb, 'a next month with no skip has an empty object');

select * from finish();
rollback;
