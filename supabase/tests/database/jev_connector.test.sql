-- Jev connector. Members read their own rows. The key stays on the service role.
-- Helpers come from supabase/tests/helpers.sql.

begin;

select plan(78);

do $users$
begin
  perform tests.create_supabase_user('jev_owner');
  perform tests.create_supabase_user('jev_other');
  perform tests.create_supabase_user('jev_none');
end
$users$;

select tests.authenticate_as('jev_owner');
select lives_ok($$select public.create_company('עסק א', true)$$, 'owner creates a company');

select tests.authenticate_as('jev_other');
select lives_ok($$select public.create_company('עסק ב', true)$$, 'other owner creates a company');

reset role;

create temp table jev_ref (label text primary key, id uuid);
grant all on jev_ref to anon, authenticated, service_role;

insert into jev_ref (label, id)
select 'company_a', c.id
from public.companies c
join auth.users u on u.id = c.owner_id
where u.raw_user_meta_data ->> 'test_identifier' = 'jev_owner';

insert into jev_ref (label, id)
select 'company_b', c.id
from public.companies c
join auth.users u on u.id = c.owner_id
where u.raw_user_meta_data ->> 'test_identifier' = 'jev_other';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'project',
  -11800, -10000, -1800, 'assumed',
  '2026-04-12', null, 'sumit', 'sumit:jev-a', 'בלוקים'
from jev_ref where label = 'company_a';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'project',
  -23600, -20000, -3600, 'assumed',
  '2026-04-12', null, 'sumit', 'sumit:jev-b', 'מלט'
from jev_ref where label = 'company_b';

insert into jev_ref (label, id)
select 'txn_a', t.id
from public.transactions t
where t.idempotency_key = 'sumit:jev-a';

insert into jev_ref (label, id)
select 'txn_b', t.id
from public.transactions t
where t.idempotency_key = 'sumit:jev-b';

select has_table('public', 'company_integrations', 'company_integrations exists');
select has_table('public', 'tag_suggestions', 'tag_suggestions exists');

select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'company_integrations'),
  'company_integrations has row level security'
);
select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'tag_suggestions'),
  'tag_suggestions has row level security'
);

select is(
  (select count(*)::int from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'tag_suggestions' and p.polcmd = 'a'),
  0,
  'tag_suggestions has no insert policy'
);

select ok(
  has_table_privilege('authenticated', 'public.tag_suggestions', 'select')
  and not has_table_privilege('authenticated', 'public.tag_suggestions', 'insert')
  and not has_table_privilege('authenticated', 'public.tag_suggestions', 'update')
  and not has_table_privilege('authenticated', 'public.tag_suggestions', 'delete')
  and has_table_privilege('authenticated', 'public.company_integrations', 'select')
  and not has_table_privilege('authenticated', 'public.company_integrations', 'insert')
  and not has_table_privilege('authenticated', 'public.company_integrations', 'update')
  and not has_table_privilege('authenticated', 'public.company_integrations', 'delete'),
  'members can read both tables and cannot write them'
);
select ok(
  not has_table_privilege('anon', 'public.tag_suggestions', 'select')
  and not has_table_privilege('anon', 'public.company_integrations', 'select'),
  'anon cannot read either table'
);
select ok(
  has_table_privilege('service_role', 'public.tag_suggestions', 'insert')
  and has_table_privilege('service_role', 'public.tag_suggestions', 'select'),
  'service role can write suggestions'
);

select ok(
  not has_function_privilege('anon', 'public.read_jev_api_key()', 'execute')
  and not has_function_privilege('authenticated', 'public.read_jev_api_key()', 'execute')
  and has_function_privilege('service_role', 'public.read_jev_api_key()', 'execute'),
  'only service_role can execute read_jev_api_key'
);
select ok(
  has_function_privilege('authenticated', 'public.set_company_integration(boolean, text, numeric, text)', 'execute')
  and not has_function_privilege('anon', 'public.set_company_integration(boolean, text, numeric, text)', 'execute'),
  'members can call set_company_integration and anon cannot'
);

select is(
  (select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('set_company_integration', 'read_jev_api_key')
      and exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
        where cfg = 'search_path=""'
      )),
  2,
  'both functions set search_path to the empty string'
);

insert into public.company_integrations (company_id, provider)
select id, 'jev' from jev_ref where label = 'company_a';

select is(
  (select enabled from public.company_integrations i join jev_ref r on r.id = i.company_id where r.label = 'company_a'),
  false,
  'a new integration is disabled'
);
select is(
  (select mode from public.company_integrations i join jev_ref r on r.id = i.company_id where r.label = 'company_a'),
  'shadow',
  'a new integration is in shadow'
);
select is(
  (select threshold = 0.90 from public.company_integrations i join jev_ref r on r.id = i.company_id where r.label = 'company_a'),
  true,
  'a new integration uses threshold 0.90'
);

select throws_ok(
  $$insert into public.company_integrations (company_id, provider)
    select id, 'sumit' from jev_ref where label = 'company_b'$$,
  '23514', null, 'provider is jev only'
);
select throws_ok(
  $$insert into public.company_integrations (company_id, provider, mode)
    select id, 'jev', 'live' from jev_ref where label = 'company_b'$$,
  '23514', null, 'mode is off or shadow'
);
select throws_ok(
  $$insert into public.company_integrations (company_id, provider, mode)
    select id, 'jev', 'manual' from jev_ref where label = 'company_b'$$,
  '23514', null, 'a mode outside off, shadow and auto is refused'
);
select lives_ok(
  $$update public.company_integrations set mode = 'off'$$,
  'mode can be off'
);
select is(
  (select mode from public.company_integrations),
  'off',
  'off was stored'
);
update public.company_integrations set mode = 'shadow';
select throws_ok(
  $$update public.company_integrations set threshold = 1.5$$,
  '23514', null, 'threshold cannot exceed 1'
);
select throws_ok(
  $$update public.company_integrations set threshold = 0$$,
  '23514', null, 'threshold cannot be 0'
);
select throws_ok(
  $$update public.company_integrations set threshold = 0.49$$,
  '23514', null, 'threshold cannot be below 0.50'
);
select lives_ok(
  $$update public.company_integrations set threshold = 0.50$$,
  'threshold can be 0.50'
);
select is(
  (select threshold = 0.50 from public.company_integrations),
  true,
  'threshold 0.50 was stored'
);
select lives_ok(
  $$update public.company_integrations set threshold = 1$$,
  'threshold can be 1'
);
select is(
  (select threshold = 0.90 from public.company_integrations i join jev_ref r on r.id = i.company_id where r.label = 'company_a'),
  false,
  'the threshold change is visible before it is restored'
);
update public.company_integrations set threshold = 0.90;

select throws_ok(
  $$insert into public.company_integrations (company_id, provider)
    select id, 'jev' from jev_ref where label = 'company_a'$$,
  '23505', null, 'one integration row per company and provider'
);

select throws_ok(
  format(
    $$insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
      values (%L::uuid, %L::uuid, '{"project":{"probabilities":null}}'::jsonb, 1.1, 'jev-1.13.0', 'jev-1.13.0')$$,
    (select id from jev_ref where label = 'company_a'),
    (select id from jev_ref where label = 'txn_a')
  ),
  '23514', null, 'confidence cannot exceed 1'
);
select throws_ok(
  format(
    $$insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
      values (%L::uuid, %L::uuid, '{}'::jsonb, 0.5, ' ', 'jev-1.13.0')$$,
    (select id from jev_ref where label = 'company_a'),
    (select id from jev_ref where label = 'txn_a')
  ),
  '23514', null, 'model_version cannot be blank'
);
select throws_ok(
  format(
    $$insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
      values (%L::uuid, %L::uuid, '{}'::jsonb, 0.5, 'jev-1.13.0', ' ')$$,
    (select id from jev_ref where label = 'company_a'),
    (select id from jev_ref where label = 'txn_a')
  ),
  '23514', null, 'response_model cannot be blank'
);
select throws_ok(
  format(
    $$insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
      values (%L::uuid, %L::uuid, '[]'::jsonb, 0.5, 'jev-1.13.0', 'jev-1.13.0')$$,
    (select id from jev_ref where label = 'company_a'),
    (select id from jev_ref where label = 'txn_a')
  ),
  '23514', null, 'answers must be a JSON object'
);
select throws_ok(
  format(
    $$insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
      values (%L::uuid, %L::uuid, '{}'::jsonb, 0.5, 'jev-1.13.0', 'jev-1.13.0')$$,
    (select id from jev_ref where label = 'company_b'),
    (select id from jev_ref where label = 'txn_a')
  ),
  '23503', null, 'a suggestion cannot point at another company transaction'
);

create temp table jev_secret (secret text);
grant all on jev_secret to service_role;

do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;

select throws_ok(
  $$select public.read_jev_api_key()$$,
  'P0001',
  'missing_jev_api_key',
  'a missing Vault secret fails closed'
);

select lives_ok(
  $$select vault.create_secret('jev-test-secret', 'jev_api_key', 'pgTAP fixture')$$,
  'the fixture secret can be stored in Vault'
);

set role service_role;
insert into jev_secret select public.read_jev_api_key();
reset role;

select is(
  (select secret from jev_secret),
  'jev-test-secret',
  'service role reads the Vault secret'
);

set role service_role;
insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
select
  (select id from jev_ref where label = 'company_a'),
  (select id from jev_ref where label = 'txn_a'),
  '{"project":{"type":"choice","choice":"site","probabilities":{"site":0.91,"other":0.09},"confidence":0.82},"overhead":{"type":"noul","noul":0.04,"probabilities":null}}'::jsonb,
  0.82,
  'jev-1.13.0',
  'jev-1.14.0';
insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
select
  (select id from jev_ref where label = 'company_b'),
  (select id from jev_ref where label = 'txn_b'),
  '{"project":{"type":"choice","choice":"yard","probabilities":{"yard":0.4},"confidence":0.2}}'::jsonb,
  0.20,
  'jev-1.13.0',
  'jev-1.13.0';
reset role;

select is(
  (select count(*)::int from public.tag_suggestions),
  2,
  'service role stored both companies suggestions'
);

select throws_ok(
  format(
    $$insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
      values (%L::uuid, %L::uuid, '{}'::jsonb, 0.5, 'jev-1.13.0', 'jev-1.13.0')$$,
    (select id from jev_ref where label = 'company_a'),
    (select id from jev_ref where label = 'txn_a')
  ),
  '23505', null, 'the same transaction and model are stored once'
);

set role service_role;
insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
select
  (select id from jev_ref where label = 'company_a'),
  (select id from jev_ref where label = 'txn_a'),
  '{}'::jsonb,
  0.10,
  'jev-other',
  'jev-other';
reset role;

select is(
  (select count(*)::int from public.tag_suggestions where transaction_id = (select id from jev_ref where label = 'txn_a')),
  2,
  'a different model version is a separate row'
);

select tests.authenticate_as('jev_owner');

select is(
  (select count(*)::int from public.company_integrations),
  1,
  'owner reads their integration'
);
select is(
  (select enabled from public.company_integrations),
  false,
  'owner reads the disabled flag'
);
select is(
  (select count(*)::int from public.tag_suggestions),
  2,
  'owner reads both suggestions for their transaction'
);
select is(
  (select confidence = 0.82 from public.tag_suggestions where model_version = 'jev-1.13.0'),
  true,
  'owner reads their suggestion confidence'
);
select is(
  (select model_version from public.tag_suggestions where confidence = 0.82),
  'jev-1.13.0',
  'owner reads their model version'
);
select is(
  (select answers = '{"project":{"type":"choice","choice":"site","probabilities":{"site":0.91,"other":0.09},"confidence":0.82},"overhead":{"type":"noul","noul":0.04,"probabilities":null}}'::jsonb
    from public.tag_suggestions where model_version = 'jev-1.13.0'),
  true,
  'owner reads answers, including a null probabilities field'
);
select is(
  (select response_model from public.tag_suggestions where model_version = 'jev-1.13.0'),
  'jev-1.14.0',
  'owner reads the model the API returned'
);
select is(
  (select company_id = (select id from jev_ref where label = 'company_a') and transaction_id = (select id from jev_ref where label = 'txn_a') and created_at is not null and id is not null and response_model = 'jev-1.14.0'
    from public.tag_suggestions where model_version = 'jev-1.13.0'),
  true,
  'owner reads every remaining suggestion column'
);

select throws_ok(
  $$insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
    select company_id, id, '{}'::jsonb, 0.5, 'jev-client', 'jev-1.13.0' from public.transactions limit 1$$,
  '42501', null, 'a member cannot insert a suggestion'
);
select throws_ok(
  $$update public.tag_suggestions set confidence = 0$$,
  '42501', null, 'a member cannot update a suggestion'
);
select throws_ok(
  $$delete from public.tag_suggestions$$,
  '42501', null, 'a member cannot delete a suggestion'
);
select throws_ok(
  $$update public.company_integrations set enabled = true$$,
  '42501', null, 'a member cannot update the integration directly'
);
select throws_ok(
  $$select public.read_jev_api_key()$$,
  '42501', null, 'a member cannot call read_jev_api_key'
);
select throws_ok(
  $$select decrypted_secret from vault.decrypted_secrets where name = 'jev_api_key'$$,
  '42501', null, 'a member cannot read the Vault secret'
);

select is(
  (public.set_company_integration(true) ->> 'enabled')::boolean,
  true,
  'the owner enables Jev through the RPC'
);
select is(
  (select enabled from public.company_integrations),
  true,
  'the owner reads the enabled row back'
);
select is(
  ((public.set_company_integration(true, null, null) ->> 'mode')),
  'shadow',
  'omitted mode stays shadow'
);
select is(
  ((public.set_company_integration(true) ->> 'threshold')::numeric = 0.90),
  true,
  'omitted threshold stays 0.90'
);
select is(
  (public.set_company_integration(true, 'off', 0.95) ->> 'mode'),
  'off',
  'the owner can store off'
);
select is(
  ((public.set_company_integration(true, 'off', 0.95) ->> 'threshold')::numeric = 0.95),
  true,
  'the owner can store a threshold'
);
select throws_ok(
  $$select public.set_company_integration(true, 'manual', null)$$,
  'P0001', 'validation', 'a mode outside off, shadow and auto is refused by the RPC'
);
select throws_ok(
  $$select public.set_company_integration(true, 'shadow', 0.49)$$,
  'P0001', 'validation', 'a threshold below 0.50 is refused by the RPC'
);
select is(
  (select mode from public.company_integrations),
  'off',
  'a refused mode leaves the stored mode in place'
);
select is(
  (select threshold = 0.95 from public.company_integrations),
  true,
  'a refused threshold leaves the stored threshold in place'
);

select tests.authenticate_as('jev_other');

select is((select count(*)::int from public.company_integrations), 0, 'the other owner cannot read the integration');
select is((select count(*)::int from public.tag_suggestions), 1, 'the other owner reads only their suggestion');
select is(
  (select model_version from public.tag_suggestions),
  'jev-1.13.0',
  'the other owner reads their own model version'
);
select is(
  (public.set_company_integration(true) ->> 'company_id')::uuid,
  (select id from jev_ref where label = 'company_b'),
  'the RPC writes the caller company'
);

select tests.authenticate_as('jev_owner');
select is(
  (select enabled from public.company_integrations),
  true,
  'the owner still reads their own integration after the other owner writes'
);
select is(
  (select count(*)::int from public.tag_suggestions where confidence = 0.82),
  1,
  'the owner still reads their own suggestion'
);

select tests.authenticate_as('jev_none');
select throws_ok(
  $$select public.set_company_integration(true)$$,
  '42501', 'forbidden', 'a user with no company cannot enable Jev'
);

select tests.clear_authentication();
select throws_ok(
  $$select * from public.company_integrations$$,
  '42501', null, 'anon cannot read integrations'
);
select throws_ok(
  $$select * from public.tag_suggestions$$,
  '42501', null, 'anon cannot read suggestions'
);
select throws_ok(
  $$select public.set_company_integration(true)$$,
  '42501', null, 'anon cannot enable Jev'
);
select throws_ok(
  $$select public.read_jev_api_key()$$,
  '42501', null, 'anon cannot call read_jev_api_key'
);
select throws_ok(
  $$select decrypted_secret from vault.decrypted_secrets$$,
  '42501', null, 'anon cannot read Vault secrets'
);

reset role;
grant execute on function public.read_jev_api_key() to authenticated;
select tests.authenticate_as('jev_owner');
select throws_ok(
  $$select public.read_jev_api_key()$$,
  '42501', 'forbidden', 'a member who was granted execute still cannot read the key'
);
reset role;
revoke execute on function public.read_jev_api_key() from authenticated;

delete from jev_secret;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;
set role service_role;
insert into jev_secret select public.read_jev_api_key();
reset role;
select is(
  (select secret from jev_secret),
  'jev-test-secret',
  'service role still reads the Vault secret after the client denials'
);

select * from finish();
rollback;
