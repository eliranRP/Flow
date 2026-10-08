-- FLOW-802: one health check for the daily GitHub run (decision 0151).
-- private.health(p_now) reads the queues, syncs, cron runs and usage, and returns
-- { ok, checked_at, alerts[] }. Each alert is { check, count, detail } with counts only: no
-- company names, ids or amounts, since the run's log is public. Read only; it changes nothing.
-- The thresholds are the constants below, so changing one is a one-line migration.

begin;

create function private.health(p_now timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := coalesce(p_now, pg_catalog.now());
  -- A refresh request nobody claimed after this long, or claimed and still open after
  -- claim_limit, is stuck.
  unclaimed_limit constant interval := interval '2 hours';
  claim_limit constant interval := interval '1 hour';
  -- A connection with no sync for this long is stale (the daily refresh runs every 24 hours).
  sync_limit constant interval := interval '36 hours';
  reject_limit constant integer := 3;
  -- An MCP sync_bank job still running after this long is stuck.
  job_limit constant interval := interval '30 minutes';
  -- Cron: a failed run in this window, or a job whose last run is older than its limit.
  cron_window constant interval := interval '24 hours';
  daily_limit constant interval := interval '26 hours';
  frequent_limit constant interval := interval '30 minutes';
  -- Usage: alert at this share of a limit. The free plan's database holds 500 MB.
  usage_share constant numeric := 0.8;
  db_limit_bytes constant bigint := 500 * 1024 * 1024;
  alerts jsonb := '[]'::jsonb;
  n integer;
  bytes bigint;
begin
  select count(*) into n
  from public.connector_refresh_requests r
  join public.connector_connections c on c.company_id = r.company_id and c.provider = r.provider
  where r.claimed_at is null
    and r.requested_at < now_at - unclaimed_limit
    and c.last_error is distinct from 'auth'
    and (c.next_attempt_at is null or c.next_attempt_at <= now_at);
  if n > 0 then
    alerts := alerts || jsonb_build_object('check', 'refresh_unclaimed', 'count', n,
      'detail', 'refresh requests waiting more than 2 hours for the drain');
  end if;

  select count(*) into n
  from public.connector_refresh_requests r
  where r.claimed_at is not null and r.claimed_at < now_at - claim_limit;
  if n > 0 then
    alerts := alerts || jsonb_build_object('check', 'refresh_claimed', 'count', n,
      'detail', 'refresh requests claimed more than 1 hour ago and not finished');
  end if;

  select count(*) into n
  from public.connector_connections c
  where coalesce(c.last_sync_at, c.created_at) < now_at - sync_limit;
  if n > 0 then
    alerts := alerts || jsonb_build_object('check', 'sync_stale', 'count', n,
      'detail', 'connections with no sync in 36 hours');
  end if;

  select count(*) into n
  from public.connector_connections c
  where c.last_error is not null or c.reject_attempts >= reject_limit;
  if n > 0 then
    alerts := alerts || jsonb_build_object('check', 'sync_error', 'count', n,
      'detail', 'connections whose last sync failed or was rejected 3 times');
  end if;

  select count(*) into n
  from private.mcp_sync_jobs j
  where j.state = 'running' and j.started_at < now_at - job_limit;
  if n > 0 then
    alerts := alerts || jsonb_build_object('check', 'mcp_sync_stuck', 'count', n,
      'detail', 'MCP sync_bank jobs running more than 30 minutes');
  end if;

  if to_regclass('cron.job_run_details') is not null then
    select count(*) into n
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
    where j.jobname like 'flow-%'
      and d.status = 'failed'
      and d.start_time >= now_at - cron_window;
    if n > 0 then
      alerts := alerts || jsonb_build_object('check', 'cron_failed', 'count', n,
        'detail', 'failed Flow cron runs in the last 24 hours');
    end if;

    -- A job with no run yet is left out, so a job added today does not alert.
    select count(*) into n
    from cron.job j
    join lateral (
      select max(d.start_time) as last_run
      from cron.job_run_details d
      where d.jobid = j.jobid
    ) r on r.last_run is not null
    where j.jobname like 'flow-%'
      and j.active
      and r.last_run < now_at - case
        when j.schedule like '*/%' then frequent_limit
        else daily_limit
      end;
    if n > 0 then
      alerts := alerts || jsonb_build_object('check', 'cron_late', 'count', n,
        'detail', 'Flow cron jobs that have not run on schedule');
    end if;
  end if;

  select count(*) into n
  from public.company_integrations i
  where i.provider = 'jev'
    and i.enabled
    and i.daily_call_cap > 0
    and private.jev_calls_today(i.company_id) >= usage_share * i.daily_call_cap;
  if n > 0 then
    alerts := alerts || jsonb_build_object('check', 'jev_cap', 'count', n,
      'detail', 'companies at 80% or more of their daily Jev call cap');
  end if;

  bytes := pg_catalog.pg_database_size(pg_catalog.current_database());
  if bytes >= usage_share * db_limit_bytes then
    alerts := alerts || jsonb_build_object('check', 'db_size', 'count', bytes / (1024 * 1024),
      'detail', 'database size in MB, at 80% or more of the free plan''s 500 MB');
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(alerts) = 0,
    'checked_at', now_at,
    'alerts', alerts
  );
end;
$$;

revoke all on function private.health(timestamptz) from public, anon, authenticated;
grant execute on function private.health(timestamptz) to service_role;
comment on function private.health(timestamptz) is
  'FLOW-802: stuck refresh requests, stale or failing syncs, stuck MCP sync jobs, failed or late cron runs, Jev calls near the cap and database size near the free plan. Counts only. Decision 0151.';

commit;
