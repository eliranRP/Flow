-- Read-only status for scripts/check-sumit-cron.sh.
-- One line: ok, bad-daily, or bad-drain.
-- The daily command is the phase 1 insert, copied exactly.
with expected as (
  select $cron$
        insert into public.sumit_refresh_requests (company_id)
        select s.company_id
        from public.sumit_connections s
        where not exists (
          select 1 from public.sumit_refresh_requests r
          where r.company_id = s.company_id and r.claimed_at is null
        );
      $cron$ as command
),
flags as (
  select
    exists (select 1 from pg_extension where extname = 'pg_net') as has_net,
    case
      when to_regclass('vault.decrypted_secrets') is null then false
      else exists (
        select 1
        from vault.decrypted_secrets
        where name = 'cron_secret'
          and btrim(decrypted_secret) <> ''
      )
    end as has_secret
)
select case
  when (select count(*) from cron.job where jobname = 'flow-sumit-daily') <> 1
    then 'bad-daily'
  when (
    select schedule from cron.job where jobname = 'flow-sumit-daily'
  ) is distinct from '0 3 * * *'
    then 'bad-daily'
  when (
    select command from cron.job where jobname = 'flow-sumit-daily'
  ) is distinct from (select command from expected)
    then 'bad-daily'
  when has_secret and has_net and (
    select count(*) from cron.job where jobname = 'flow-sumit-drain'
  ) <> 1
    then 'bad-drain'
  when has_secret and has_net and (
    select schedule from cron.job where jobname = 'flow-sumit-drain'
  ) is distinct from '*/5 * * * *'
    then 'bad-drain'
  when not (has_secret and has_net) and exists (
    select 1 from cron.job where jobname = 'flow-sumit-drain'
  )
    then 'bad-drain'
  else 'ok'
end
from flags;
