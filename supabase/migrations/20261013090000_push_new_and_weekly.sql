-- FLOW-502 server part 2: the תנועה חדשה push after a sync and the סיכום שבועי push on Sunday
-- morning. Both read their counts from SQL (decision 0084) and say nothing about amounts, so a
-- locked phone shows no money. The evening due list now reads the shared open-review count.
-- One transaction: begin is first, commit is last.

begin;

set local lock_timeout = '5s';

alter table public.notification_prefs
  add column new_line_mark timestamptz,
  add column weekly_sent_on date;

comment on column public.notification_prefs.new_line_mark is
  'FLOW-502: lines created after this are new for the תנועה חדשה push. Set when the switch turns on and when a push is claimed.';
-- Users who turned תנועה חדשה on before this start counting now, not from a day back.
update public.notification_prefs set new_line_mark = pg_catalog.now() where new_transaction;

comment on column public.notification_prefs.weekly_sent_on is
  'FLOW-502: the Israel date of the last סיכום שבועי claimed for this user.';

-- Turning תנועה חדשה on starts counting from now, so old lines never arrive as new.
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
  insert into public.notification_prefs (user_id, new_transaction, evening_reminder, weekly_summary, new_line_mark)
  values (
    uid,
    coalesce(p_new_transaction, false),
    coalesce(p_evening_reminder, false),
    coalesce(p_weekly_summary, false),
    case when p_new_transaction then pg_catalog.now() end
  )
  on conflict (user_id) do update
  set new_transaction = coalesce(p_new_transaction, public.notification_prefs.new_transaction),
      evening_reminder = coalesce(p_evening_reminder, public.notification_prefs.evening_reminder),
      weekly_summary = coalesce(p_weekly_summary, public.notification_prefs.weekly_summary),
      new_line_mark = case
        when p_new_transaction and not public.notification_prefs.new_transaction then pg_catalog.now()
        else public.notification_prefs.new_line_mark
      end;
  return private.notification_prefs_json(uid);
end;
$$;

-- Open review lines per owner (an owner has one company; the sum keeps one row per owner).
create or replace function private.push_waiting_by_owner()
returns table (user_id uuid, waiting integer)
language sql
stable
security definer
set search_path = ''
as $$
  select c.owner_id, count(*)::integer
  from public.review_queue q
  join public.companies c on c.id = q.company_id
  left join public.transactions rt on rt.id = q.transaction_id
  where q.status = 'open'
    and (rt.id is null or rt.removed_at is null)
  group by c.owner_id;
$$;

-- Bank and SUMIT lines an owner's companies got after p_since (void and removed lines left out).
create or replace function private.push_fresh_lines(p_user uuid, p_since timestamptz)
returns table (fresh integer, upto timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer, max(t.created_at)
  from public.transactions t
  join public.companies c on c.id = t.company_id
  where c.owner_id = p_user
    and private.is_connector_source(t.source)
    and t.line_status is distinct from 'void'
    and t.removed_at is null
    and t.created_at > p_since;
$$;

create or replace function private.push_evening_due_users()
returns table (user_id uuid, waiting integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, w.waiting
  from public.notification_prefs p
  join private.push_waiting_by_owner() w on w.user_id = p.user_id
  where p.evening_reminder
    and p.evening_sent_on is distinct from private.israel_now()::date
    and w.waiting > 0
    and exists (select 1 from public.push_subscriptions s where s.user_id = p.user_id);
$$;

-- New lines count from the later of the mark and a day ago, so a long gap never sends a backlog.
create or replace function private.push_new_due_users()
returns table (user_id uuid, fresh integer, upto timestamptz, waiting integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, f.fresh, f.upto, coalesce(w.waiting, 0)
  from public.notification_prefs p
  cross join lateral private.push_fresh_lines(
    p.user_id,
    greatest(coalesce(p.new_line_mark, '-infinity'::timestamptz), pg_catalog.now() - interval '1 day')
  ) f
  left join private.push_waiting_by_owner() w on w.user_id = p.user_id
  where p.new_transaction
    and f.fresh > 0
    and exists (select 1 from public.push_subscriptions s where s.user_id = p.user_id);
$$;

create or replace function private.push_weekly_due_users()
returns table (user_id uuid, fresh integer, waiting integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, f.fresh, coalesce(w.waiting, 0)
  from public.notification_prefs p
  cross join lateral private.push_fresh_lines(p.user_id, pg_catalog.now() - interval '7 days') f
  left join private.push_waiting_by_owner() w on w.user_id = p.user_id
  where p.weekly_summary
    and p.weekly_sent_on is distinct from private.israel_now()::date
    and f.fresh + coalesce(w.waiting, 0) > 0
    and exists (select 1 from public.push_subscriptions s where s.user_id = p.user_id);
$$;

create or replace function private.push_new_due()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.push_new_due_users());
$$;

-- Sunday, 08:00-08:59 in Israel (decision 0018).
create or replace function private.push_weekly_due()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select extract(isodow from private.israel_now()) = 7
    and extract(hour from private.israel_now()) = 8
    and exists (select 1 from private.push_weekly_due_users());
$$;

revoke all on function private.push_waiting_by_owner() from public, anon, authenticated;
revoke all on function private.push_fresh_lines(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.push_new_due_users() from public, anon, authenticated;
revoke all on function private.push_weekly_due_users() from public, anon, authenticated;
revoke all on function private.push_new_due() from public, anon, authenticated;
revoke all on function private.push_weekly_due() from public, anon, authenticated;

-- The send function claims a kind's targets in one call: the claim moves the user's mark (new)
-- or stamps today (weekly) before the push goes out, so two runs never send the same lines.
-- A push that fails is not retried; the next new line or next Sunday brings the next one.
-- created_at is when the inserting transaction began, so a line from a sync that commits after a
-- later-started sync was claimed is not pushed. It is missed, never sent twice; accepted.
-- The weekly claim does not check the day: the cron's gate does (only a cron or service caller
-- reaches it).
create or replace function public.push_claim_targets(p_kind text)
returns table (user_id uuid, endpoint text, p256dh text, auth text, fresh integer, waiting integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind = 'new' then
    return query
    with due as (
      select d.user_id, d.fresh, d.upto, d.waiting from private.push_new_due_users() d
    ), claimed as (
      update public.notification_prefs p
      set new_line_mark = due.upto
      from due
      where p.user_id = due.user_id
        -- Rechecked on the locked row: a run that waited on another's claim skips the user.
        and (p.new_line_mark is null or p.new_line_mark < due.upto)
      returning p.user_id, due.fresh, due.waiting
    )
    select c.user_id, s.endpoint, s.p256dh, s.auth, c.fresh, c.waiting
    from claimed c
    cross join lateral (
      select k.endpoint, k.p256dh, k.auth
      from public.push_subscriptions k
      where k.user_id = c.user_id
      order by k.updated_at desc, k.id
      limit 10
    ) s
    order by c.user_id;
  elsif p_kind = 'weekly' then
    return query
    with due as (
      select d.user_id, d.fresh, d.waiting from private.push_weekly_due_users() d
    ), claimed as (
      update public.notification_prefs p
      set weekly_sent_on = private.israel_now()::date
      from due
      where p.user_id = due.user_id
        and p.weekly_sent_on is distinct from private.israel_now()::date
      returning p.user_id, due.fresh, due.waiting
    )
    select c.user_id, s.endpoint, s.p256dh, s.auth, c.fresh, c.waiting
    from claimed c
    cross join lateral (
      select k.endpoint, k.p256dh, k.auth
      from public.push_subscriptions k
      where k.user_id = c.user_id
      order by k.updated_at desc, k.id
      limit 10
    ) s
    order by c.user_id;
  else
    raise exception 'unknown push kind' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.push_claim_targets(text) from public, anon, authenticated;
grant execute on function public.push_claim_targets(text) to service_role;

-- Schedule flow-push-new (every 5 minutes) and flow-push-weekly (hourly, sends Sunday at 08:00).
-- Same rules as flow-push-evening: posts only when its gate is true; a missing pg_cron, pg_net,
-- cron_secret or flow_sync_url skips the schedule with a notice.
create or replace function private.schedule_push_kind(p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  job text;
  cadence text;
  gate text;
  secret text;
  sync_url text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  case p_kind
    when 'new' then job := 'flow-push-new'; cadence := '*/5 * * * *'; gate := 'private.push_new_due()';
    when 'weekly' then job := 'flow-push-weekly'; cadence := '0 * * * *'; gate := 'private.push_weekly_due()';
    else raise exception 'unknown push kind' using errcode = '22023';
  end case;
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice '% skipped: pg_cron or pg_net is missing', job;
    return;
  end if;
  if exists (select 1 from cron.job j where j.jobname = job) then
    perform cron.unschedule(job);
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
    raise notice '% skipped: cron_secret or flow_sync_url is missing', job;
    return;
  end if;
  if position('/sumit-sync' in sync_url) = 0 then
    raise notice '% skipped: flow_sync_url does not end in /sumit-sync', job;
    return;
  end if;

  perform cron.schedule(
    job,
    cadence,
    format(
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
          body := %L::jsonb
        )
        where %s;
      $cron$,
      jsonb_build_object('kind', p_kind)::text,
      gate
    )
  );
end;
$$;

revoke all on function private.schedule_push_kind(text) from public, anon, authenticated;
grant execute on function private.schedule_push_kind(text) to service_role;

do $schedule$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform private.schedule_push_kind('new');
  perform private.schedule_push_kind('weekly');
end
$schedule$;

commit;
