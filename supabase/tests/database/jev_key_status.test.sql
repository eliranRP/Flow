-- FLOW-704: jev_key_status() says whether Vault holds the Jev key, and nothing else.

begin;

select plan(9);

do $users$
begin
  perform tests.create_supabase_user('jks_owner', 'jks-owner@example.com');
  perform tests.create_supabase_user('jks_viewer', 'jks-viewer@example.com');
  perform tests.create_supabase_user('jks_none', 'jks-none@example.com');
  perform tests.create_supabase_user('jks_demo_owner', 'jks-demo@example.com');
end
$users$;

select tests.authenticate_as('jks_owner');
select lives_ok($$select public.create_company('Key Status Books', true)$$, 'owner creates a company');

reset role;
-- Only a demo company takes viewers.
insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('jks_viewer'), tests.fixture_company('jks_demo_owner', 'Key Status Demo', true);

reset role;
delete from vault.secrets where name = 'jev_api_key';

select tests.authenticate_as('jks_owner');
select is(public.jev_key_status(), 'missing', 'no Vault secret reads missing');

reset role;
do $$ begin perform vault.create_secret('   ', 'jev_api_key', 'test'); end $$;
select tests.authenticate_as('jks_owner');
select is(public.jev_key_status(), 'missing', 'a blank secret reads missing');

reset role;
do $$ begin perform vault.update_secret((select id from vault.secrets where name = 'jev_api_key'), 'sk-test-not-a-real-key'); end $$;
select tests.authenticate_as('jks_owner');
select is(public.jev_key_status(), 'ok', 'a stored key reads ok');

select tests.authenticate_as('jks_viewer');
select is(public.jev_key_status(), 'ok', 'a demo viewer reads the status too');

select tests.authenticate_as('jks_none');
select throws_ok($$select public.jev_key_status()$$, '42501', null, 'a user with no company is refused');

reset role;
set local role anon;
select throws_ok($$select public.jev_key_status()$$, '42501', null, 'anon cannot call it');

reset role;
select ok(
  has_function_privilege('authenticated', 'public.jev_key_status()', 'execute')
    and not has_function_privilege('anon', 'public.jev_key_status()', 'execute'),
  'authenticated may execute, anon may not'
);

select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] and pg_get_function_result(p.oid) = 'text'
     from pg_proc p where p.oid = 'public.jev_key_status()'::regprocedure),
  'security definer with an empty search_path, returning a word'
);

select * from finish();
rollback;
