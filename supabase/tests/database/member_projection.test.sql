-- FLOW-1126: the forecast's inputs (get_member_projection_inputs) and the setting's projection part.
-- Invented names and figures only; amounts are cents. Dates are relative to today, so the last 12 full months
-- hold the lines whatever the day.

begin;

select plan(16);

do $users$
begin
  perform tests.create_supabase_user('mpj_owner', 'mpj-owner@example.com');
  perform tests.create_supabase_user('mpj_viewer', 'mpj-viewer@example.com');
  perform tests.create_supabase_user('mpj_other', 'mpj-other@example.com');
end
$users$;

create temp table mpj (label text primary key, id uuid);
grant all on mpj to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.mpj where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- The first day of the month `n` months before this one.
create or replace function pg_temp.month_ago(n integer)
returns date
language sql
as $$ select (date_trunc('month', current_date) - make_interval(months => n))::date; $$;
grant execute on function pg_temp.month_ago(integer) to authenticated, service_role;

insert into mpj (label, id) values ('co', tests.fixture_company('mpj_owner', 'Example Forecast LLC', true));
insert into mpj (label, id) values ('other_co', tests.fixture_company('mpj_other', 'Example Other Forecast LLC'));
insert into mpj (label, id) values
  ('birch', tests.fixture_project(pg_temp.id('co'), 'Example Birch')),
  ('rent', tests.fixture_category(pg_temp.id('co'), 'Rent', 'income')),
  ('tax', tests.fixture_category(pg_temp.id('co'), 'Property tax')),
  ('ins', tests.fixture_category(pg_temp.id('co'), 'Insurance')),
  ('other_cat', tests.fixture_category(pg_temp.id('other_co'), 'Other company tax'));
update public.projects set investment_currency = 'USD', value_minor = 42000000, value_date = '2026-11-01', units = 2
where id = pg_temp.id('birch');
insert into public.company_viewers (user_id, company_id) values (tests.get_supabase_uid('mpj_viewer'), pg_temp.id('co'));

-- Rent of $3,100 in each of the last four full months, but only $1,550 last month (a late payment):
-- the scheduled rent is the median of the last three, $3,100.
select tests.fixture_line(pg_temp.id('co'), 'mpj:rent' || n, case when n = 1 then 155000 else 310000 end, 'income',
  pg_temp.id('birch'), pg_temp.id('rent'), pg_temp.month_ago(n) + 4, 'USD')
from generate_series(1, 4) n;
-- Tax $290 a month for the last four months and insurance $1,920 once: the costs of the last 12 months.
select tests.fixture_line(pg_temp.id('co'), 'mpj:tax' || n, 29000, 'expense', pg_temp.id('birch'), pg_temp.id('tax'),
  pg_temp.month_ago(n) + 9, 'USD')
from generate_series(1, 4) n;
select tests.fixture_line(pg_temp.id('co'), 'mpj:ins', 192000, 'expense', pg_temp.id('birch'), pg_temp.id('ins'),
  pg_temp.month_ago(2) + 12, 'USD');
-- This month's tax is not in a full month yet.
select tests.fixture_line(pg_temp.id('co'), 'mpj:tax-now', 29000, 'expense', pg_temp.id('birch'), pg_temp.id('tax'),
  date_trunc('month', current_date)::date, 'USD');

insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency, project_id)
values (pg_temp.id('co'), 'Birch mortgage', 26800000, 65000, 360, '2026-10-01', 219394, 50000, 'USD', pg_temp.id('birch'));
insert into public.loan_rates (company_id, loan_id, effective_date, annual_rate_ppm)
select pg_temp.id('co'), id, '2031-10-01', 70000 from public.loans where name = 'Birch mortgage';

create or replace function pg_temp.input()
returns jsonb
language sql
as $$ select p from jsonb_array_elements(public.get_member_projection_inputs()->'properties') p limit 1; $$;
grant execute on function pg_temp.input() to authenticated, service_role;

select tests.authenticate_as('mpj_owner');

select is((public.get_member_projection_inputs()->>'as_of')::date, (date_trunc('month', current_date) - interval '1 day')::date,
  'the window ends with the last full month');
select is((pg_temp.input()->>'rent_minor')::bigint, 310000::bigint, 'the scheduled rent is the median of the last three full months');
select is((pg_temp.input()->>'rented_months')::integer, 4, 'four months since the first rent');
select is((public.get_member_projection_inputs()->>'today')::date, (now() at time zone 'Asia/Jerusalem')::date, 'and the date the balances are at');
select is((pg_temp.input()->>'units')::integer, 2, 'the units');
select is(
  (select jsonb_object_agg(c->>'name', (c->>'amount_minor')::bigint) from jsonb_array_elements(pg_temp.input()->'costs') c),
  '{"Property tax": 116000, "Insurance": 192000}'::jsonb,
  'the last 12 full months of costs by category, positive, without this month');
select is(
  (select l - 'loan_id' from jsonb_array_elements(pg_temp.input()->'loans') l),
  jsonb_build_object('kind', 'amortizing', 'currency', 'USD', 'principal_minor', 26800000, 'annual_rate_ppm', 65000,
    'term_months', 360, 'start_date', '2026-10-01', 'payment_minor', 219394, 'interest_only_months', null,
    'amortization_months', null, 'balance_minor', 26800000,
    'rates', '[{"effective_date": "2031-10-01", "annual_rate_ppm": 70000}]'::jsonb),
  'each open loan''s terms and rate changes, for its schedule');

-- The projection part.
select is(public.set_member_report(format('{"projection": {"rent_growth_bp": 300, "insurance_growth_bp": 500, "stay_months": 24, "empty_months_tenths": 10, "turnover_cost_minor": 200000, "rate_ppm": null, "years": 10, "by_year": {"rent": {"2": 500}}, "category_types": {"%s": "tax"}}}',
  pg_temp.id('tax'))::jsonb)->'config'->'projection'->'by_year', '{"rent": {"2": 500}}'::jsonb, 'the owner saves the forecast''s assumptions');
select throws_ok($$select public.set_member_report('{"projection": {"rent_growth_bp": 4000}}')$$, 'P0001', 'validation',
  'a change over 30% a year is refused');
select throws_ok($$select public.set_member_report('{"projection": {"by_year": {"rent": {"11": 100}}}}')$$, 'P0001', 'validation',
  'a year after the tenth is refused');
select throws_ok($$select public.set_member_report('{"projection": {"by_year": {"water": {"2": 100}}}}')$$, 'P0001', 'validation',
  'an unknown series is refused');
select throws_ok(format($$select public.set_member_report('{"projection": {"category_types": {"%s": "tax"}}}')$$, pg_temp.id('other_cat')),
  'P0001', 'validation', 'another company''s category is refused');
select throws_ok($$select public.set_member_report('{"projection": {"colour": 1}}')$$, 'P0001', 'validation', 'an unknown key is refused');
-- A category deleted since never locks the setting.
reset role;
delete from public.categories where id = pg_temp.id('tax');
select tests.authenticate_as('mpj_owner');
select is(public.set_member_report('{"rate_rule": {"tenor_years": 10, "spread_bp": 200}}')->'config'->'rate_rule'->>'spread_bp', '200',
  'after a typed category is deleted, another part still saves');

select tests.authenticate_as('mpj_viewer');
select is((pg_temp.input()->>'rent_minor')::bigint, 310000::bigint, 'a viewer reads the inputs');
select tests.authenticate_as('mpj_other');
select is(jsonb_array_length(public.get_member_projection_inputs()->'properties'), 0, 'another company sees none of them');

select * from finish();
rollback;
