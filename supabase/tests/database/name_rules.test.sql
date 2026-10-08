-- FLOW-205: project, category, loan and company names refuse hidden characters in the
-- database too, wide spaces become plain, and an old name never blocks another update.
-- Invented data only. Emails use @example.com.

begin;

select plan(19);

select tests.create_supabase_user('fnr_owner', 'fnr-owner@example.com');

create temp table fnr (label text primary key, id uuid);
grant all on fnr to authenticated, service_role;

select tests.authenticate_as('fnr_owner');
select public.create_company('Example Name Rules Co', true);
reset role;
insert into fnr (label, id) select 'company', id from public.companies where name = 'Example Name Rules Co';

select is(private.name_has_hidden_char(U&'Site\200FBeta'), true, 'an RLM is hidden');
select is(private.name_has_hidden_char(U&'Site\+0E0041Beta'), true, 'a tag character is hidden');
select is(private.name_has_hidden_char(U&'פרויקט \+01F468\200D\+01F469'), false, 'Hebrew and an emoji joined with ZWJ are fine');

select tests.authenticate_as('fnr_owner');
select throws_ok(
  format($$select public.upsert_project(p_name => %L)$$, U&'Site\200FBeta'),
  '23514', 'name has an invisible or control character', 'the app cannot store a project name with an RLM');
select throws_ok(
  format($$select public.create_category(%L, 'expense')$$, U&'Cat\200BOne'),
  '23514', 'name has an invisible or control character', 'nor a category name with a zero-width space');
select public.upsert_project(p_name => U&'Site\00A0Beta\2009Two');
select is((select count(*)::integer from public.projects where name = 'Site Beta Two'), 1, 'wide spaces inside a project name become plain');
select public.create_category('Example Supplies', 'expense');
select throws_ok(
  format($$select public.create_category(%L, 'expense')$$, U&'\00A0Example\00A0Supplies'),
  'P0001', 'category already exists', 'a wide-space variant of a taken category name is already taken');
select public.upsert_project(p_name => U&'\00A0Example Lead\3000');
select is((select count(*)::integer from public.projects where name = 'Example Lead'), 1, 'a wide space at either end of a project name is trimmed');
reset role;

-- A name stored before this rule does not block an update of another column or of the name to itself.
alter table public.projects disable trigger projects_clean_name;
insert into public.projects (company_id, name) values ((select id from fnr where label = 'company'), U&'Old\200FName');
alter table public.projects enable trigger projects_clean_name;
select lives_ok(
  format($$update public.projects set status = 'finished' where name = %L$$, U&'Old\200FName'),
  'an old name does not block a status change');
select lives_ok(
  format($$update public.projects set name = name where name = %L$$, U&'Old\200FName'),
  'nor setting the name to itself');
select throws_ok(
  format($$update public.projects set name = %L where name = %L$$, U&'New\200FName', U&'Old\200FName'),
  '23514', 'name has an invisible or control character', 'a new hidden name is refused');

select throws_ok(
  format($$insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency)
    values (%L, %L, 100000, 0, 10, '2026-01-01', 10000, 0, 'USD')$$, (select id from fnr where label = 'company'), U&'Loan\FEFF'),
  '23514', 'name has an invisible or control character', 'a loan name with a BOM is refused');

select is(private.company_name_problem(U&'Example\200FCo'), 'company name has an invisible character', 'a company name with an RLM has a problem');
select is(private.trim_name(U&' Example\00A0Co\3000'), 'Example Co', 'trim_name trims and turns an inner wide space plain');
select tests.authenticate_as('fnr_owner');
select throws_ok(
  format($$select public.rename_company(%L, %L)$$, (select id from fnr where label = 'company'), U&'Example\200FCo'),
  'P0001', 'company name has an invisible character', 'rename_company refuses it');
select is(
  public.rename_company((select id from fnr where label = 'company'), U&'Example\00A0Renamed')->>'name',
  'Example Renamed', 'and stores a wide space as a plain one');
reset role;

-- A SUMIT budget section name with a pasted mark does not stop the sync.
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;
select lives_ok(
  format($$select public.upsert_connector_lines(%L, 'sumit', %L::jsonb, null, null)$$,
    (select id from fnr where label = 'company'),
    jsonb_build_object('lines', jsonb_build_array(jsonb_build_object(
      'source', 'sumit', 'external_id', 'fnr-1', 'direction', 'expense', 'line_status', 'posted',
      'doc_kind', 'expense', 'pnl_role', 'project', 'currency', 'ILS', 'amount_original', 500,
      'amount_negated', true, 'doc_date', '2026-10-01', 'description', 'Example line',
      'vat', jsonb_build_object('amount', 0, 'status', 'unknown'),
      'project_hint', jsonb_build_object('name', U&'Example\200F\00A0Harbor', 'external_id', '77'))))),
  'a SUMIT section name with an RLM syncs');
select is((select count(*)::integer from public.projects where name = 'Example Harbor'), 1,
  'and its project gets the name without the mark');
select is(private.strip_hidden_chars(U&'A\200FB\200DC'), U&'AB\200DC', 'strip_hidden_chars keeps ZWJ');

select * from finish();
rollback;
