-- Refresh busy state from the server. syncing is true while sync_claimed_at is
-- within 15 minutes, false when it is stale or null, and false after
-- note_connector_failure. sumit_status() exposes it too.

begin;

select plan(12);

do $users$
begin
  perform tests.create_supabase_user('sync_owner', 'sync-owner@test.flow');
end
$users$;

create temp table syn (label text primary key, id uuid);
grant all on syn to authenticated;

select tests.authenticate_as('sync_owner');
select lives_ok($$select public.create_company('סנכרון', true)$$, 'owner creates a company');
insert into syn (label, id) select 'a', id from public.companies where name = 'סנכרון';

select is(
  public.sumit_status() -> 'syncing',
  'false'::jsonb,
  'a company with no SUMIT connection is not syncing'
);

reset role;
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

insert into public.connector_connections (
  company_id, provider,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
  kek_ref, kek_version, envelope_version
)
select id, 'sumit', '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea,
  'SUMIT_KEK', '1', '3'
from syn where label = 'a';

insert into public.connector_connections (
  company_id, provider,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
  kek_ref, kek_version, envelope_version,
  sync_claimed_at
)
select id, 'mercury', '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea,
  'MERCURY_KEK', '1', '3',
  pg_catalog.now() - interval '1 minute'
from syn where label = 'a';

select tests.authenticate_as('sync_owner');

select is(
  (select syncing from public.connector_connection_status where provider = 'mercury'),
  true,
  'a claim from a minute ago is syncing'
);

select is(
  (select syncing from public.connector_connection_status where provider = 'sumit'),
  false,
  'no claim is not syncing'
);

select is(
  public.sumit_status() -> 'syncing',
  'false'::jsonb,
  'sumit_status reports an unclaimed connection as not syncing'
);

select throws_ok(
  $$select key_ciphertext from public.connector_connections$$,
  '42501',
  null,
  'the owner still cannot read the key'
);

reset role;
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

update public.connector_connections
set sync_claimed_at = pg_catalog.now() - interval '2 minutes'
where company_id = (select id from syn where label = 'a')
  and provider = 'sumit';

select tests.authenticate_as('sync_owner');

select is(
  public.sumit_status() -> 'syncing',
  'true'::jsonb,
  'sumit_status reports a fresh SUMIT claim as syncing'
);

select is(
  (select syncing from public.connector_connection_status where provider = 'sumit'),
  true,
  'the view reports the fresh SUMIT claim as syncing'
);

reset role;
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

update public.connector_connections
set sync_claimed_at = pg_catalog.now() - interval '16 minutes'
where company_id = (select id from syn where label = 'a')
  and provider = 'sumit';

select tests.authenticate_as('sync_owner');

select is(
  (select syncing from public.connector_connection_status where provider = 'sumit'),
  false,
  'a claim older than 15 minutes is stale, not syncing'
);

select is(
  public.sumit_status() -> 'syncing',
  'false'::jsonb,
  'sumit_status reports a stale claim as not syncing'
);

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

select is(
  public.note_connector_failure((select id from syn where label = 'a'), 'mercury', 'transient') is not null,
  true,
  'a transient failure is noted'
);

select tests.authenticate_as('sync_owner');

select is(
  (select syncing from public.connector_connection_status where provider = 'mercury'),
  false,
  'a noted failure clears the claim, so the row is not syncing'
);

select * from finish();
rollback;
