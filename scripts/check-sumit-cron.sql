-- Read-only status for scripts/check-sumit-cron.sh.
-- One line: ok, bad-daily, or bad-drain.
-- The daily command is the connector refresh insert, copied exactly.
-- The drain command reads Vault flow_sync_url and Vault cron_secret.
-- It does not fall back to Kong and it does not embed a literal header.
with expected as (
  select $cron$
        insert into public.connector_refresh_requests (company_id, provider)
        select c.company_id, c.provider
        from public.connector_connections c
        where not exists (
          select 1 from public.connector_refresh_requests r
          where r.company_id = c.company_id
            and r.provider = c.provider
            and r.claimed_at is null
        );
      $cron$ as command
),
drain_expected as (
  select $cron$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'flow_sync_url'
          limit 1
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-flow-cron', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'cron_secret'
            limit 1
          )
        ),
        body := '{}'::jsonb
      )
      where exists (
        select 1
        from public.connector_refresh_requests r
        left join public.connector_connections c
          on c.company_id = r.company_id
         and c.provider = r.provider
        where r.claimed_at is null
          and (c.next_attempt_at is null or c.next_attempt_at <= now())
          and c.last_error is distinct from 'auth'
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
    end as has_secret,
    case
      when to_regclass('vault.decrypted_secrets') is null then false
      else exists (
        select 1
        from vault.decrypted_secrets
        where name = 'flow_sync_url'
          and btrim(decrypted_secret) <> ''
      )
    end as has_url
)
select case
  when (select count(*) from cron.job where jobname = 'flow-connector-daily') <> 1
    then 'bad-daily'
  when (
    select schedule from cron.job where jobname = 'flow-connector-daily'
  ) is distinct from '0 3 * * *'
    then 'bad-daily'
  when (
    select command from cron.job where jobname = 'flow-connector-daily'
  ) is distinct from (select command from expected)
    then 'bad-daily'
  when has_secret and has_net and not has_url
    then 'bad-drain'
  when has_secret and has_net and (
    select count(*) from cron.job where jobname = 'flow-connector-drain'
  ) <> 1
    then 'bad-drain'
  when has_secret and has_net and (
    select schedule from cron.job where jobname = 'flow-connector-drain'
  ) is distinct from '*/5 * * * *'
    then 'bad-drain'
  when has_secret and has_net and (
    select command from cron.job where jobname = 'flow-connector-drain'
  ) is distinct from (select command from drain_expected)
    then 'bad-drain'
  when not (has_secret and has_net) and exists (
    select 1 from cron.job where jobname = 'flow-connector-drain'
  )
    then 'bad-drain'
  else 'ok'
end
from flags;
