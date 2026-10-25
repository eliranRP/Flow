-- flow-connector-daily is 03:00 UTC and queues one unclaimed refresh per company and provider, Mercury
-- aside; flow-mercury-refresh queues Mercury at 03:00, 11:00 and 19:00 UTC. Re-running the schedule
-- leaves one of each.

begin;

select plan(18);

select set_config('request.jwt.claim.role', 'service_role', true);

create temp table sumit_daily_expected (schedule text, command text);
insert into sumit_daily_expected (schedule, command) values (
  '0 3 * * *',
  $cron$
        insert into public.connector_refresh_requests (company_id, provider)
        select distinct c.company_id, c.provider
        from public.connector_connections c
        where c.provider <> 'mercury'
          and not exists (
          select 1 from public.connector_refresh_requests r
          where r.company_id = c.company_id
            and r.provider = c.provider
            and r.claimed_at is null
        );
      $cron$
);

create temp table mercury_refresh_expected (schedule text, command text);
insert into mercury_refresh_expected (schedule, command) values (
  '0 3,11,19 * * *',
  $cron$
        insert into public.connector_refresh_requests (company_id, provider)
        select distinct c.company_id, c.provider
        from public.connector_connections c
        where c.provider = 'mercury'
          and not exists (
          select 1 from public.connector_refresh_requests r
          where r.company_id = c.company_id
            and r.provider = c.provider
            and r.claimed_at is null
        );
      $cron$
);

select ok(
  exists (select 1 from pg_extension where extname = 'pg_cron'),
  'pg_cron is installed'
);

select is(
  (select count(*)::int from cron.job where jobname = 'flow-connector-daily'),
  1,
  'flow-connector-daily exists once'
);

select results_eq(
  $$select schedule, command from cron.job where jobname = 'flow-connector-daily' order by jobid$$,
  $$select schedule, command from sumit_daily_expected$$,
  'flow-connector-daily is 03:00 UTC and queues one unclaimed refresh per company and provider, Mercury aside'
);

select is(
  (select count(*)::int from cron.job where jobname = 'flow-mercury-refresh'),
  1,
  'flow-mercury-refresh exists once'
);

select results_eq(
  $$select schedule, command from cron.job where jobname = 'flow-mercury-refresh' order by jobid$$,
  $$select schedule, command from mercury_refresh_expected$$,
  'flow-mercury-refresh is 03:00, 11:00 and 19:00 UTC and queues Mercury only'
);

select ok(
  (select pg_get_functiondef('private.schedule_connector_jobs()'::regprocedure)
    like '%raise exception ''flow-connector-daily requires pg_cron''%'),
  'a missing pg_cron fails the daily schedule'
);

select is(
  (select proconfig[1] from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'schedule_connector_jobs'),
  'search_path=""',
  'schedule_connector_jobs pins an empty search_path'
);

select ok(
  (select prosecdef from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'schedule_connector_jobs'),
  'schedule_connector_jobs is security definer'
);

select ok(
  not has_function_privilege('anon', 'private.schedule_connector_jobs()', 'execute')
  and not has_function_privilege('authenticated', 'private.schedule_connector_jobs()', 'execute')
  and has_function_privilege('service_role', 'private.schedule_connector_jobs()', 'execute'),
  'only the service role can schedule the daily job'
);

select lives_ok(
  $$select cron.unschedule('flow-connector-daily')$$,
  'the test unschedules flow-connector-daily'
);

select lives_ok(
  $$select private.schedule_connector_jobs()$$,
  'scheduling creates flow-connector-daily when it is absent'
);

select is(
  (select count(*)::int from cron.job where jobname = 'flow-connector-daily'),
  1,
  'creating the missing job leaves one row'
);

select results_eq(
  $$select schedule, command from cron.job where jobname = 'flow-connector-daily' order by jobid$$,
  $$select schedule, command from sumit_daily_expected$$,
  'the created job keeps 03:00 UTC and the refresh command'
);

select lives_ok(
  $$select private.schedule_connector_jobs()$$,
  'scheduling again unschedules the existing job and creates it once'
);

select is(
  (select count(*)::int from cron.job where jobname = 'flow-connector-daily'),
  1,
  'a second schedule leaves one flow-connector-daily job'
);

select results_eq(
  $$select schedule, command from cron.job where jobname = 'flow-connector-daily' order by jobid$$,
  $$select schedule, command from sumit_daily_expected$$,
  'a second schedule keeps 03:00 UTC and the refresh command'
);

select is(
  (select count(*)::int from cron.job where jobname = 'flow-mercury-refresh'),
  1,
  'a second schedule leaves one flow-mercury-refresh job'
);

select results_eq(
  $$select schedule, command from cron.job where jobname = 'flow-mercury-refresh' order by jobid$$,
  $$select schedule, command from mercury_refresh_expected$$,
  'a second schedule keeps the Mercury times and command'
);

select * from finish();
rollback;
