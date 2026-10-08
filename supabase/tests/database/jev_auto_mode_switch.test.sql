-- pgTAP for 20261011230000_jev_auto_mode_switch.sql (FLOW-702): mode auto can be stored.

begin;

select plan(8);

select tests.create_supabase_user('jev_auto_owner');
select tests.authenticate_as('jev_auto_owner');
select lives_ok($$select public.create_company('עסק אוטו', true)$$, 'owner creates a company');

reset role;

select lives_ok(
  $$insert into public.company_integrations (company_id, provider, mode)
    select c.id, 'jev', 'auto'
    from public.companies c
    join auth.users u on u.id = c.owner_id
    where u.email = 'jev_auto_owner@test.flow'$$,
  'mode auto is allowed by the check'
);
select is(
  (select i.mode
    from public.company_integrations i
    join public.companies c on c.id = i.company_id
    join auth.users u on u.id = c.owner_id
    where u.email = 'jev_auto_owner@test.flow'),
  'auto',
  'auto was stored'
);
select throws_ok(
  $$insert into public.company_integrations (company_id, provider, mode)
    select c.id, 'sumit', 'auto'
    from public.companies c
    join auth.users u on u.id = c.owner_id
    where u.email = 'jev_auto_owner@test.flow'$$,
  '23514', null, 'provider is still jev only'
);

select tests.authenticate_as('jev_auto_owner');
select is(
  (public.set_company_integration(true, 'auto', 0.90) ->> 'mode'),
  'auto',
  'the RPC stores auto'
);
select throws_ok(
  $$select public.set_company_integration(true, 'live', null)$$,
  'P0001', 'validation', 'live is still refused'
);
select throws_ok(
  $$select public.set_company_integration(true, 'auto', 0.49)$$,
  'P0001', 'validation', 'a threshold below 0.50 is still refused'
);
select is(
  (select mode from public.company_integrations),
  'auto',
  'a refused threshold leaves auto in place'
);

select * from finish();
rollback;
