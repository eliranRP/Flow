-- FLOW-606: create_company uses the FLOW-604 company-name rule.

begin;

select plan(9);

do $users$
begin
  perform tests.create_supabase_user('cc_tab', 'cc-tab@example.com');
  perform tests.create_supabase_user('cc_long', 'cc-long@example.com');
  perform tests.create_supabase_user('cc_ctrl', 'cc-ctrl@example.com');
  perform tests.create_supabase_user('cc_short', 'cc-short@example.com');
  perform tests.create_supabase_user('cc_max', 'cc-max@example.com');
end
$users$;

select tests.authenticate_as('cc_tab');
select lives_ok(
  $$select public.create_company(E'\t' || U&'\00A0Tab Co\2028 ', true)$$,
  'a name with tabs, a no-break space and a line separator around it is created'
);
reset role;
select is(
  (select c.name from public.companies c where c.owner_id = tests.get_supabase_uid('cc_tab')),
  'Tab Co',
  'the name is trimmed like JavaScript trim()'
);

select tests.authenticate_as('cc_long');
select throws_ok(
  $$select public.create_company(repeat('a', 101), true)$$,
  'P0001',
  'company name is too long',
  'a name over 100 characters is refused'
);
reset role;
select is(
  (select count(*)::int from public.companies c where c.owner_id = tests.get_supabase_uid('cc_long')),
  0,
  'the refused name creates no company'
);

select tests.authenticate_as('cc_ctrl');
select throws_ok(
  $$select public.create_company(E'Ctrl\u0007Co', true)$$,
  'P0001',
  'company name has a control character',
  'a name with a control character is refused'
);
select throws_ok(
  $$select public.create_company(E'Mid\tTab', true)$$,
  'P0001',
  'company name has a control character',
  'a tab inside the name is refused'
);

select tests.authenticate_as('cc_short');
select throws_ok(
  $$select public.create_company(E' x\n', true)$$,
  'P0001',
  'company name is too short',
  'a name of one character after trimming is refused'
);

select tests.authenticate_as('cc_max');
select lives_ok(
  $$select public.create_company(repeat('ש', 100), true)$$,
  'a name of exactly 100 characters is created'
);
reset role;
-- The name it stored passes the rename rule, so a later undo can restore it.
select ok(
  (select private.company_name_problem(c.name) is null and c.name = private.trim_name(c.name)
   from public.companies c where c.owner_id = tests.get_supabase_uid('cc_max')),
  'the stored name passes the company-name rule'
);

select * from finish();
rollback;
