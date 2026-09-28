-- Onboarding and two-tenant isolation for the phase 1 RPCs.

begin;

select plan(12);

create temp table slice_ref (
  label text primary key,
  id uuid
);
grant all on slice_ref to authenticated, service_role;

do $users$
begin
  perform tests.create_supabase_user('slice_a', 'slice-a@test.flow');
  perform tests.create_supabase_user('slice_b', 'slice-b@test.flow');
end
$users$;

select tests.authenticate_as('slice_a');

select lives_ok(
  $$select public.create_company('אלפא שיפוצים', true)$$,
  'an owner can create one company'
);

insert into slice_ref (label, id)
select 'a', id from public.companies;

select throws_ok(
  $$select public.create_company('עסק שני', true)$$,
  'P0001',
  'company already exists',
  'a second company for the same owner is rejected'
);

select lives_ok(
  $$select public.create_manual_entry('expense', 'expense', 11800, '2026-09-01', 'מלט', null, null, false)$$,
  'a manual expense is stored'
);

select is(
  (public.get_dashboard(null, null, 'cash')->>'expense_agorot')::bigint,
  10000::bigint,
  'an assumed 18% expense is net of VAT'
);

select is(
  (public.get_home()->>'net_profit_agorot')::bigint,
  (-10000)::bigint,
  'home cash profit includes the manual expense'
);

select tests.authenticate_as('slice_b');

select lives_ok(
  $$select public.create_company('בית כהן', false)$$,
  'a second owner can create their own company'
);

select is(
  (select count(*)::int from public.transactions),
  0,
  'the second owner cannot see the first company ledger'
);

select is(
  public.get_dashboard(null, null, 'cash')->>'name',
  'בית כהן',
  'the dashboard names the caller company'
);

select throws_ok(
  format(
    'select public.company_pnl(%L::uuid, null, null, ''cash'')',
    (select id from slice_ref where label = 'a')
  ),
  'P0001',
  'forbidden',
  'company_pnl refuses another owner'
);

select tests.clear_authentication();

select throws_ok(
  $$select public.create_company('אורח', true)$$,
  '42501',
  null,
  'anon cannot create a company'
);

select throws_ok(
  $$select public.get_dashboard(null, null, 'cash')$$,
  '42501',
  null,
  'anon cannot read the dashboard'
);

select throws_ok(
  $$select * from public.sumit_refresh_requests$$,
  '42501',
  null,
  'anon cannot read SUMIT refresh requests'
);

select * from finish();

rollback;
