-- FLOW-510: sumit-sync records sync_schema_drift through note_sync_failure, Settings reads it
-- from sumit_status, and the next try waits 15 minutes. Invented names, @example.com only.

begin;

select plan(6);

do $users$
begin
  perform tests.create_supabase_user('f510_owner', 'owner510@example.com');
end
$users$;

select tests.authenticate_as('f510_owner');
select public.create_company('Example Drift Co', true);
reset role;

create temp table f510 (label text primary key, id uuid);
grant all on f510 to authenticated, service_role;
insert into f510 (label, id) select 'company', id from public.companies where name = 'Example Drift Co';

insert into public.sumit_connections (
  company_id, sumit_company_id,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version, envelope_version
)
select id, 510, '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea, '1', '2'
from f510 where label = 'company';

select tests.authenticate_as('f510_owner');
select throws_ok(
  format($$select public.note_sync_failure(%L::uuid, 'sync_schema_drift')$$, (select id from f510 where label = 'company')),
  '42501',
  'permission denied for function note_sync_failure',
  'an owner cannot record schema drift'
);
reset role;

do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;
set local role service_role;

select lives_ok(
  format($$select public.note_sync_failure(%L::uuid, 'sync_schema_drift')$$, (select id from f510 where label = 'company')),
  'the sync records schema drift'
);
select throws_ok(
  format($$select public.note_sync_failure(%L::uuid, 'sync_drift')$$, (select id from f510 where label = 'company')),
  'P0001',
  'unknown sync failure',
  'another code is still refused'
);
reset role;

select is(
  (select last_error from public.sumit_connections where company_id = (select id from f510 where label = 'company')),
  'sync_schema_drift',
  'the connection stores sync_schema_drift'
);
select cmp_ok(
  (select next_attempt_at from public.sumit_connections where company_id = (select id from f510 where label = 'company')),
  '>',
  now() + interval '14 minutes',
  'the next try waits 15 minutes'
);

select tests.authenticate_as('f510_owner');
select is(public.sumit_status()->>'last_error', 'sync_schema_drift', 'Settings reads sync_schema_drift from sumit_status');
reset role;

select * from finish();

rollback;
