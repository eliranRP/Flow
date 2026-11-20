-- FLOW-1240: get_project's loans carry the four category ids of the loan's payment parts (the project forecast files
-- interest and escrow by them). Add-only: every other key of a loan is what it was, in both forms (p_lines true and
-- false), a loan with no category has the keys as JSON null, and RLS still limits the project to its company's
-- caller. Invented data only (fixture prefix f1240), @example.com only. Amounts are agorot.

begin;

select plan(14);

do $users$
begin
  perform tests.create_supabase_user('f1240_a', 'f1240a@example.com');
  perform tests.create_supabase_user('f1240_b', 'f1240b@example.com');
end
$users$;

create temp table f1240 (label text primary key, id uuid);
grant all on f1240 to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.f1240 where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- One loan of project one, from the answer with or without the lines.
create function pg_temp.loan(p_lines boolean, p_label text) returns jsonb language sql stable as $$
  select e from jsonb_array_elements(
    public.get_project(pg_temp.id('p1'), 'cash', null, null, p_lines)->'loans') e
  where e->>'id' = pg_temp.id(p_label)::text;
$$;
grant execute on function pg_temp.loan(boolean, text) to authenticated, service_role;

insert into f1240 (label, id) values ('co', tests.fixture_company('f1240_a', 'Example F1240 A LLC'));
insert into f1240 (label, id) values ('co_b', tests.fixture_company('f1240_b', 'Example F1240 B LLC'));
insert into f1240 (label, id) values
  ('p1', tests.fixture_project(pg_temp.id('co'), 'F1240 Site One')),
  ('p2', tests.fixture_project(pg_temp.id('co'), 'F1240 Site Two')),
  ('pb', tests.fixture_project(pg_temp.id('co_b'), 'F1240 Site B')),
  ('c_int', tests.fixture_category(pg_temp.id('co'), 'F1240 Own interest')),
  ('c_esc', tests.fixture_category(pg_temp.id('co'), 'F1240 Own escrow')),
  ('c_prin', tests.fixture_category(pg_temp.id('co'), 'F1240 Own principal', 'expense', true)),
  ('c_fee', tests.fixture_category(pg_temp.id('co'), 'F1240 Own fees'));

-- Project one: a loan with its own four categories and a rate row, and one with none. Company B has one loan.
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor,
  escrow_minor, currency, project_id, interest_category_id, escrow_category_id, principal_category_id, fees_category_id)
values
  (pg_temp.id('co'), 'F1240 Loan Own', 120000, 60000, 360, '2026-01-01', 1000, 100, 'USD', pg_temp.id('p1'),
   pg_temp.id('c_int'), pg_temp.id('c_esc'), pg_temp.id('c_prin'), pg_temp.id('c_fee')),
  (pg_temp.id('co'), 'F1240 Loan Plain', 90000, 45000, 120, '2026-02-01', 900, 0, 'ILS', pg_temp.id('p1'),
   null, null, null, null),
  (pg_temp.id('co_b'), 'F1240 Loan B', 70000, 60000, 360, '2026-01-01', 700, 0, 'USD', pg_temp.id('pb'),
   null, null, null, null);
insert into f1240 select 'l_own', id from public.loans where name = 'F1240 Loan Own';
insert into f1240 select 'l_plain', id from public.loans where name = 'F1240 Loan Plain';
insert into public.loan_rates (company_id, loan_id, effective_date, annual_rate_ppm)
values (pg_temp.id('co'), pg_temp.id('l_own'), '2026-06-01', 55000);

select tests.authenticate_as('f1240_a');

select is(
  jsonb_array_length(public.get_project(pg_temp.id('p1'), 'cash', null, null, false)->'loans'),
  2,
  'the project lists its two loans'
);

select is(
  pg_temp.loan(false, 'l_own') - array['id', 'name', 'currency', 'balance_minor', 'status', 'closed_on', 'kind',
    'principal_minor', 'annual_rate_ppm', 'term_months', 'start_date', 'payment_minor', 'escrow_minor',
    'interest_only_months', 'amortization_months', 'rates'],
  jsonb_build_object(
    'interest_category_id', pg_temp.id('c_int'), 'escrow_category_id', pg_temp.id('c_esc'),
    'principal_category_id', pg_temp.id('c_prin'), 'fees_category_id', pg_temp.id('c_fee')),
  'the lean answer: a loan with its own categories carries exactly the four ids as its new keys'
);

select is(
  pg_temp.loan(false, 'l_plain') - array['id', 'name', 'currency', 'balance_minor', 'status', 'closed_on', 'kind',
    'principal_minor', 'annual_rate_ppm', 'term_months', 'start_date', 'payment_minor', 'escrow_minor',
    'interest_only_months', 'amortization_months', 'rates'],
  '{"interest_category_id": null, "escrow_category_id": null, "principal_category_id": null, "fees_category_id": null}'::jsonb,
  'a loan with no categories has the four keys, as JSON null'
);

select is(
  (select count(*)::int from jsonb_object_keys(pg_temp.loan(false, 'l_plain')) k),
  20,
  'a loan has the 16 keys it had and the four new ones'
);

select is(
  pg_temp.loan(true, 'l_own'),
  pg_temp.loan(false, 'l_own'),
  'the lines form (flow-mcp''s) has the same loan as the lean one'
);

select is(
  pg_temp.loan(false, 'l_own') - 'rates' - array['interest_category_id', 'escrow_category_id', 'principal_category_id', 'fees_category_id'],
  (select jsonb_build_object(
      'id', l.id, 'name', l.name, 'currency', l.currency, 'balance_minor', b.balance_minor, 'status', l.status,
      'closed_on', l.closed_on, 'kind', l.kind, 'principal_minor', l.principal_minor,
      'annual_rate_ppm', l.annual_rate_ppm, 'term_months', l.term_months, 'start_date', l.start_date,
      'payment_minor', l.payment_minor, 'escrow_minor', l.escrow_minor,
      'interest_only_months', l.interest_only_months, 'amortization_months', l.amortization_months)
   from public.loans l join public.loan_balances b on b.company_id = l.company_id and b.loan_id = l.id
   where l.id = pg_temp.id('l_own')),
  'the terms and balance are the loan''s row and its loan_balances row'
);

select is(
  pg_temp.loan(false, 'l_own')->'rates',
  '[{"effective_date": "2026-06-01", "annual_rate_ppm": 55000}]'::jsonb,
  'the rate history is as before'
);

select is(
  (select jsonb_agg(e->>'name' order by ord) from jsonb_array_elements(
     public.get_project(pg_temp.id('p1'), 'cash', null, null, false)->'loans') with ordinality t(e, ord)),
  '["F1240 Loan Own", "F1240 Loan Plain"]'::jsonb,
  'the loans stay in name order'
);

select is(
  jsonb_array_length(public.get_project(pg_temp.id('p2'), 'cash', null, null, false)->'loans'),
  0,
  'a project with no loan lists none'
);

select is(
  (public.get_project(pg_temp.id('p1'), 'cash', null, null, false)->'loans'->0->>'fees_category_id')::uuid,
  pg_temp.id('c_fee'),
  'the ids read back as strings in the answer'
);

select is(
  (select count(*)::int from public.loans l
   where l.project_id = pg_temp.id('p1')
     and (l.interest_category_id is not null or l.escrow_category_id is not null)),
  1,
  'the fixture: one loan has categories, one has none'
);

select tests.clear_authentication();
select tests.authenticate_as('f1240_b');

select is(
  public.get_project(pg_temp.id('p1'), 'cash', null, null, false),
  null::jsonb,
  'RLS: company B''s owner gets no project one, so none of its loans or their category ids'
);

select is(
  jsonb_array_length(public.get_project(pg_temp.id('pb'), 'cash', null, null, false)->'loans'),
  1,
  'positive control: B''s owner reads B''s own project''s loan'
);

select is(
  (select jsonb_typeof(e->'interest_category_id') from jsonb_array_elements(
     public.get_project(pg_temp.id('pb'), 'cash', null, null, false)->'loans') e),
  'null',
  'B''s loan has the key, null'
);

select * from finish();

rollback;
