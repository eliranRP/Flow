-- The owner can read SUMIT status, including the retry clock, without the key.

begin;

select plan(4);

do $users$
begin
  perform tests.create_supabase_user('status_owner', 'status-owner@test.flow');
end
$users$;

select tests.authenticate_as('status_owner');
select lives_ok($$select public.create_company('סטטוס', true)$$, 'owner creates a company');
select lives_ok($$select public.sumit_status()$$, 'owner can read SUMIT status');
select is(
  (public.sumit_status() ->> 'connected')::boolean,
  false,
  'a company with no connection is disconnected'
);
select is(
  public.sumit_status() ? 'next_attempt_at',
  true,
  'status includes the retry clock'
);

select * from finish();
rollback;
