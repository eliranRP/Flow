-- Claim, import date, failure, stamp, and the reseal selection.

begin;

select plan(27);

do $users$
begin
  perform tests.create_supabase_user('ops_owner', 'ops-owner@test.flow');
  perform tests.create_supabase_user('ops_other', 'ops-other@test.flow');
end
$users$;

create temp table ops (label text primary key, id uuid);
grant all on ops to authenticated;

select tests.authenticate_as('ops_owner');
select lives_ok($$select public.create_company('תפעול', true)$$, 'owner creates a company');
insert into ops (label, id) select 'a', id from public.companies where name = 'תפעול';

select tests.authenticate_as('ops_other');
select lives_ok($$select public.create_company('שני', true)$$, 'the other owner creates a company');
insert into ops (label, id) select 'b', id from public.companies where name = 'שני';

reset role;
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'overhead',
  -1000, -1000, 0, 'unknown',
  current_date, 'manual', 'ops:keep', 'נשאר'
from ops where label = 'a';

insert into public.connector_connections (
  company_id, provider,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
  kek_ref, kek_version, envelope_version
)
select id, 'sumit', '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea,
  'SUMIT_KEK', '1', '1'
from ops where label = 'a';

insert into public.connector_connections (
  company_id, provider,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
  kek_ref, kek_version, envelope_version
)
select id, 'sumit', '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea,
  'SUMIT_KEK', '2', '2'
from ops where label = 'b';

insert into public.connector_refresh_requests (company_id, provider, forced)
select id, 'sumit', false from ops where label = 'a';

select tests.authenticate_as('ops_owner');

select throws_ok(
  format(
    $$select public.set_import_from('sumit', %L::date)$$,
    ((pg_catalog.now() at time zone 'Asia/Jerusalem')::date + 1)
  ),
  'P0001',
  'import date is after today',
  'an import date after today is rejected'
);

select lives_ok(
  $$select public.set_import_from('sumit', '2020-01-01')$$,
  'a past import date is stored'
);

select lives_ok(
  $$select public.set_import_from('sumit', null)$$,
  'an empty import date is allowed'
);

select is(
  (
    select count(*)::int
    from public.transactions
    where company_id = (select id from ops where label = 'a')
  ),
  1,
  'the import date does not delete rows'
);

reset role;
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);

select is(
  (
    select import_from is null
    from public.connector_connections
    where company_id = (select id from ops where label = 'a')
      and provider = 'sumit'
  ),
  true,
  'the empty import date is stored'
);

do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

select is(
  (select id from public.claim_connector_refreshes(20)),
  (select id from public.connector_refresh_requests where company_id = (select id from ops where label = 'a')),
  'claim returns that refresh id'
);

select is(
  (
    select r.claimed_at is not null and c.sync_claimed_at is not null
    from public.connector_refresh_requests r
    join public.connector_connections c
      on c.company_id = r.company_id and c.provider = r.provider
    where r.company_id = (select id from ops where label = 'a')
  ),
  true,
  'claim stamps the request and the connection'
);

select is(
  (select count(*)::int from public.claim_connector_refreshes(20)),
  0,
  'a claimed request is not claimed again'
);

insert into public.connector_refresh_requests (company_id, provider, forced)
select id, 'sumit', false from ops where label = 'a';

select is(
  (select count(*)::int from public.claim_connector_refreshes(20)),
  0,
  'a fresh sync claim is left open'
);

update public.connector_connections
set sync_claimed_at = pg_catalog.now() - interval '11 minutes',
    last_error = 'auth'
where company_id = (select id from ops where label = 'a')
  and provider = 'sumit';

select is(
  (select count(*)::int from public.claim_connector_refreshes(20)),
  0,
  'an auth failure is not claimed'
);

update public.connector_connections
set last_error = null,
    next_attempt_at = pg_catalog.now() + interval '1 hour'
where company_id = (select id from ops where label = 'a')
  and provider = 'sumit';

select is(
  (select count(*)::int from public.claim_connector_refreshes(20)),
  0,
  'a future retry is not claimed'
);

update public.connector_connections
set next_attempt_at = null
where company_id = (select id from ops where label = 'a')
  and provider = 'sumit';

select is(
  (select count(*)::int from public.claim_connector_refreshes(20)),
  1,
  'an old sync claim is claimed'
);

select ok(
  public.note_connector_failure((select id from ops where label = 'a'), 'sumit', 'rate_limited')
    > pg_catalog.now() + interval '14 minutes',
  'a rate limit waits about fifteen minutes'
);

select ok(
  public.note_connector_failure((select id from ops where label = 'a'), 'sumit', 'auth') is null,
  'an auth failure clears the retry'
);

select is(
  (
    select last_error
    from public.connector_connections
    where company_id = (select id from ops where label = 'a')
      and provider = 'sumit'
  ),
  'auth',
  'the auth failure is stored'
);

select throws_ok(
  format(
    $$select public.note_connector_failure(%L::uuid, 'sumit', 'sync_failed')$$,
    (select id from ops where label = 'a')
  ),
  'P0001',
  'unknown connector failure',
  'sync_failed is not a connector failure'
);

update public.connector_connections
set last_error = 'sync_sweep_empty',
    reject_attempts = 3,
    next_attempt_at = pg_catalog.now(),
    sync_claimed_at = pg_catalog.now()
where company_id = (select id from ops where label = 'a')
  and provider = 'sumit';

select lives_ok(
  format(
    $$select public.stamp_connector_sync(%L::uuid, 'sumit')$$,
    (select id from ops where label = 'a')
  ),
  'a sweep error can be stamped'
);

select is(
  (
    select last_error || ':' || reject_attempts::text || ':' || (next_attempt_at is null)::text
      || ':' || (sync_claimed_at is null)::text || ':' || (last_sync_at is not null)::text
    from public.connector_connections
    where company_id = (select id from ops where label = 'a')
      and provider = 'sumit'
  ),
  'sync_sweep_empty:0:true:true:true',
  'the stamp keeps a sweep error and clears the claim'
);

update public.connector_connections
set last_error = 'rate_limited'
where company_id = (select id from ops where label = 'a')
  and provider = 'sumit';

select lives_ok(
  format(
    $$select public.stamp_connector_sync(%L::uuid, 'sumit')$$,
    (select id from ops where label = 'a')
  ),
  'a rate limit can be stamped'
);

select is(
  (
    select last_error is null
    from public.connector_connections
    where company_id = (select id from ops where label = 'a')
      and provider = 'sumit'
  ),
  true,
  'the stamp clears a rate limit'
);

select throws_ok(
  $$select public.stamp_connector_sync('00000000-0000-0000-0000-000000000099', 'sumit')$$,
  'P0001',
  'could not stamp the sync',
  'a missing connection cannot be stamped'
);

select is(
  (
    select count(*)::int
    from public.connector_connections c
    where c.provider = 'sumit'
      and coalesce(c.envelope_version, case when c.kek_version = '2' then '2' else '1' end) = '1'
  ),
  1,
  'reseal selects only a format-1 row'
);

update public.connector_connections
set envelope_version = '3'
where company_id = (select id from ops where label = 'a')
  and provider = 'sumit'
  and key_ciphertext = '\x99'::bytea
  and dek_ciphertext = '\x99'::bytea;

select is(
  (
    select envelope_version
    from public.connector_connections
    where company_id = (select id from ops where label = 'a')
      and provider = 'sumit'
  ),
  '1',
  'a reseal with a different ciphertext does not write'
);

update public.connector_connections
set envelope_version = '3'
where company_id = (select id from ops where label = 'a')
  and provider = 'sumit'
  and key_ciphertext = '\x01'::bytea
  and dek_ciphertext = '\x03'::bytea;

select is(
  (
    select count(*)::int
    from public.connector_connections c
    where c.provider = 'sumit'
      and coalesce(c.envelope_version, case when c.kek_version = '2' then '2' else '1' end) = '1'
  ),
  0,
  'a matching reseal leaves no format-1 row'
);

select tests.authenticate_as('ops_owner');
select throws_ok(
  $$select * from public.claim_connector_refreshes(20)$$,
  '42501',
  null,
  'an owner cannot claim refreshes'
);

select * from finish();
rollback;
