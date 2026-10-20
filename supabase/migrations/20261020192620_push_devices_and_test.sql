-- FLOW-516: the connected devices list, a test push from Settings → התראות, and the app's own unsubscribe.
-- 1. push_unsubscribe(p_endpoint) is granted back to authenticated: on an explicit sign-out the
--    app deletes this device's row before the session ends (decision 0201). It deletes only the
--    caller's own row, as before.
-- 2. private.push_test_sends records each test push a user asked for. public.claim_push_test()
--    is the push-send function's gate for kind "test": the caller is the user in the JWT
--    (auth.uid(), checked by PostgREST), at most 5 claims an hour per user, and a claim is spent
--    only when the user has a saved device. It returns the user's id and device count.
-- 3. public.push_test_targets(p_user) lists that user's devices for the send. service_role only,
--    so the endpoints and keys never reach a browser.
-- 4. public.list_my_push_devices() is Settings → התראות's "connected devices" list: the caller's
--    own subscriptions, newest first, with the stored user agent, when each was added and a short
--    tag of the endpoint's SHA-256 (so the app can mark this device). No endpoint and no key.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

grant execute on function public.push_unsubscribe(text) to authenticated;

create table private.push_test_sends (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  sent_at timestamptz not null default now()
);

create index push_test_sends_user_idx on private.push_test_sends (user_id, sent_at);

comment on table private.push_test_sends is
  'FLOW-516: one row per test push a user claimed (claim_push_test), for its limit of 5 an hour. Rows older than a day are dropped on the next claim.';

alter table private.push_test_sends enable row level security;
revoke all on private.push_test_sends from public, anon, authenticated;

create or replace function public.claim_push_test()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.push_user();
  devices integer;
begin
  select count(*)::integer into devices from public.push_subscriptions s where s.user_id = uid;
  if devices = 0 then
    return jsonb_build_object('user_id', uid, 'devices', 0);
  end if;
  -- One claim at a time per user, so two quick taps cannot both pass the count.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('push_test:' || uid::text, 0));
  delete from private.push_test_sends t where t.user_id = uid and t.sent_at < pg_catalog.now() - interval '1 day';
  if (select count(*) from private.push_test_sends t
      where t.user_id = uid and t.sent_at > pg_catalog.now() - interval '1 hour') >= 5 then
    raise exception 'push_test_limit' using errcode = '23514';
  end if;
  insert into private.push_test_sends (user_id) values (uid);
  return jsonb_build_object('user_id', uid, 'devices', least(devices, 10));
end;
$$;

revoke all on function public.claim_push_test() from public, anon, authenticated;
grant execute on function public.claim_push_test() to authenticated;

create or replace function public.push_test_targets(p_user uuid)
returns table (user_id uuid, endpoint text, p256dh text, auth text)
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
  select s.user_id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  where s.user_id = p_user
  order by s.updated_at desc, s.id
  limit 10;
end;
$$;

revoke all on function public.push_test_targets(uuid) from public, anon, authenticated;
grant execute on function public.push_test_targets(uuid) to service_role;

create or replace function public.list_my_push_devices()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.push_user();
begin
  return jsonb_build_object('devices', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'user_agent', s.user_agent,
      'created_at', s.created_at,
      'tag', left(encode(pg_catalog.sha256(pg_catalog.convert_to(s.endpoint, 'UTF8')), 'hex'), 16)
    ) order by s.updated_at desc, s.id)
    from public.push_subscriptions s
    where s.user_id = uid
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.list_my_push_devices() from public, anon, authenticated;
grant execute on function public.list_my_push_devices() to authenticated;

commit;
