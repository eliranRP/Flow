-- FLOW-1195 (20261114090214): company_next_month_inputs with p_rest (the year and since-start views) carries the
-- forecast items taken out of each month, so the app reads them once with the answer, not
-- forecast_overrides_for once per month left.
-- - skips is an object by month (next month to the forecast's last, 12 months), each the moved_out item keys in
--   item_key order; a month with none has no key. For every month it equals what forecast_overrides_for(month)
--   gives for its moved_out rows, in its order.
-- - An item changed only (an amount or a day), this month's rows, rows past the horizon and another company's
--   are not in it. Without p_rest the answer has neither rest_edits nor skips, and is the full one less both.
-- "Today" is 2026-11-06, so the forecast runs from December 2026 to November 2027. Invented data only.

begin;

select plan(11);

do $users$
begin
  perform tests.create_supabase_user('ys_owner', 'ys-owner@example.com');
  perform tests.create_supabase_user('ys_other', 'ys-other@example.com');
  perform tests.create_supabase_user('ys_empty', 'ys-empty@example.com');
end
$users$;

create temp table ys (label text primary key, id uuid);
grant all on ys to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.ys where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into ys (label, id) values ('co', tests.fixture_company('ys_owner', 'Example Skips LLC'));
insert into ys (label, id) values ('other_co', tests.fixture_company('ys_other', 'Example Other Skips LLC'));
insert into ys (label, id) values ('empty_co', tests.fixture_company('ys_empty', 'Example Empty Skips LLC'));

-- Overrides: December has two skips (inserted out of key order) and an amount-only change; March 2027 one skip;
-- January 2027 an amount change only; this month and the month past the horizon each a skip; the other company's
-- December skip.
insert into public.forecast_overrides (company_id, month, item_key, amount_minor, due_on, moved_out) values
  (pg_temp.id('co'), '2026-12', 'party:expense:power:ILS', null, null, true),
  (pg_temp.id('co'), '2026-12', 'party:expense:hoa:ILS', null, null, true),
  (pg_temp.id('co'), '2026-12', 'party:income:rent:ILS', 90000, null, false),
  (pg_temp.id('co'), '2027-03', 'party:expense:tax:ILS:none', null, null, true),
  (pg_temp.id('co'), '2027-01', 'party:expense:power:ILS', 12000, '2027-01-20', false),
  (pg_temp.id('co'), '2026-11', 'party:expense:this-month:ILS', null, null, true),
  (pg_temp.id('co'), '2027-12', 'party:expense:too-far:ILS', null, null, true),
  (pg_temp.id('other_co'), '2026-12', 'party:expense:other:ILS', null, null, true);

create function pg_temp.inputs(p_rest boolean default true) returns jsonb language sql stable as $$
  select public.company_next_month_inputs('2026-11-06', p_rest);
$$;
grant execute on function pg_temp.inputs(boolean) to authenticated;

-- The skips of a month as forecast_overrides_for gives them: its moved_out rows' keys, in its order.
create function pg_temp.old_skips(p_month text) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(o->>'item_key' order by ord) filter (where (o->>'moved_out')::boolean), '[]'::jsonb)
  from jsonb_array_elements(public.forecast_overrides_for(p_month)) with ordinality t(o, ord);
$$;
grant execute on function pg_temp.old_skips(text) to authenticated;

select tests.authenticate_as('ys_owner');

select is(pg_temp.inputs()->'skips',
  '{"2026-12": ["party:expense:hoa:ILS", "party:expense:power:ILS"], "2027-03": ["party:expense:tax:ILS:none"]}'::jsonb,
  'skips: the moved-out items of each month with one, in item_key order; no key for a month with none');
select is(
  (select jsonb_agg(coalesce(pg_temp.inputs()->'skips'->m, '[]'::jsonb) order by m)
   from (select to_char(d, 'YYYY-MM') m from generate_series('2026-12-01'::date, '2027-11-01', interval '1 month') d) months),
  (select jsonb_agg(pg_temp.old_skips(m) order by m)
   from (select to_char(d, 'YYYY-MM') m from generate_series('2026-12-01'::date, '2027-11-01', interval '1 month') d) months),
  'for each of the 12 months of the forecast, the skips equal forecast_overrides_for''s moved_out rows');
select is(pg_temp.inputs()->'skips'->'2026-12', pg_temp.old_skips('2026-12'), 'next month: the same keys in the same order');
select ok(not (pg_temp.inputs()->'skips' ? '2027-01'), 'an item changed in amount and day only is not a skip: January has no key');
select ok(not (pg_temp.inputs()->'skips' ?| array['2026-11', '2027-12']), 'this month''s and the month past the horizon''s are not in it');
select ok(public.forecast_overrides_for('2027-12') <> '[]'::jsonb and public.forecast_overrides_for('2026-11') <> '[]'::jsonb,
  'though forecast_overrides_for still reads both (the pages of those months)');
select is(pg_temp.inputs(true), public.company_next_month_inputs('2026-11-06'), 'p_rest true is the default answer');

select ok(not (pg_temp.inputs(false) ?| array['rest_edits', 'skips']), 'p_rest false leaves out rest_edits and skips');
select is(pg_temp.inputs(false), pg_temp.inputs() - 'rest_edits' - 'skips', 'and is the full answer less those two, field for field');

select tests.authenticate_as('ys_other');
select is(pg_temp.inputs()->'skips', '{"2026-12": ["party:expense:other:ILS"]}'::jsonb, 'another company reads only its own skips');

select tests.authenticate_as('ys_empty');
select is(pg_temp.inputs()->'skips', '{}'::jsonb, 'a company with none has an empty object');

select * from finish();
rollback;
