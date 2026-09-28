-- The owner can read SUMIT status, including the retry clock, without the key.

begin;

select plan(6);

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

reset role;
insert into public.sumit_connections (
  company_id, sumit_company_id,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version, envelope_version,
  next_attempt_at
)
select id, 100, '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea, '1', '2',
  '2099-01-01 10:00:00+00'
from public.companies
where name = 'סטטוס'
order by created_at desc
limit 1;

select tests.authenticate_as('status_owner');
select is(
  (public.sumit_status() ->> 'next_attempt_at')::timestamptz,
  '2099-01-01 10:00:00+00'::timestamptz,
  'the owner reads the retry clock'
);
select throws_ok(
  $$select key_ciphertext from public.sumit_connections$$,
  '42501',
  null,
  'the owner still cannot read the key'
);

select * from finish();
rollback;
