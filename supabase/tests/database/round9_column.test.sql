-- The owner cannot write companies.last_sumit_company_id. The definer RPCs still can.

begin;

select plan(4);

select ok(
  not has_column_privilege('authenticated', 'public.companies', 'last_sumit_company_id', 'UPDATE'),
  'authenticated has no update privilege on last_sumit_company_id'
);
select ok(
  has_column_privilege('authenticated', 'public.companies', 'name', 'UPDATE'),
  'authenticated can still update the company name'
);

do $users$
begin
  perform tests.create_supabase_user('col_owner', 'col-owner@test.flow');
end
$users$;

select tests.authenticate_as('col_owner');
select lives_ok($$select public.create_company('עמודה', true)$$, 'owner creates a company');

reset role;
update public.companies
set last_sumit_company_id = 100
where name = 'עמודה';

select tests.authenticate_as('col_owner');
select throws_ok(
  $$update public.companies set last_sumit_company_id = 200$$,
  '42501',
  null,
  'the owner cannot write last_sumit_company_id'
);

select * from finish();
rollback;
