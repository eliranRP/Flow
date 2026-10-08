-- FLOW-701 part 1 (decision 0124). Jev after each sync: the daily call cap, the usage
-- log, the run lease, failed-line retries, the cron work check and MCP get_jev_status.
-- Helpers come from supabase/tests/helpers.sql.

begin;

select plan(55);

do $users$
begin
  perform tests.create_supabase_user('jas_owner');
  perform tests.create_supabase_user('jas_other');
end
$users$;

select tests.authenticate_as('jas_owner');
select lives_ok($$select public.create_company('עסק א', true)$$, 'owner creates a company');
select tests.authenticate_as('jas_other');
select lives_ok($$select public.create_company('עסק ב', true)$$, 'other owner creates a company');
reset role;

create temp table jas_ref (label text primary key, id uuid);
grant all on jas_ref to anon, authenticated, service_role;

insert into jas_ref (label, id)
select 'company_a', c.id
from public.companies c
join auth.users u on u.id = c.owner_id
where u.raw_user_meta_data ->> 'test_identifier' = 'jas_owner';
insert into jas_ref (label, id)
select 'company_b', c.id
from public.companies c
join auth.users u on u.id = c.owner_id
where u.raw_user_meta_data ->> 'test_identifier' = 'jas_other';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'project',
  -11800, -10000, -1800, 'assumed',
  '2026-04-12', null, 'sumit', 'sumit:jas-a', 'בלוקים'
from jas_ref where label = 'company_a';
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'project',
  -23600, -20000, -3600, 'assumed',
  '2026-04-12', null, 'sumit', 'sumit:jas-b', 'מלט'
from jas_ref where label = 'company_b';

insert into jas_ref (label, id)
select 'txn_a', id from public.transactions where idempotency_key = 'sumit:jas-a';
insert into jas_ref (label, id)
select 'txn_b', id from public.transactions where idempotency_key = 'sumit:jas-b';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'test'
from public.transactions t
where t.idempotency_key in ('sumit:jas-a', 'sumit:jas-b')
  and not exists (select 1 from public.review_queue q where q.transaction_id = t.id);
update public.review_queue q
set status = 'open'
from public.transactions t
where t.id = q.transaction_id and t.idempotency_key in ('sumit:jas-a', 'sumit:jas-b');

-- Shape and permissions.
select has_table('public', 'jev_usage', 'jev_usage exists');
select has_table('public', 'jev_line_failures', 'jev_line_failures exists');
select col_default_is('public', 'company_integrations', 'daily_call_cap', '200', 'the daily cap defaults to 200');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.jev_usage'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.jev_line_failures'::regclass),
  'both tables have row level security'
);
select ok(
  has_table_privilege('authenticated', 'public.jev_usage', 'select')
  and not has_table_privilege('authenticated', 'public.jev_usage', 'insert')
  and not has_table_privilege('authenticated', 'public.jev_usage', 'update')
  and not has_table_privilege('anon', 'public.jev_usage', 'select'),
  'members only read the usage log'
);
select ok(
  not has_table_privilege('authenticated', 'public.jev_line_failures', 'select')
  and not has_table_privilege('anon', 'public.jev_line_failures', 'select')
  and has_table_privilege('service_role', 'public.jev_line_failures', 'insert'),
  'failed lines are service role only'
);
select ok(
  not has_function_privilege('authenticated', 'public.jev_take_lease(uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.jev_take_lease(uuid, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.jev_release_lease(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.jev_reserve_calls(uuid, uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.jev_reserve_calls(uuid, uuid, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.jev_finish_usage(uuid, uuid, integer, bigint, bigint, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.jev_mark_failed(uuid, uuid, text)', 'execute'),
  'members and anon cannot run the job functions'
);
select ok(
  has_function_privilege('service_role', 'public.jev_take_lease(uuid, integer)', 'execute')
  and has_function_privilege('service_role', 'public.jev_reserve_calls(uuid, uuid, integer)', 'execute')
  and has_function_privilege('service_role', 'public.jev_finish_usage(uuid, uuid, integer, bigint, bigint, integer, integer)', 'execute')
  and has_function_privilege('service_role', 'public.jev_mark_failed(uuid, uuid, text)', 'execute'),
  'the service role runs the job functions'
);
select ok(
  has_function_privilege('authenticated', 'public.mcp_jev_status()', 'execute')
  and not has_function_privilege('anon', 'public.mcp_jev_status()', 'execute'),
  'members read get_jev_status, anon does not'
);
select ok(
  not has_function_privilege('authenticated', 'private.jev_has_work()', 'execute')
  and not has_function_privilege('authenticated', 'private.schedule_jev_tag()', 'execute'),
  'members cannot run the work check or the scheduler'
);

-- A member JWT is refused inside the function too.
select tests.authenticate_as('jas_owner');
select throws_ok(
  $$select public.jev_reserve_calls((select id from jas_ref where label = 'company_a'), gen_random_uuid(), 1)$$,
  '42501', null, 'a member cannot reserve calls'
);
reset role;

-- The service role claim from here until the member checks. The session stays postgres,
-- so these exercise the functions; execute grants are checked above.
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;

select is(
  public.jev_reserve_calls((select id from jas_ref where label = 'company_a'), gen_random_uuid(), 3),
  0, 'a company with no integration row gets no calls'
);
reset role;

insert into public.company_integrations (company_id, provider, enabled, mode, threshold, daily_call_cap)
select id, 'jev', true, 'shadow', 0.9, 5 from jas_ref where label = 'company_a';
insert into public.company_integrations (company_id, provider, enabled, mode, threshold)
select id, 'jev', false, 'shadow', 0.9 from jas_ref where label = 'company_b';

select throws_ok(
  $$update public.company_integrations set daily_call_cap = 2001 where provider = 'jev'$$,
  '23514', null, 'a cap above 2000 is refused'
);
select throws_ok(
  $$update public.company_integrations set daily_call_cap = -1 where provider = 'jev'$$,
  '23514', null, 'a negative cap is refused'
);

insert into jas_ref (label, id) values
  ('run_1', gen_random_uuid()), ('run_2', gen_random_uuid()), ('run_3', gen_random_uuid()),
  ('run_4', gen_random_uuid()), ('holder_1', gen_random_uuid()), ('holder_2', gen_random_uuid()),
  ('holder_3', gen_random_uuid());

select is(
  public.jev_reserve_calls((select id from jas_ref where label = 'company_a'), (select id from jas_ref where label = 'run_1'), 3),
  3, 'the first run gets all it asked for'
);
select is(
  public.jev_reserve_calls((select id from jas_ref where label = 'company_a'), (select id from jas_ref where label = 'run_2'), 4),
  2, 'the next run gets what is left of the cap'
);
select is(
  public.jev_reserve_calls((select id from jas_ref where label = 'company_a'), (select id from jas_ref where label = 'run_3'), 1),
  0, 'a spent cap grants nothing'
);
select is(
  (select count(*)::integer from public.jev_usage where run_id = (select id from jas_ref where label = 'run_3')),
  0, 'a run granted nothing leaves no usage row'
);
select throws_ok(
  $$select public.jev_reserve_calls((select id from jas_ref where label = 'company_a'), (select id from jas_ref where label = 'run_1'), 1)$$,
  'P0001', 'conflict', 'a run cannot reserve twice for one company'
);
select is(
  public.jev_reserve_calls((select id from jas_ref where label = 'company_a'), (select id from jas_ref where label = 'run_4'), 0),
  0, 'asking for nothing grants nothing'
);
select lives_ok(
  $$select public.jev_finish_usage(
    (select id from jas_ref where label = 'company_a'), (select id from jas_ref where label = 'run_1'),
    1, 120, 30, 1, 0)$$,
  'a run records what it used'
);
select is(
  (select calls || '/' || reserved || '/' || input_tokens || '/' || output_tokens || '/' || tagged
     from public.jev_usage where run_id = (select id from jas_ref where label = 'run_1')),
  '1/3/120/30/1', 'the usage row keeps calls, reservation, tokens and tagged lines'
);
select is(
  public.jev_reserve_calls((select id from jas_ref where label = 'company_a'), (select id from jas_ref where label = 'run_4'), 9),
  2, 'unused reserved calls go back to the cap once the run finishes'
);
select lives_ok(
  $$select public.jev_finish_usage(
    (select id from jas_ref where label = 'company_a'), (select id from jas_ref where label = 'run_4'),
    99, 1, 1, 0, 0)$$,
  'a finish above the reservation is accepted'
);
select is(
  (select calls from public.jev_usage where run_id = (select id from jas_ref where label = 'run_4')),
  2, 'calls are stored as at most the reservation'
);
select lives_ok(
  $$select public.jev_finish_usage(
    (select id from jas_ref where label = 'company_a'), (select id from jas_ref where label = 'run_4'),
    0, 0, 0, 0, 0)$$,
  'a second finish is a no-op'
);
select is(
  (select calls from public.jev_usage where run_id = (select id from jas_ref where label = 'run_4')),
  2, 'a finished run is not rewritten'
);
select is(
  public.jev_reserve_calls((select id from jas_ref where label = 'company_b'), gen_random_uuid(), 3),
  0, 'a disabled company gets no calls'
);
reset role;
update public.company_integrations set enabled = true, mode = 'off'
where company_id = (select id from jas_ref where label = 'company_b');
select is(
  public.jev_reserve_calls((select id from jas_ref where label = 'company_b'), gen_random_uuid(), 3),
  0, 'mode off gets no calls'
);

-- Lease.
select ok(public.jev_take_lease((select id from jas_ref where label = 'holder_1'), 150), 'a free lease is taken');
select ok(not public.jev_take_lease((select id from jas_ref where label = 'holder_2'), 150), 'a held lease is refused');
select ok(public.jev_take_lease((select id from jas_ref where label = 'holder_1'), 150), 'the holder may renew it');
select lives_ok($$select public.jev_release_lease((select id from jas_ref where label = 'holder_2'))$$, 'another holder releasing is a no-op');
select ok(not public.jev_take_lease((select id from jas_ref where label = 'holder_2'), 150), 'the lease is still held');
select lives_ok($$select public.jev_release_lease((select id from jas_ref where label = 'holder_1'))$$, 'the holder releases');
select ok(public.jev_take_lease((select id from jas_ref where label = 'holder_2'), 150), 'a released lease is taken');
reset role;
update private.jev_run_lease set expires_at = now() - interval '1 second';
select ok(public.jev_take_lease((select id from jas_ref where label = 'holder_3'), 150), 'an expired lease is taken');
select throws_ok($$select public.jev_take_lease(null, 150)$$, 'P0001', 'validation', 'a null holder is refused');
reset role;

-- Work check and failed lines. Company A has an open untagged line, but its cap is spent.
select ok(not private.jev_has_work(), 'no work while the only enabled company has spent its cap');
update public.company_integrations set daily_call_cap = 100
where company_id = (select id from jas_ref where label = 'company_a');
select ok(private.jev_has_work(), 'an open untagged line with cap left is work');

insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
select (select id from jas_ref where label = 'company_a'), id, '{}'::jsonb, 0.5, 'jev-1.13.0', 'jev-1.13.0'
from jas_ref where label = 'txn_a';
select ok(not private.jev_has_work(), 'a labelled line is not work');
delete from public.tag_suggestions where transaction_id = (select id from jas_ref where label = 'txn_a');

select lives_ok(
  $$select public.jev_mark_failed((select id from jas_ref where label = 'company_a'), (select id from jas_ref where label = 'txn_a'), 'jev-1.13.0')$$,
  'the job marks a failed line'
);
reset role;
select ok(not private.jev_has_work(), 'a failed line waits for its retry time');
select ok(
  (select retry_after between now() + interval '5 hours 59 minutes' and now() + interval '6 hours 1 minute'
     from public.jev_line_failures where transaction_id = (select id from jas_ref where label = 'txn_a')),
  'the first failure waits 6 hours'
);
select public.jev_mark_failed((select id from jas_ref where label = 'company_a'), (select id from jas_ref where label = 'txn_a'), 'jev-1.13.0');
select public.jev_mark_failed((select id from jas_ref where label = 'company_a'), (select id from jas_ref where label = 'txn_a'), 'jev-1.13.0');
reset role;
select is(
  (select attempts || ':' || (retry_after > now() + interval '23 hours')::text
     from public.jev_line_failures where transaction_id = (select id from jas_ref where label = 'txn_a')),
  '3:true', 'the third failure waits a day'
);
update public.jev_line_failures set retry_after = now() - interval '1 second'
where transaction_id = (select id from jas_ref where label = 'txn_a');
select ok(private.jev_has_work(), 'a failed line past its retry time is work again');

select lives_ok(
  $$select public.jev_mark_failed((select id from jas_ref where label = 'company_a'), (select id from jas_ref where label = 'txn_b'), 'jev-1.13.0')$$,
  'a line from another company does not fail the call'
);
reset role;
select is(
  (select count(*)::integer from public.jev_line_failures where transaction_id = (select id from jas_ref where label = 'txn_b')),
  0, 'but it is not marked under the wrong company'
);

-- Members read their own usage, and get_jev_status counts it.
select tests.authenticate_as('jas_owner');
select is(
  (select count(*)::integer from public.jev_usage),
  3, 'the owner sees their own usage rows'
);
select is(
  (public.mcp_jev_status() ->> 'calls_today')::integer,
  5, 'get_jev_status counts used calls and the open reservation'
);
select is(
  (select jsonb_build_object(
     'enabled', s -> 'enabled', 'mode', s -> 'mode', 'daily_call_cap', s -> 'daily_call_cap',
     'lines_without_suggestion', s -> 'lines_without_suggestion', 'has_last_run', s -> 'last_run_at' <> 'null'::jsonb)
   from (select public.mcp_jev_status() as s) x),
  '{"enabled": true, "mode": "shadow", "daily_call_cap": 100, "lines_without_suggestion": 1, "has_last_run": true}'::jsonb,
  'get_jev_status reports the setting, the cap and the waiting line'
);
select tests.authenticate_as('jas_other');
select is(
  (select count(*)::integer from public.jev_usage),
  0, 'another company sees none of those rows'
);
select is(
  (select jsonb_build_object('enabled', s -> 'enabled', 'calls_today', s -> 'calls_today', 'lines', s -> 'lines_without_suggestion')
   from (select public.mcp_jev_status() as s) x),
  '{"enabled": false, "calls_today": 0, "lines": 1}'::jsonb,
  'get_jev_status for the other company counts only its own'
);
reset role;

select * from finish();
rollback;
