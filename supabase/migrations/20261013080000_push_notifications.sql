-- FLOW-502 (option A, the owner's pick 2026-10-09): web push, server part 1.
-- 1. push_subscriptions holds each device's Web Push endpoint and keys for a user;
--    notification_prefs holds the user's three opt-ins (new bank line, evening reminder,
--    Sunday summary), all off until the user turns one on, and whether the review-screen card
--    was answered. Both are per user, not per company. Browser roles reach them only through
--    the RPCs below.
-- 2. push_evening_targets() lists the devices to remind tonight: an owner who opted in, whose
--    company has open review lines, and who was not reminded today (Israel time). The count
--    comes from SQL (decision 0084). note_push_results() stamps the reminder and drops the
--    endpoints the push service says are gone.
-- 3. The flow-push-evening cron posts to the push-send function at 20:00 Israel time, only when
--    someone is due. It runs hourly and checks the Israel hour, so daylight saving needs no edit.
-- 4. upsert_connector_lines no longer counts a first-seen void line as inserted.
-- The VAPID keys are edge function secrets (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT);
-- their values are never in the repo.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Only the browsers' push services: the send function posts to this URL.
  constraint push_subscriptions_endpoint_https check (
    endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/[^\s]+$'
    and length(endpoint) <= 2048
  ),
  constraint push_subscriptions_p256dh check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  constraint push_subscriptions_auth check (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  constraint push_subscriptions_user_agent check (user_agent is null or length(user_agent) <= 300)
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

comment on table public.push_subscriptions is
  'FLOW-502: Web Push endpoints, one row per device. Written through push_subscribe and push_unsubscribe only; the send function reads them with the service role.';

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

create table public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  new_transaction boolean not null default false,
  evening_reminder boolean not null default false,
  weekly_summary boolean not null default false,
  prompt_answered_at timestamptz,
  evening_sent_on date,
  updated_at timestamptz not null default now()
);

comment on table public.notification_prefs is
  'FLOW-502: per-user push opt-ins. All off until the user turns one on. evening_sent_on is the Israel date of the last evening reminder.';

alter table public.notification_prefs enable row level security;
revoke all on public.notification_prefs from public, anon, authenticated;
grant select, insert, update, delete on public.notification_prefs to service_role;

create trigger push_subscriptions_touch
  before update on public.push_subscriptions
  for each row execute function private.touch_updated_at();

create trigger notification_prefs_touch
  before update on public.notification_prefs
  for each row execute function private.touch_updated_at();

create or replace function private.notification_prefs_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'new_transaction', coalesce(p.new_transaction, false),
    'evening_reminder', coalesce(p.evening_reminder, false),
    'weekly_summary', coalesce(p.weekly_summary, false),
    'prompt_answered', p.prompt_answered_at is not null,
    'has_subscription', exists (select 1 from public.push_subscriptions s where s.user_id = p_user)
  )
  from (select 1) as one
  left join public.notification_prefs p on p.user_id = p_user;
$$;

revoke all on function private.notification_prefs_json(uuid) from public, anon, authenticated;

create or replace function private.push_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return uid;
end;
$$;

revoke all on function private.push_user() from public, anon, authenticated;

create or replace function public.push_subscribe(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.push_user();
begin
  if p_endpoint is null
     or p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/[^\s]+$'
     or length(p_endpoint) > 2048 then
    raise exception 'invalid endpoint' using errcode = '22023';
  end if;
  if p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{80,100}$'
     or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{16,32}$' then
    raise exception 'invalid keys' using errcode = '22023';
  end if;
  -- One row per endpoint: a shared browser that signs in as another user moves to that user.
  -- The endpoint is the browser's own unguessable URL; a caller who copied someone else's
  -- could only stop their pushes, since the keys sent with it are the caller's.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (uid, p_endpoint, p_p256dh, p_auth, nullif(left(btrim(coalesce(p_user_agent, '')), 300), ''))
  on conflict (endpoint) do update
  set user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      updated_at = pg_catalog.now();
  -- At most 10 devices per user, newest kept, so one account cannot stall the evening run.
  delete from public.push_subscriptions s
  where s.user_id = uid
    and s.id not in (
      select k.id from public.push_subscriptions k
      where k.user_id = uid
      order by k.updated_at desc, k.id
      limit 10
    );
end;
$$;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.push_user();
begin
  delete from public.push_subscriptions s
  where s.user_id = uid
    and s.endpoint = p_endpoint;
end;
$$;

create or replace function public.get_notification_prefs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.notification_prefs_json(private.push_user());
end;
$$;

create or replace function public.set_notification_prefs(
  p_new_transaction boolean default null,
  p_evening_reminder boolean default null,
  p_weekly_summary boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.push_user();
begin
  insert into public.notification_prefs (user_id, new_transaction, evening_reminder, weekly_summary)
  values (uid, coalesce(p_new_transaction, false), coalesce(p_evening_reminder, false), coalesce(p_weekly_summary, false))
  on conflict (user_id) do update
  set new_transaction = coalesce(p_new_transaction, public.notification_prefs.new_transaction),
      evening_reminder = coalesce(p_evening_reminder, public.notification_prefs.evening_reminder),
      weekly_summary = coalesce(p_weekly_summary, public.notification_prefs.weekly_summary);
  return private.notification_prefs_json(uid);
end;
$$;

create or replace function public.answer_push_prompt(p_yes boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.push_user();
begin
  if p_yes is null then
    raise exception 'answer is required' using errcode = '22023';
  end if;
  insert into public.notification_prefs (user_id, evening_reminder, prompt_answered_at)
  values (uid, p_yes, pg_catalog.now())
  on conflict (user_id) do update
  set prompt_answered_at = pg_catalog.now(),
      evening_reminder = public.notification_prefs.evening_reminder or p_yes;
  return private.notification_prefs_json(uid);
end;
$$;

revoke all on function public.push_subscribe(text, text, text, text) from public, anon;
revoke all on function public.push_unsubscribe(text) from public, anon;
revoke all on function public.get_notification_prefs() from public, anon;
revoke all on function public.set_notification_prefs(boolean, boolean, boolean) from public, anon;
revoke all on function public.answer_push_prompt(boolean) from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;
grant execute on function public.get_notification_prefs() to authenticated;
grant execute on function public.set_notification_prefs(boolean, boolean, boolean) to authenticated;
grant execute on function public.answer_push_prompt(boolean) to authenticated;

-- Israel's date and hour, for the evening reminder.
create or replace function private.israel_now()
returns timestamp
language sql
stable
set search_path = ''
as $$ select pg_catalog.now() at time zone 'Asia/Jerusalem'; $$;

revoke all on function private.israel_now() from public, anon, authenticated;

create or replace function private.push_evening_due_users()
returns table (user_id uuid, waiting integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, w.waiting
  from public.notification_prefs p
  join public.companies c on c.owner_id = p.user_id
  cross join lateral (
    select count(*)::integer as waiting
    from public.review_queue q
    left join public.transactions rt on rt.id = q.transaction_id
    where q.company_id = c.id
      and q.status = 'open'
      and (rt.id is null or rt.removed_at is null)
  ) w
  where p.evening_reminder
    and p.evening_sent_on is distinct from private.israel_now()::date
    and w.waiting > 0
    and exists (select 1 from public.push_subscriptions s where s.user_id = p.user_id);
$$;

revoke all on function private.push_evening_due_users() from public, anon, authenticated;

-- The cron's gate: 20:00-20:59 in Israel and someone is due.
create or replace function private.push_evening_due()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select extract(hour from private.israel_now()) = 20
    and exists (select 1 from private.push_evening_due_users());
$$;

revoke all on function private.push_evening_due() from public, anon, authenticated;

create or replace function public.push_evening_targets()
returns table (user_id uuid, endpoint text, p256dh text, auth text, waiting integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select d.user_id, s.endpoint, s.p256dh, s.auth, d.waiting
  from private.push_evening_due_users() d
  cross join lateral (
    select k.endpoint, k.p256dh, k.auth
    from public.push_subscriptions k
    where k.user_id = d.user_id
    order by k.updated_at desc, k.id
    limit 10
  ) s
  order by d.user_id;
end;
$$;

create or replace function public.note_push_results(p_reminded uuid[], p_gone text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.notification_prefs p
  set evening_sent_on = private.israel_now()::date
  where p.user_id = any (coalesce(p_reminded, array[]::uuid[]));
  delete from public.push_subscriptions s
  where s.endpoint = any (coalesce(p_gone, array[]::text[]));
end;
$$;

revoke all on function public.push_evening_targets() from public, anon, authenticated;
revoke all on function public.note_push_results(uuid[], text[]) from public, anon, authenticated;
grant execute on function public.push_evening_targets() to service_role;
grant execute on function public.note_push_results(uuid[], text[]) to service_role;

-- Schedule flow-push-evening. It posts to push-send, next to sumit-sync in flow_sync_url, only
-- when private.push_evening_due() is true. Missing pg_cron, pg_net, cron_secret or
-- flow_sync_url skips the schedule with a notice, like flow-jev-tag.
create or replace function private.schedule_push_evening()
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
    raise notice 'flow-push-evening skipped: pg_cron or pg_net is missing';
    return;
  end if;
  if exists (select 1 from cron.job j where j.jobname = 'flow-push-evening') then
    perform cron.unschedule('flow-push-evening');
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
    raise notice 'flow-push-evening skipped: cron_secret or flow_sync_url is missing';
    return;
  end if;
  if position('/sumit-sync' in sync_url) = 0 then
    raise notice 'flow-push-evening skipped: flow_sync_url does not end in /sumit-sync';
    return;
  end if;

  perform cron.schedule(
    'flow-push-evening',
    '0 * * * *',
    $cron$
      select net.http_post(
        url := (
          select replace(decrypted_secret, '/sumit-sync', '/push-send')
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
        body := '{"kind":"evening"}'::jsonb
      )
      where private.push_evening_due();
    $cron$
  );
end;
$$;

revoke all on function private.schedule_push_evening() from public, anon, authenticated;
grant execute on function private.schedule_push_evening() to service_role;

do $schedule$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform private.schedule_push_evening();
end
$schedule$;

-- or replace: an earlier migration may leave its copy in the session.
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $patch$
declare
  def text;
  anchor text := $a$      into txn, assigned, project, role, net;
      result.inserted := result.inserted + 1;$a$;
begin
  def := pg_get_functiondef('public.upsert_connector_lines(uuid,public.connector_provider,jsonb,text,text)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'upsert_connector_lines is not the expected definition';
  end if;
  execute replace(def, anchor, $n$      into txn, assigned, project, role, net;
      -- FLOW-502: a line first seen as void is stored but is not a new line.
      if line_status is distinct from 'void' then
        result.inserted := result.inserted + 1;
      end if;$n$);
end
$patch$;

commit;
