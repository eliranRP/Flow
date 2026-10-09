-- FLOW-509: upsert_connector_lines writes Mercury's skip records and recheck stamps with the lines,
-- and the connector drain reads its own Mercury URL.

begin;

select plan(12);

do $users$
begin
  perform tests.create_supabase_user('atomic_owner', 'atomic-owner@example.com');
end
$users$;

select tests.authenticate_as('atomic_owner');
select lives_ok($$select public.create_company('Atomic Books', true)$$, 'owner creates a company');

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

create temp table atomic_co (id uuid);
insert into atomic_co (id)
select id from public.companies where name = 'Atomic Books' order by created_at desc limit 1;

create function pg_temp.line(p_id text, p_date text) returns jsonb language sql as $$
  select jsonb_build_object(
    'source', 'mercury',
    'external_id', p_id,
    'direction', 'expense',
    'line_status', 'posted',
    'doc_kind', 'expense',
    'currency', 'USD',
    'amount_original', 500,
    'amount_negated', true,
    'doc_date', p_date,
    'description', 'A posted expense',
    'vat', jsonb_build_object('amount', 0, 'status', 'source'),
    'provider_meta', jsonb_build_object('kind', 'outgoingPayment')
  );
$$;

create function pg_temp.sync(p_lines jsonb) returns void language plpgsql as $$
begin
  perform public.upsert_connector_lines((select id from atomic_co), 'mercury', p_lines, null, null);
end
$$;

create function pg_temp.skips() returns text language sql as $$
  select coalesce(string_agg(coalesce(external_id, '-') || ':' || reason, ',' order by external_id nulls first, reason), '')
  from public.connector_skips
  where company_id = (select id from atomic_co) and provider = 'mercury';
$$;

do $do$ begin perform pg_temp.sync(jsonb_build_object(
  'lines', jsonb_build_array(pg_temp.line('atomic-1', '2026-09-01')),
  'complete', false,
  'skips', jsonb_build_array(
    jsonb_build_object('external_id', 'skip-a', 'reason', 'own_account_transfer'),
    jsonb_build_object('external_id', 'skip-a', 'reason', 'own_account_transfer'),
    jsonb_build_object('external_id', null, 'reason', 'not_a_line'),
    jsonb_build_object('external_id', 'skip-empty', 'reason', '')
  )
)); end $do$;

select is(pg_temp.skips(), '-:not_a_line,skip-a:own_account_transfer', 'a run records each skip once, with the lines');

do $do$ begin perform pg_temp.sync(jsonb_build_object(
  'lines', jsonb_build_array(pg_temp.line('atomic-1', '2026-09-01')),
  'complete', false,
  'skips', jsonb_build_array(
    jsonb_build_object('external_id', 'skip-a', 'reason', 'own_account_transfer'),
    jsonb_build_object('external_id', null, 'reason', 'not_a_line'),
    jsonb_build_object('external_id', 'skip-b', 'reason', 'void_status')
  )
)); end $do$;

select is(
  pg_temp.skips(),
  '-:not_a_line,skip-a:own_account_transfer,skip-b:void_status',
  'a resumed run adds only skips not recorded yet'
);

select throws_ok(
  $$select pg_temp.sync(jsonb_build_object(
    'lines', jsonb_build_array(pg_temp.line('atomic-2', 'not-a-date')),
    'complete', true,
    'skips', jsonb_build_array(jsonb_build_object('external_id', 'skip-c', 'reason', 'void_status'))
  ))$$,
  null,
  'a run whose lines fail is refused'
);

select is(
  pg_temp.skips(),
  '-:not_a_line,skip-a:own_account_transfer,skip-b:void_status',
  'a refused run leaves the skip records as they were'
);

do $do$ begin perform pg_temp.sync(jsonb_build_object(
  'lines', jsonb_build_array(pg_temp.line('atomic-1', '2026-09-01')),
  'complete', true,
  'skips', jsonb_build_array(jsonb_build_object('external_id', 'skip-c', 'reason', 'void_status'))
)); end $do$;

select is(pg_temp.skips(), 'skip-c:void_status', 'a complete run replaces the skip records');

do $do$ begin perform pg_temp.sync(jsonb_build_object(
  'lines', '[]'::jsonb,
  'complete', true
)); end $do$;

select is(pg_temp.skips(), 'skip-c:void_status', 'a run that sends no skips key (sumit-sync) leaves them alone');

do $do$ begin perform pg_temp.sync(jsonb_build_object(
  'lines', '[]'::jsonb,
  'complete', false,
  'checked', jsonb_build_array(
    jsonb_build_object('external_id', 'atomic-1', 'checked_at', '2026-10-09T01:00:00.000Z'),
    jsonb_build_object('external_id', 'atomic-1', 'checked_at', '2026-10-09T02:00:00.000Z'),
    jsonb_build_object('external_id', 'not-stored', 'checked_at', '2026-10-09T02:00:00.000Z'),
    jsonb_build_object('external_id', 'atomic-1', 'checked_at', '')
  )
)); end $do$;

select is(
  (select provider_meta from public.transactions where company_id = (select id from atomic_co) and external_id = 'atomic-1'),
  '{"kind":"outgoingPayment","checked_at":"2026-10-09T02:00:00.000Z"}'::jsonb,
  'the recheck stamp is written with the run, the latest stamp wins, and the rest of provider_meta stays'
);

select is(
  (select count(*)::integer from public.transactions where company_id = (select id from atomic_co) and external_id = 'not-stored'),
  0,
  'a stamp for a line that is not stored adds nothing'
);

select ok(
  not has_function_privilege('authenticated', 'public.upsert_connector_lines(uuid,public.connector_provider,jsonb,text,text)', 'execute')
    and has_function_privilege('service_role', 'public.upsert_connector_lines(uuid,public.connector_provider,jsonb,text,text)', 'execute'),
  'the patched upsert keeps its grants'
);

select ok(
  position('flow_mercury_sync_url' in pg_get_functiondef('private.schedule_connector_jobs()'::regprocedure)) > 0,
  'the drain reads Vault flow_mercury_sync_url for Mercury rows'
);

select ok(
  position($t$replace(decrypted_secret, '/sumit-sync', '/mercury-sync')$t$ in pg_get_functiondef('private.schedule_connector_jobs()'::regprocedure)) > 0,
  'and falls back to the swapped sumit-sync URL until that secret is set'
);

select * from finish();
rollback;
