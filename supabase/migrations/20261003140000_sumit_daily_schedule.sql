-- flow-sumit-daily was scheduled in 20260928140000_phase1_slice.sql, before pg_cron
-- existed, so the job was never stored. This recreates it. The insert is the
-- same command. A missing pg_cron fails the migration.

create or replace function private.schedule_sumit_daily()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'flow-sumit-daily requires pg_cron';
  end if;

  if exists (
    select 1
    from cron.job
    where jobname = 'flow-sumit-daily'
      and username = current_user
  ) then
    perform cron.unschedule('flow-sumit-daily');
  end if;

  perform cron.schedule(
    'flow-sumit-daily',
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
end;
$$;

revoke all on function private.schedule_sumit_daily() from public, anon, authenticated;
grant execute on function private.schedule_sumit_daily() to service_role;

select private.schedule_sumit_daily();
