-- FLOW-1119: the Treasury's daily yields. store_treasury_yields (service role only, a fetch keeps a
-- tenor it left empty), reading them, and get_member_report's treasury_yields around the quote dates.
-- Invented names; the yields are public market data shapes.

begin;

select plan(11);

do $users$
begin
  perform tests.create_supabase_user('try_owner', 'try-owner@example.com');
end
$users$;

create temp table try (label text primary key, id uuid);
grant all on try to authenticated, service_role;
insert into try (label, id) values ('co', tests.fixture_company('try_owner', 'Example Yields LLC', true));

create or replace function pg_temp.as_service()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
end;
$$;
grant execute on function pg_temp.as_service() to authenticated, service_role;

select pg_temp.as_service();
select is(public.store_treasury_yields(
  '[{"on_date": "2026-10-20", "y5_ppm": 41000, "y10_ppm": 43500},
    {"on_date": "2026-11-03", "y5_ppm": 41200, "y10_ppm": 43800},
    {"on_date": "2025-01-02", "y5_ppm": 44000, "y10_ppm": 45000}]'), 3, 'the job stores each day');
select is(public.store_treasury_yields('[{"on_date": "2026-11-03", "y5_ppm": 41300, "y10_ppm": null}]'), 1,
  'a newer fetch of a day replaces it');
select is((select array[y5_ppm, y10_ppm] from public.treasury_yields where on_date = '2026-11-03'), array[41300, 43800],
  'and keeps a tenor it left empty');
select throws_ok($$select public.store_treasury_yields('[{"on_date": "2026-02-30", "y5_ppm": 41000}]')$$,
  'P0001', 'validation', 'an impossible date is refused');
select throws_ok($$select public.store_treasury_yields('[{"on_date": "2026-11-04"}]')$$,
  'P0001', 'validation', 'a day with neither yield is refused');
select throws_ok($$select public.store_treasury_yields('{"on_date": "2026-11-04"}')$$,
  'P0001', 'validation', 'rows must be an array');

reset role;
select tests.authenticate_as('try_owner');
select throws_ok($$select public.store_treasury_yields('[{"on_date": "2026-11-04", "y5_ppm": 1}]')$$,
  '42501', null, 'a signed-in user cannot store yields');
select is((select count(*)::integer from public.treasury_yields), 3, 'every signed-in user reads the yields');

-- get_member_report returns the yields from two weeks before the earliest quote date to today.
select is(
  (select coalesce(bool_and((y->>'on_date')::date between current_date - 14 and current_date), true)
   from jsonb_array_elements(public.get_member_report()->'treasury_yields') y),
  true, 'with no quotes, only the last two weeks');
select public.set_member_report(
  '{"quotes": [{"id": "00000000-0000-4000-8000-000000000001", "lender": "Example Lending", "rate_ppm": 62500, "quoted_on": "2026-11-01"}]}');
select is(
  (select jsonb_agg(y->>'on_date' order by y->>'on_date') from jsonb_array_elements(public.get_member_report()->'treasury_yields') y),
  '["2026-10-20", "2026-11-03"]'::jsonb, 'with a quote, from two weeks before it, not the year-old day');
select is(
  (select y from jsonb_array_elements(public.get_member_report()->'treasury_yields') y where y->>'on_date' = '2026-11-03'),
  '{"on_date": "2026-11-03", "y5_ppm": 41300, "y10_ppm": 43800}'::jsonb, 'each day carries its two yields');

select * from finish();
rollback;
