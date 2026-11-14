-- FLOW-854: clients write loans, loan_rates, project_groups and setup_states only through
-- functions. authenticated keeps SELECT and holds no INSERT, UPDATE or DELETE on them; the app's
-- writes go through create_loan, update_loan, save_loan_rate, delete_loan_rate and
-- save_setup_state, which write for the caller's own company (owner or editor), refuse a viewer
-- and another company's row, and keep the tables' checks and triggers.
-- Invented names, ids and @example.com emails only. Amounts are cents.

begin;

select plan(44);

do $users$
begin
  perform tests.create_supabase_user('cw_owner', 'cw-owner@example.com');
  perform tests.create_supabase_user('cw_editor', 'cw-editor@example.com');
  perform tests.create_supabase_user('cw_viewer', 'cw-viewer@example.com');
  perform tests.create_supabase_user('cw_other', 'cw-other@example.com');
end
$users$;

create temp table cw (label text primary key, id uuid);
grant all on cw to authenticated;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
stable
as $$ select id from pg_temp.cw where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated;

insert into cw (label, id) values
  ('co', tests.fixture_company('cw_owner', 'Example Writes Co')),
  ('other_co', tests.fixture_company('cw_other', 'Example Other Writes Co'));
insert into public.company_members (company_id, user_id, role) values
  (pg_temp.id('co'), tests.get_supabase_uid('cw_editor'), 'editor'),
  (pg_temp.id('co'), tests.get_supabase_uid('cw_viewer'), 'viewer');

-- One loan in each company, and a rate row on the other company's loan, written as postgres.
with made as (
  insert into public.loans (
    company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency
  )
  values
    (pg_temp.id('co'), 'Example Writes Mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 0, 'USD'),
    (pg_temp.id('other_co'), 'Example Other Mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 0, 'USD')
  returning id, company_id
)
insert into cw (label, id)
select case when m.company_id = pg_temp.id('co') then 'loan' else 'other_loan' end, m.id from made m;
insert into cw (label, id)
select 'other_rate', r.id from (
  insert into public.loan_rates (company_id, loan_id, effective_date, annual_rate_ppm)
  values (pg_temp.id('other_co'), pg_temp.id('other_loan'), '2026-03-01', 55000)
  returning id
) r;

-- 1-4. The grants: SELECT stays, no direct write is left.
select ok(
  has_table_privilege('authenticated', 'public.loans', 'select')
  and has_table_privilege('authenticated', 'public.loan_rates', 'select')
  and has_table_privilege('authenticated', 'public.project_groups', 'select')
  and has_table_privilege('authenticated', 'public.setup_states', 'select'),
  'authenticated still reads the four tables'
);
select is(
  (select coalesce(array_agg(t.rel || ':' || p.priv order by t.rel, p.priv), '{}')
   from (values ('public.loans'), ('public.loan_rates'), ('public.project_groups'), ('public.setup_states')) t(rel)
   cross join (values ('insert'), ('update')) p(priv)
   where has_table_privilege('authenticated', t.rel, p.priv)),
  '{}'::text[],
  'authenticated holds no INSERT or UPDATE on loans, loan_rates, project_groups or setup_states'
);
select is(
  (select coalesce(array_agg(t.rel order by t.rel), '{}')
   from (values ('public.loans'), ('public.loan_rates'), ('public.project_groups'), ('public.setup_states')) t(rel)
   where has_table_privilege('authenticated', t.rel, 'delete')),
  '{}'::text[],
  'nor DELETE on any of them'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public'
     and tablename in ('loans', 'loan_rates', 'project_groups', 'setup_states')
     and cmd <> 'SELECT'),
  0,
  'and no write policy is left on them'
);

-- 5-6. Each RPC is a definer that authenticated may run and anon may not.
select is(
  (select coalesce(array_agg(f.sig order by f.sig), '{}')
   from (values
     ('public.create_loan(uuid, jsonb)'),
     ('public.update_loan(uuid, jsonb)'),
     ('public.save_loan_rate(uuid, date, integer, uuid)'),
     ('public.delete_loan_rate(uuid)'),
     ('public.save_setup_state(uuid, jsonb)')
   ) f(sig)
   where not (select p.prosecdef from pg_proc p where p.oid = f.sig::regprocedure)
      or not has_function_privilege('authenticated', f.sig::regprocedure, 'execute')
      or has_function_privilege('anon', f.sig::regprocedure, 'execute')),
  '{}'::text[],
  'the five RPCs are security definers that authenticated, not anon, may execute'
);
select ok(
  (select bool_and(p.proconfig @> array['search_path=""'])
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('create_loan', 'update_loan', 'save_loan_rate', 'delete_loan_rate', 'save_setup_state')),
  'each one runs with an empty search_path'
);

-- 7-8. A direct write by the owner is refused at the grant.
select tests.authenticate_as('cw_owner');
select throws_ok(
  format($$insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date,
      payment_minor, escrow_minor, currency) values (%L, 'Example Direct Loan', 1000000, 60000, 120, '2026-01-01', 20000, 0, 'USD')$$,
    pg_temp.id('co')),
  '42501', null, 'the owner cannot insert a loan directly'
);
select throws_ok(
  format($$update public.loans set escrow_minor = 10 where id = %L$$, pg_temp.id('loan')),
  '42501', null, 'nor update one directly'
);
reset role;

-- 9-15. create_loan.
select tests.authenticate_as('cw_owner');
insert into cw (label, id)
select 'new_loan', public.create_loan(pg_temp.id('co'), jsonb_build_object(
  'name', 'Example Form Loan', 'principal_minor', 1000000, 'annual_rate_ppm', 60000, 'term_months', 120,
  'start_date', '2026-01-01', 'payment_minor', 20000, 'escrow_minor', 0, 'currency', 'USD', 'kind', 'amortizing',
  'interest_only_months', null, 'amortization_months', null, 'project_id', null));
reset role;
select is(
  (select l.company_id::text || ':' || l.name || ':' || l.kind::text || ':' || l.status::text
   from public.loans l where l.id = pg_temp.id('new_loan')),
  pg_temp.id('co')::text || ':Example Form Loan:amortizing:open',
  'the owner adds a loan to their company'
);
select tests.authenticate_as('cw_editor');
select isnt(
  public.create_loan(pg_temp.id('co'), jsonb_build_object(
    'name', 'Example Editor Loan', 'principal_minor', 1000000, 'annual_rate_ppm', 0, 'term_months', 12,
    'start_date', '2026-02-01', 'payment_minor', 90000, 'escrow_minor', 0, 'currency', 'USD')),
  null,
  'an editor adds one, the kind left to its default'
);
reset role;
select tests.authenticate_as('cw_viewer');
select throws_ok(
  format($$select public.create_loan(%L, %L::jsonb)$$, pg_temp.id('co'),
    '{"name": "Example Viewer Loan", "principal_minor": 1000000, "annual_rate_ppm": 0, "term_months": 12, "start_date": "2026-02-01", "payment_minor": 90000, "escrow_minor": 0, "currency": "USD"}'),
  '42501', 'forbidden', 'a viewer cannot add a loan'
);
reset role;
select tests.authenticate_as('cw_owner');
select throws_ok(
  format($$select public.create_loan(%L, %L::jsonb)$$, pg_temp.id('other_co'),
    '{"name": "Example Stray Loan", "principal_minor": 1000000, "annual_rate_ppm": 0, "term_months": 12, "start_date": "2026-02-01", "payment_minor": 90000, "escrow_minor": 0, "currency": "USD"}'),
  '42501', 'forbidden', 'nor can the owner add one to another company'
);
select throws_ok(
  format($$select public.create_loan(%L, %L::jsonb)$$, pg_temp.id('co'),
    '{"name": "Example Sorted Loan", "principal_minor": 1000000, "annual_rate_ppm": 0, "term_months": 12, "start_date": "2026-02-01", "payment_minor": 90000, "escrow_minor": 0, "currency": "USD", "sort_order": 1}'),
  '22023', 'validation', 'a column outside the form''s fields is refused'
);
select throws_ok(
  format($$select public.create_loan(%L, %L::jsonb)$$, pg_temp.id('co'),
    '{"name": "Example Low Loan", "principal_minor": 12000000, "annual_rate_ppm": 60000, "term_months": 360, "start_date": "2026-01-01", "payment_minor": 50000, "escrow_minor": 0, "currency": "USD"}'),
  '23514', 'loan_payment_below_interest', 'the table''s checks still hold: a payment below the interest is refused'
);
reset role;
select is(
  (select count(*)::integer from public.loans where company_id = pg_temp.id('other_co')),
  1,
  'the other company still has only its own loan'
);

-- 16-23. update_loan.
select tests.authenticate_as('cw_owner');
select is(
  public.update_loan(pg_temp.id('loan'), '{"escrow_minor": 2500, "project_id": null}'::jsonb),
  pg_temp.id('loan'),
  'the owner updates their loan and gets its id back'
);
reset role;
select is(
  (select escrow_minor from public.loans where id = pg_temp.id('loan')),
  2500::bigint,
  'the patch is stored'
);
select tests.authenticate_as('cw_editor');
select lives_ok(
  format($$select public.update_loan(%L, '{"term_months": 300}'::jsonb)$$, pg_temp.id('loan')),
  'an editor updates the loan'
);
reset role;
select is(
  (select status::text || ':' || term_months::text || ':' || escrow_minor::text from public.loans where id = pg_temp.id('loan')),
  'open:300:2500',
  'which stores the term and leaves the rest'
);
select tests.authenticate_as('cw_viewer');
select throws_ok(
  format($$select public.update_loan(%L, '{"escrow_minor": 0}'::jsonb)$$, pg_temp.id('loan')),
  '42501', 'forbidden', 'a viewer cannot update the loan'
);
reset role;
select tests.authenticate_as('cw_owner');
select throws_ok(
  format($$select public.update_loan(%L, '{"escrow_minor": 0}'::jsonb)$$, pg_temp.id('other_loan')),
  '42501', 'forbidden', 'nor can the owner update another company''s loan'
);
select throws_ok(
  format($$select public.update_loan(%L, '{"name": "Example Renamed"}'::jsonb)$$, pg_temp.id('loan')),
  '22023', 'validation', 'a column the app does not patch is refused'
);
select throws_ok(
  format($$select public.update_loan(%L, '{"status": "paid_off"}'::jsonb)$$, pg_temp.id('loan')),
  '23514', null, 'the table''s checks still hold: a loan is not closed without a date'
);
reset role;

-- 24-32. save_loan_rate.
select tests.authenticate_as('cw_owner');
insert into cw (label, id) select 'rate', public.save_loan_rate(pg_temp.id('loan'), '2026-06-01', 65000);
select is(
  public.save_loan_rate(pg_temp.id('loan'), '2026-06-01', 66000),
  pg_temp.id('rate'),
  'a second rate on the same day replaces the first'
);
reset role;
select is(
  (select string_agg(effective_date::text || ':' || annual_rate_ppm::text, ',') from public.loan_rates
   where loan_id = pg_temp.id('loan')),
  '2026-06-01:66000',
  'the owner adds a rate row, one per day'
);
select tests.authenticate_as('cw_editor');
select is(
  public.save_loan_rate(pg_temp.id('loan'), '2026-07-01', 67000, pg_temp.id('rate')),
  pg_temp.id('rate'),
  'an editor changes the row by its id'
);
reset role;
select is(
  (select effective_date::text || ':' || annual_rate_ppm::text from public.loan_rates where id = pg_temp.id('rate')),
  '2026-07-01:67000',
  'which stores the new day and rate'
);
select tests.authenticate_as('cw_viewer');
select throws_ok(
  format($$select public.save_loan_rate(%L, '2026-08-01', 1)$$, pg_temp.id('loan')),
  '42501', 'forbidden', 'a viewer cannot add a rate'
);
reset role;
select tests.authenticate_as('cw_owner');
select throws_ok(
  format($$select public.save_loan_rate(%L, '2026-08-01', 1)$$, pg_temp.id('other_loan')),
  '42501', 'forbidden', 'nor can the owner add one to another company''s loan'
);
select throws_ok(
  format($$select public.save_loan_rate(%L, '2026-08-01', 1, %L)$$, pg_temp.id('loan'), pg_temp.id('other_rate')),
  '42501', 'forbidden', 'nor change another company''s rate row through their own loan'
);
select throws_ok(
  format($$select public.save_loan_rate(%L, '2025-12-31', 50000)$$, pg_temp.id('loan')),
  '23514', 'rate before the loan start', 'the table''s checks still hold: no rate before the loan start'
);
reset role;
select is(
  (select annual_rate_ppm from public.loan_rates where id = pg_temp.id('other_rate')),
  55000,
  'the other company''s rate row is unchanged'
);

-- 33-36. delete_loan_rate.
select tests.authenticate_as('cw_viewer');
select throws_ok(
  format($$select public.delete_loan_rate(%L)$$, pg_temp.id('rate')),
  '42501', 'forbidden', 'a viewer cannot remove a rate'
);
reset role;
select tests.authenticate_as('cw_owner');
select throws_ok(
  format($$select public.delete_loan_rate(%L)$$, pg_temp.id('other_rate')),
  '42501', 'forbidden', 'nor can the owner remove another company''s'
);
select is(public.delete_loan_rate(pg_temp.id('rate')), pg_temp.id('rate'), 'the owner removes their rate row');
reset role;
select is(
  (select count(*)::integer from public.loan_rates where id in (pg_temp.id('rate'), pg_temp.id('other_rate'))),
  1,
  'only the owner''s row is gone'
);

-- 37-42. save_setup_state.
select tests.authenticate_as('cw_owner');
select lives_ok(
  format($$select public.save_setup_state(%L, '{"run_started_at": "2026-10-01T00:00:00.000Z"}'::jsonb)$$, pg_temp.id('co')),
  'the owner saves their setup flags'
);
select lives_ok(
  format($$select public.save_setup_state(%L, '{"card_dismissed_at": "2026-10-02T00:00:00.000Z"}'::jsonb)$$, pg_temp.id('co')),
  'and saves them again'
);
reset role;
select is(
  (select string_agg(state::text, ',') from public.setup_states
   where company_id = pg_temp.id('co') and user_id = tests.get_supabase_uid('cw_owner')),
  '{"card_dismissed_at": "2026-10-02T00:00:00.000Z"}',
  'one row per user and company, the last write winning'
);
select tests.authenticate_as('cw_editor');
select lives_ok(
  format($$select public.save_setup_state(%L, '{}'::jsonb)$$, pg_temp.id('co')),
  'an editor saves their own row'
);
reset role;
select tests.authenticate_as('cw_viewer');
select throws_ok(
  format($$select public.save_setup_state(%L, '{}'::jsonb)$$, pg_temp.id('co')),
  '42501', 'forbidden', 'a viewer cannot save setup flags'
);
reset role;
select tests.authenticate_as('cw_owner');
select throws_ok(
  format($$select public.save_setup_state(%L, '{}'::jsonb)$$, pg_temp.id('other_co')),
  '42501', 'forbidden', 'nor can the owner save them for another company'
);
reset role;

-- 43-44. What the refused calls left.
select is(
  (select count(*)::integer from public.setup_states where company_id = pg_temp.id('other_co')),
  0,
  'no setup row was written for the other company'
);
select is(
  (select string_agg(u.label, ',' order by u.label) from public.setup_states s
   join (values ('cw_owner'), ('cw_editor'), ('cw_viewer')) u(label) on s.user_id = tests.get_supabase_uid(u.label)
   where s.company_id = pg_temp.id('co')),
  'cw_editor,cw_owner',
  'the owner and the editor have a row, the viewer none'
);

select * from finish();
rollback;
