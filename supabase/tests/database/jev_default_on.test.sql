-- pgTAP for 20261021072919_jev_default_on.sql (FLOW-940, decision 0204): a company made with
-- create_company starts with Jev on, auto, 0.90. A company that did not come through it (made before
-- the migration, here a direct insert like the old rows) keeps no row and stays off.

begin;

select plan(18);

select tests.create_supabase_user('jdo_owner', 'jdo-owner@example.com');
select tests.create_supabase_user('jdo_old', 'jdo-old@example.com');
select tests.create_supabase_user('jdo_viewer', 'jdo-viewer@example.com');

-- A company that predates the migration: no jev row, or a row the owner saved before.
create function pg_temp.cid(p_name text) returns uuid language sql as
  $$select id from public.companies where name = p_name$$;
select tests.fixture_company('jdo_old', 'עסק ישן');
insert into public.company_integrations (company_id, provider, enabled, mode, threshold)
values (tests.fixture_company('jdo_old', 'עסק ישן בצל'), 'jev', false, 'shadow', 0.85);

select tests.authenticate_as('jdo_owner');
select lives_ok($$select public.create_company('עסק חדש', true)$$, 'the owner creates a company');
reset role;

select results_eq(
  $$select enabled, mode, threshold, daily_call_cap from public.company_integrations
    where company_id = pg_temp.cid('עסק חדש') and provider = 'jev'$$,
  $$values (true, 'auto'::text, 0.90::numeric, 200)$$,
  'a new company has Jev on, auto, 0.90, the default daily cap'
);
select is(
  (select count(*)::int from public.company_integrations where company_id = pg_temp.cid('עסק חדש')),
  1,
  'one integration row, jev only'
);
select tests.authenticate_as('jdo_owner');
select is(
  (public.set_company_integration(false, 'off', null) ->> 'enabled')::boolean,
  false,
  'the owner can still turn the new company''s Jev off'
);
reset role;
select results_eq(
  $$select enabled, mode, threshold from public.company_integrations where company_id = pg_temp.cid('עסק חדש')$$,
  $$values (false, 'off'::text, 0.90::numeric)$$,
  'off keeps the threshold'
);
select tests.authenticate_as('jdo_owner');
select is(
  (public.set_company_integration(true, 'shadow', 0.80) ->> 'mode'),
  'shadow',
  'and can move it to shadow'
);

-- A second company of the same owner gets its own row; the first keeps the owner's choice.
select tests.authenticate_as('jdo_owner');
select lives_ok($$select public.create_company('עסק שני', true)$$, 'the owner creates a second company');
reset role;
select results_eq(
  $$select enabled, mode, threshold from public.company_integrations where company_id = pg_temp.cid('עסק שני')$$,
  $$values (true, 'auto'::text, 0.90::numeric)$$,
  'a second new company also starts on, auto, 0.90'
);
select results_eq(
  $$select enabled, mode, threshold from public.company_integrations where company_id = pg_temp.cid('עסק חדש')$$,
  $$values (true, 'shadow'::text, 0.80::numeric)$$,
  'creating another company does not touch the first one''s row'
);

-- A refused create writes nothing.
select tests.authenticate_as('jdo_owner');
select throws_ok(
  $$select public.create_company('עסק שני', true)$$,
  'P0001', 'company already exists', 'the same name twice is still refused'
);
reset role;
select is(
  (select count(*)::int from public.company_integrations i
   join public.companies c on c.id = i.company_id
   where c.owner_id = tests.get_supabase_uid('jdo_owner')),
  2,
  'the refused create left no extra row'
);

-- Companies made before the migration are unchanged.
select is(
  (select count(*)::int from public.company_integrations where company_id = pg_temp.cid('עסק ישן')),
  0,
  'a company with no row keeps no row (off)'
);
select results_eq(
  $$select enabled, mode, threshold from public.company_integrations where company_id = pg_temp.cid('עסק ישן בצל')$$,
  $$values (false, 'shadow'::text, 0.85::numeric)$$,
  'a company''s saved row keeps its values'
);

-- The column defaults and the member write's fallbacks are unchanged.
select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'company_integrations' and column_name = 'enabled'),
  'false',
  'enabled still defaults to false for any other insert'
);
select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'company_integrations' and column_name = 'mode'),
  '''shadow''::text',
  'mode still defaults to shadow for any other insert'
);

-- Privileges are unchanged: authenticated and service_role execute, anon does not; still definer.
select ok(
  has_function_privilege('authenticated', 'public.create_company(text, boolean)', 'execute')
  and has_function_privilege('service_role', 'public.create_company(text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.create_company(text, boolean)', 'execute'),
  'create_company: authenticated and service_role execute, anon cannot'
);
select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""']
   from pg_proc p where p.oid = 'public.create_company(text, boolean)'::regprocedure),
  'create_company is still security definer with an empty search_path'
);

-- A viewer still cannot create a company, so no row appears for them.
insert into public.company_viewers (company_id, user_id)
select tests.fixture_company('jdo_old', 'עסק דמו', true), tests.get_supabase_uid('jdo_viewer');
select tests.authenticate_as('jdo_viewer');
select throws_ok(
  $$select public.create_company('עסק צופה', true)$$,
  '42501', 'forbidden', 'a viewer is still refused'
);

select * from finish();
rollback;
