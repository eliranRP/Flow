-- FLOW-701 part 1 (Jev phase 1). Decision 0124.
-- Jev labels new review lines soon after each bank sync: a pg_cron job every 5 minutes
-- calls jev-tag only when an enabled company has an open line with no suggestion.
-- A daily call cap per company is enforced here, in SQL, because the provider has no
-- spend cap. Each run reserves calls before it calls Jev and records what it used.
-- A database lease lets one run at a time. A line Jev failed on waits 6 hours before
-- the job sends it again, so one bad line cannot spend the cap.
-- Jev still never approves a line (decision 0084).
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

alter table public.company_integrations
  add column daily_call_cap integer not null default 200;
alter table public.company_integrations
  add constraint company_integrations_daily_call_cap_chk
  check (daily_call_cap >= 0 and daily_call_cap <= 2000);
comment on column public.company_integrations.daily_call_cap is
  'Most Jev calls per company per UTC day. 0 stops calls. Enforced by jev_reserve_calls. Decision 0124.';

-- One row per company per run. reserved is what the run was allowed; calls is what it used.
-- A run that never finished still counts its reservation for that day.
create table public.jev_usage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  run_id uuid not null,
  usage_day date not null default ((now() at time zone 'utc')::date),
  reserved integer not null,
  calls integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  tagged integer not null default 0,
  failed integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (company_id, run_id),
  constraint jev_usage_reserved_chk check (reserved >= 0),
  constraint jev_usage_calls_chk check (calls >= 0 and calls <= reserved),
  constraint jev_usage_tokens_chk check (input_tokens >= 0 and output_tokens >= 0),
  constraint jev_usage_counts_chk check (tagged >= 0 and failed >= 0)
);
comment on table public.jev_usage is
  'Jev usage log: calls and token counts per company per run. No line text or answers. Decision 0124.';
create index jev_usage_company_day_idx on public.jev_usage (company_id, usage_day);

-- A line Jev failed on is not sent again before retry_after.
create table public.jev_line_failures (
  company_id uuid not null,
  transaction_id uuid not null,
  model_version text not null,
  attempts integer not null default 1,
  retry_after timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (transaction_id, model_version),
  constraint jev_line_failures_attempts_chk check (attempts >= 1),
  foreign key (company_id, transaction_id)
    references public.transactions (company_id, id)
    on delete cascade
);
comment on table public.jev_line_failures is
  'Lines the Jev job failed on, and when it may try again. Service role only. Decision 0124.';
create index jev_line_failures_company_idx on public.jev_line_failures (company_id);

create table private.jev_run_lease (
  singleton boolean primary key default true,
  holder uuid,
  expires_at timestamptz,
  constraint jev_run_lease_singleton_chk check (singleton)
);
insert into private.jev_run_lease (singleton) values (true) on conflict do nothing;

alter table public.jev_usage enable row level security;
alter table public.jev_line_failures enable row level security;

create policy jev_usage_member_select on public.jev_usage
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

revoke all on public.jev_usage from public, anon, authenticated;
revoke all on public.jev_line_failures from public, anon, authenticated;
revoke all on private.jev_run_lease from public, anon, authenticated;
grant select on public.jev_usage to authenticated;
grant select, insert, update, delete on public.jev_usage to service_role;
grant select, insert, update, delete on public.jev_line_failures to service_role;

-- Calls counted against today's cap: a finished run counts what it used, an open one
-- what it reserved.
create or replace function private.jev_calls_today(p_company uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case when u.finished_at is null then u.reserved else u.calls end), 0)::integer
  from public.jev_usage u
  where u.company_id = p_company
    and u.usage_day = (now() at time zone 'utc')::date;
$$;

revoke all on function private.jev_calls_today(uuid) from public, anon, authenticated;

-- Open expense lines the job would send now. The pin matches JEV_MODEL in jev.ts.
create or replace function private.jev_has_work()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_integrations ci
    join public.transactions t
      on t.company_id = ci.company_id
     and t.direction = 'expense'
     and t.removed_at is null
    join public.review_queue q
      on q.company_id = t.company_id
     and q.transaction_id = t.id
     and q.status = 'open'
    where ci.provider = 'jev'
      and ci.enabled
      and ci.mode in ('shadow', 'auto')
      and ci.daily_call_cap > private.jev_calls_today(ci.company_id)
      and not exists (
        select 1 from public.tag_suggestions s
        where s.transaction_id = t.id and s.model_version = 'jev-1.13.0'
      )
      and not exists (
        select 1 from public.jev_line_failures f
        where f.transaction_id = t.id
          and f.model_version = 'jev-1.13.0'
          and f.retry_after > now()
      )
  );
$$;

revoke all on function private.jev_has_work() from public, anon, authenticated;

-- One run at a time. A lease that expired can be taken by the next run.
create or replace function public.jev_take_lease(p_holder uuid, p_seconds integer default 150)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  taken boolean;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_holder is null then
    raise exception 'validation';
  end if;
  update private.jev_run_lease
  set holder = p_holder,
      expires_at = now() + make_interval(secs => least(greatest(coalesce(p_seconds, 150), 1), 600))
  where singleton
    and (holder is null or expires_at is null or expires_at <= now() or holder = p_holder)
  returning true into taken;
  return coalesce(taken, false);
end;
$$;

create or replace function public.jev_release_lease(p_holder uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update private.jev_run_lease
  set holder = null, expires_at = null
  where singleton and holder = p_holder;
end;
$$;

-- Reserve up to p_want calls for this run from today's cap. Returns how many were granted.
-- The integration row lock makes two runs for one company take turns. A run reserves once
-- per company: a second reserve after a grant above 0 is a conflict (a grant of 0 stores no row).
create or replace function public.jev_reserve_calls(p_company uuid, p_run uuid, p_want integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap integer;
  granted integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_company is null or p_run is null then
    raise exception 'validation';
  end if;
  if exists (select 1 from public.jev_usage u where u.company_id = p_company and u.run_id = p_run) then
    raise exception 'conflict';
  end if;
  if coalesce(p_want, 0) < 1 then
    return 0;
  end if;
  select ci.daily_call_cap into cap
  from public.company_integrations ci
  where ci.company_id = p_company
    and ci.provider = 'jev'
    and ci.enabled
    and ci.mode in ('shadow', 'auto')
  for update;
  if not found then
    return 0;
  end if;
  granted := greatest(0, least(p_want, cap - private.jev_calls_today(p_company)));
  if granted = 0 then
    return 0;
  end if;
  insert into public.jev_usage (company_id, run_id, reserved)
  values (p_company, p_run, granted);
  return granted;
end;
$$;

-- Record what the run used. Calls above the reservation are stored as the reservation.
create or replace function public.jev_finish_usage(
  p_company uuid,
  p_run uuid,
  p_calls integer,
  p_input_tokens bigint default 0,
  p_output_tokens bigint default 0,
  p_tagged integer default 0,
  p_failed integer default 0
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.jev_usage
  set calls = least(greatest(coalesce(p_calls, 0), 0), reserved),
      input_tokens = greatest(coalesce(p_input_tokens, 0), 0),
      output_tokens = greatest(coalesce(p_output_tokens, 0), 0),
      tagged = greatest(coalesce(p_tagged, 0), 0),
      failed = greatest(coalesce(p_failed, 0), 0),
      finished_at = now()
  where company_id = p_company
    and run_id = p_run
    and finished_at is null;
end;
$$;

-- A failed line waits 6 hours; the third failure and later wait a day.
create or replace function public.jev_mark_failed(p_company uuid, p_transaction uuid, p_model text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.jev_line_failures (company_id, transaction_id, model_version, attempts, retry_after)
  select t.company_id, t.id, p_model, 1, now() + interval '6 hours'
  from public.transactions t
  where t.company_id = p_company and t.id = p_transaction
  on conflict (transaction_id, model_version) do update
    set attempts = public.jev_line_failures.attempts + 1,
        retry_after = now() + case
          when public.jev_line_failures.attempts + 1 >= 3 then interval '24 hours'
          else interval '6 hours'
        end,
        updated_at = now();
end;
$$;

revoke all on function public.jev_take_lease(uuid, integer) from public, anon, authenticated;
revoke all on function public.jev_release_lease(uuid) from public, anon, authenticated;
revoke all on function public.jev_reserve_calls(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.jev_finish_usage(uuid, uuid, integer, bigint, bigint, integer, integer) from public, anon, authenticated;
revoke all on function public.jev_mark_failed(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.jev_take_lease(uuid, integer) to service_role;
grant execute on function public.jev_release_lease(uuid) to service_role;
grant execute on function public.jev_reserve_calls(uuid, uuid, integer) to service_role;
grant execute on function public.jev_finish_usage(uuid, uuid, integer, bigint, bigint, integer, integer) to service_role;
grant execute on function public.jev_mark_failed(uuid, uuid, text) to service_role;

-- MCP get_jev_status. The company is the token's company. Counts only, no line text.
create or replace function public.mcp_jev_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  integration public.company_integrations%rowtype;
  last_run timestamptz;
  waiting integer;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into integration
  from public.company_integrations ci
  where ci.company_id = cid and ci.provider = 'jev';
  select max(coalesce(u.finished_at, u.started_at)) into last_run
  from public.jev_usage u
  where u.company_id = cid;
  select count(*)::integer into waiting
  from public.transactions t
  join public.review_queue q
    on q.company_id = t.company_id
   and q.transaction_id = t.id
   and q.status = 'open'
  where t.company_id = cid
    and t.direction = 'expense'
    and t.removed_at is null
    and not exists (
      select 1 from public.tag_suggestions s
      where s.transaction_id = t.id and s.model_version = 'jev-1.13.0'
    );
  return jsonb_build_object(
    'enabled', coalesce(integration.enabled, false)
      and coalesce(integration.mode, 'off') in ('shadow', 'auto'),
    'mode', coalesce(integration.mode, 'off'),
    'threshold', coalesce(integration.threshold, 0.90),
    'daily_call_cap', coalesce(integration.daily_call_cap, 200),
    'calls_today', private.jev_calls_today(cid),
    'last_run_at', last_run,
    'lines_without_suggestion', waiting
  );
end;
$$;

revoke all on function public.mcp_jev_status() from public, anon;
grant execute on function public.mcp_jev_status() to authenticated, service_role;

-- Schedule flow-jev-tag. It posts to jev-tag, next to sumit-sync in flow_sync_url, only
-- when private.jev_has_work() is true. Missing pg_cron, pg_net, cron_secret or
-- flow_sync_url skips the schedule with a notice.
create or replace function private.schedule_jev_tag()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
  sync_url text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'flow-jev-tag skipped: pg_cron or pg_net is missing';
    return;
  end if;
  if exists (select 1 from cron.job j where j.jobname = 'flow-jev-tag') then
    perform cron.unschedule('flow-jev-tag');
  end if;

  begin
    execute $sql$
      select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1
    $sql$ into secret;
    execute $sql$
      select decrypted_secret from vault.decrypted_secrets where name = 'flow_sync_url' limit 1
    $sql$ into sync_url;
  exception
    when undefined_table or invalid_schema_name then
      secret := null;
      sync_url := null;
  end;

  if secret is null or btrim(secret) = '' or sync_url is null or btrim(sync_url) = '' then
    raise notice 'flow-jev-tag skipped: cron_secret or flow_sync_url is missing';
    return;
  end if;
  -- The job URL is derived from the sumit-sync URL. Without that path it would post to
  -- the wrong function, so it does not schedule.
  if position('/sumit-sync' in sync_url) = 0 then
    raise notice 'flow-jev-tag skipped: flow_sync_url does not end in /sumit-sync';
    return;
  end if;

  perform cron.schedule(
    'flow-jev-tag',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url := (
          select replace(decrypted_secret, '/sumit-sync', '/jev-tag')
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
      where private.jev_has_work();
    $cron$
  );
end;
$$;

revoke all on function private.schedule_jev_tag() from public, anon, authenticated;
grant execute on function private.schedule_jev_tag() to service_role;

do $schedule$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform private.schedule_jev_tag();
end
$schedule$;

commit;
