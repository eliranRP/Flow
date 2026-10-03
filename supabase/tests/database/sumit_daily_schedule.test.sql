-- flow-sumit-daily is 03:00 UTC and queues one unclaimed refresh per SUMIT connection.
-- The command is the phase 1 insert. Re-running the schedule leaves one job.

begin;

select plan(14);

create temp table sumit_daily_expected (schedule text, command text);
insert into sumit_daily_expected (schedule, command) values (
  '0 3 * * *',
  $cron$
        insert into public.sumit_refresh_requests (company_id)
        select s.company_id
        from public.sumit_connections s
        where not exists (
          select 1 from public.sumit_refresh_requests r
          where r.company_id = s.company_id and r.claimed_at is null
        );
      $cron$
);

select ok(
  exists (select 1 from pg_extension where extname = 'pg_cron'),
  'pg_cron is installed'
);

select is(
  (select count(*)::int from cron.job where jobname = 'flow-sumit-daily'),
  1,
  'flow-sumit-daily exists once'
);

select results_eq(
  $$select schedule, command from cron.job where jobname = 'flow-sumit-daily' order by jobid$$,
  $$select schedule, command from sumit_daily_expected$$,
  'flow-sumit-daily is 03:00 UTC and queues one unclaimed refresh per connection'
);

select ok(
  (select pg_get_functiondef('private.schedule_sumit_daily()'::regprocedure)
    like '%raise exception ''flow-sumit-daily requires pg_cron''%'),
  'a missing pg_cron fails the daily schedule'
);

select is(
  (select proconfig[1] from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'schedule_sumit_daily'),
  'search_path=""',
  'schedule_sumit_daily pins an empty search_path'
);

select ok(
  (select prosecdef from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'schedule_sumit_daily'),
  'schedule_sumit_daily is security definer'
);

select ok(
  not has_function_privilege('anon', 'private.schedule_sumit_daily()', 'execute')
  and not has_function_privilege('authenticated', 'private.schedule_sumit_daily()', 'execute')
  and has_function_privilege('service_role', 'private.schedule_sumit_daily()', 'execute'),
  'only the service role can schedule the daily job'
);

select lives_ok(
  $$select cron.unschedule('flow-sumit-daily')$$,
  'the test unschedules flow-sumit-daily'
);

select lives_ok(
  $$select private.schedule_sumit_daily()$$,
  'scheduling creates flow-sumit-daily when it is absent'
);

select is(
  (select count(*)::int from cron.job where jobname = 'flow-sumit-daily'),
  1,
  'creating the missing job leaves one row'
);

select results_eq(
  $$select schedule, command from cron.job where jobname = 'flow-sumit-daily' order by jobid$$,
  $$select schedule, command from sumit_daily_expected$$,
  'the created job keeps 03:00 UTC and the refresh command'
);

select lives_ok(
  $$select private.schedule_sumit_daily()$$,
  'scheduling again unschedules the existing job and creates it once'
);

select is(
  (select count(*)::int from cron.job where jobname = 'flow-sumit-daily'),
  1,
  'a second schedule leaves one flow-sumit-daily job'
);

select results_eq(
  $$select schedule, command from cron.job where jobname = 'flow-sumit-daily' order by jobid$$,
  $$select schedule, command from sumit_daily_expected$$,
  'a second schedule keeps 03:00 UTC and the refresh command'
);

select * from finish();
rollback;
