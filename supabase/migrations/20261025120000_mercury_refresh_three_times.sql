-- Mercury refreshes three times a day (owner, 2026-10-25): 03:00, 11:00 and 19:00 UTC
-- (05:00, 13:00 and 21:00 in Israel in winter). SUMIT keeps its one refresh at 03:00.
-- 1. flow-connector-daily queues every provider but Mercury.
-- 2. flow-mercury-refresh queues Mercury at the three times, with the same one-open-request rule.
-- private.schedule_connector_jobs is patched in place, so its grants stay.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- or replace: an earlier migration may leave its copy in the session.
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $patch$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('private.schedule_connector_jobs()'::regprocedure);

  anchor := $a$ARRAY['flow-sumit-daily', 'flow-sumit-drain', 'flow-connector-daily', 'flow-connector-drain']$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'schedule_connector_jobs is not the expected definition (job names)';
  end if;
  def := replace(def, anchor, $n$ARRAY['flow-sumit-daily', 'flow-sumit-drain', 'flow-connector-daily', 'flow-connector-drain', 'flow-mercury-refresh']$n$);

  anchor := $a$        select distinct c.company_id, c.provider
        from public.connector_connections c
        where not exists ($a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'schedule_connector_jobs is not the expected definition (daily job)';
  end if;
  def := replace(def, anchor, $n$        select distinct c.company_id, c.provider
        from public.connector_connections c
        where c.provider <> 'mercury'
          and not exists ($n$);

  anchor := $a$  if not exists (select 1 from pg_extension where extname = 'pg_net') then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'schedule_connector_jobs is not the expected definition (drain guard)';
  end if;
  def := replace(def, anchor, $n$  perform cron.schedule(
    'flow-mercury-refresh',
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

$n$ || anchor);

  execute def;
end
$patch$;

drop function pg_temp.anchor_count(text, text);

-- Reschedule with the new jobs.
do $schedule$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform private.schedule_connector_jobs();
end
$schedule$;

commit;
