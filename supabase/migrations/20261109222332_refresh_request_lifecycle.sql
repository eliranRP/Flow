-- FLOW-1163 (decision 0266): a connector refresh request's life, written out, and an auth stop that
-- only a reconnect leaves.
--
-- A request (connector_refresh_requests) has three states and four moves:
--
--   queued   (claimed_at null; one per company and provider, connector_refresh_open_uidx)
--     claim   -> claimed   claim_connector_refreshes (Mercury's drain), or sumit-sync's own update of
--                          sumit_refresh_requests (SUMIT's drain, after list_due_refresh_requests)
--   claimed  (claimed_at set; the drain's run holds it)
--     requeue -> queued    settle_connector_refresh(id, true): the run threw, or found the connection
--                          busy with another run. A retry can change both. When another request was
--                          queued meanwhile the two merge: the earlier requested_at, and forced if
--                          either was.
--     finish  -> finished  settle_connector_refresh(id, false): the run synced, or skipped because a
--                          retry cannot change the answer (synced within the quiet gap, so the recent
--                          sync answers the request; or no accounts chosen yet, which only the owner
--                          changes).
--     lapse   -> finished  a request still claimed after the claim window (its run died without
--                          settling) is deleted by the next claim, and once by this file.
--   finished (the row is deleted)
--
-- Before this file a skipped run left its request claimed for good, so the request was spent without
-- a sync, and nothing ever removed a claimed request. The claim now returns `forced`, and both drains
-- pass it to the run (list_due_refresh_requests returns it for SUMIT): a forced refresh inside the
-- quiet gap is no longer read as an unforced one.
--
-- note_connector_failure and note_connector_rejection keep an `auth` stop: a later passing failure
-- (transient, rate limit, page cap, a rejection) no longer overwrites it, so the connection does not
-- read as connected again. replace_connector_connection (a reconnect) clears it, as before.
--
-- The claim window (10 minutes, FLOW-508) is private.sync_claim_window(), shared by both claim
-- overloads and the lapse sweep. connector_connection_status, sumit_status() and
-- private.mcp_bank_connection_json still write the literal: the view is read as the client
-- (security_invoker), so it cannot call a private function without a new grant.
--
-- Deploy order: CI deploys mercury-sync and sumit-sync before this file is pushed. The new functions
-- fall back when settle_connector_refresh is missing (requeue: clear claimed_at, as before; finish:
-- delete the row) and read a missing `forced` as false. The old functions keep working here: the claim
-- and the SUMIT list only gain a column, and their arguments are unchanged.
--
-- Every function here is service_role only: no client list changes.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function private.sync_claim_window()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '10 minutes' $$;

revoke all on function private.sync_claim_window() from public, anon, authenticated;

-- The return type gains `forced`, so both overloads are dropped and made again.
drop function public.claim_connector_refreshes(integer);
drop function public.claim_connector_refreshes(integer, public.connector_provider);

create function public.claim_connector_refreshes(p_limit integer)
returns table (id bigint, company_id uuid, provider public.connector_provider, forced boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  -- lapse: a request whose run died without settling it.
  delete from public.connector_refresh_requests r
  where r.claimed_at is not null
    and r.claimed_at < pg_catalog.now() - private.sync_claim_window();
  return query
  with due as (
    select r.id
    from public.connector_refresh_requests r
    join public.connector_connections c
      on c.company_id = r.company_id
     and c.provider = r.provider
    where r.claimed_at is null
      and (c.next_attempt_at is null or c.next_attempt_at <= pg_catalog.now())
      and c.last_error is distinct from 'auth'
      and (c.sync_claimed_at is null or c.sync_claimed_at < pg_catalog.now() - private.sync_claim_window())
    order by r.requested_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update of r, c skip locked
  ),
  marked as (
    update public.connector_refresh_requests r
    set claimed_at = pg_catalog.now()
    from due
    where r.id = due.id
    returning r.id, r.company_id, r.provider, r.forced
  ),
  stamped as (
    update public.connector_connections c
    set sync_claimed_at = pg_catalog.now()
    from marked m
    where c.company_id = m.company_id
      and c.provider = m.provider
  )
  select m.id, m.company_id, m.provider, m.forced
  from marked m;
end;
$$;

revoke all on function public.claim_connector_refreshes(integer) from public, anon, authenticated;
grant execute on function public.claim_connector_refreshes(integer) to service_role;

create function public.claim_connector_refreshes(p_limit integer, p_provider public.connector_provider)
returns table (id bigint, company_id uuid, provider public.connector_provider, forced boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  -- lapse: a request whose run died without settling it.
  delete from public.connector_refresh_requests r
  where r.claimed_at is not null
    and r.claimed_at < pg_catalog.now() - private.sync_claim_window();
  return query
  with due as (
    select r.id
    from public.connector_refresh_requests r
    join public.connector_connections c
      on c.company_id = r.company_id
     and c.provider = r.provider
    where r.claimed_at is null
      and r.provider = p_provider
      and (c.next_attempt_at is null or c.next_attempt_at <= pg_catalog.now())
      and c.last_error is distinct from 'auth'
      and (c.sync_claimed_at is null or c.sync_claimed_at < pg_catalog.now() - private.sync_claim_window())
    order by r.requested_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update of r, c skip locked
  ),
  marked as (
    update public.connector_refresh_requests r
    set claimed_at = pg_catalog.now()
    from due
    where r.id = due.id
    returning r.id, r.company_id, r.provider, r.forced
  ),
  stamped as (
    update public.connector_connections c
    set sync_claimed_at = pg_catalog.now()
    from marked m
    where c.company_id = m.company_id
      and c.provider = m.provider
  )
  select m.id, m.company_id, m.provider, m.forced
  from marked m;
end;
$$;

revoke all on function public.claim_connector_refreshes(integer, public.connector_provider) from public, anon, authenticated;
grant execute on function public.claim_connector_refreshes(integer, public.connector_provider) to service_role;

-- SUMIT's drain lists its due requests, then claims each through sumit_refresh_requests. The list
-- gains `forced`; it reads the base table, since the view has no such column.
drop function public.list_due_refresh_requests(integer);

create function public.list_due_refresh_requests(p_limit integer)
returns table (id bigint, company_id uuid, forced boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  return query
  select r.id, r.company_id, r.forced
  from public.connector_refresh_requests r
  left join public.sumit_connections c on c.company_id = r.company_id
  where r.provider = 'sumit'
    and r.claimed_at is null
    and (c.next_attempt_at is null or c.next_attempt_at <= pg_catalog.now())
    and c.last_error is distinct from 'sumit_auth'
  order by r.requested_at
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

revoke all on function public.list_due_refresh_requests(integer) from public, anon, authenticated;
grant execute on function public.list_due_refresh_requests(integer) to service_role;

-- requeue or finish one claimed request. Returns 'queued', 'finished', or 'gone' when the request is
-- not claimed any more (the lapse sweep took it, or it was settled already).
create function public.settle_connector_refresh(p_id bigint, p_requeue boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.connector_refresh_requests;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  select r.* into req
  from public.connector_refresh_requests r
  where r.id = p_id
    and r.claimed_at is not null
  for update;
  if not found then
    return 'gone';
  end if;
  if p_requeue is not true then
    delete from public.connector_refresh_requests r where r.id = req.id;
    return 'finished';
  end if;
  -- Two tries: a request queued or claimed by another session between the two statements moves
  -- the answer from one branch to the other.
  for attempt in 1..2 loop
    -- Another request is queued already: the two merge into it.
    update public.connector_refresh_requests o
    set forced = o.forced or req.forced,
        requested_at = least(o.requested_at, req.requested_at)
    where o.company_id = req.company_id
      and o.provider = req.provider
      and o.claimed_at is null;
    if found then
      delete from public.connector_refresh_requests r where r.id = req.id;
      return 'queued';
    end if;
    begin
      update public.connector_refresh_requests r
      set claimed_at = null
      where r.id = req.id;
      return 'queued';
    exception when unique_violation then
      null;
    end;
  end loop;
  raise exception 'could not requeue the refresh';
end;
$$;

revoke all on function public.settle_connector_refresh(bigint, boolean) from public, anon, authenticated;
grant execute on function public.settle_connector_refresh(bigint, boolean) to service_role;

-- An auth stop stays until a reconnect: a later failure keeps `auth` and no retry time.
create or replace function public.note_connector_failure(
  p_company uuid,
  p_provider public.connector_provider,
  p_code text,
  p_slot smallint default null::smallint
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  retry timestamptz;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_code is distinct from 'auth'
     and p_code is distinct from 'rejected'
     and p_code is distinct from 'rate_limited'
     and p_code is distinct from 'transient'
     and p_code is distinct from 'sync_sweep_empty'
     and p_code is distinct from 'sync_sweep_suspicious'
     and p_code is distinct from 'sync_page_cap' then
    raise exception 'unknown connector failure';
  end if;
  retry := case
    when p_code in ('transient', 'rate_limited', 'sync_page_cap') then pg_catalog.now() + interval '15 minutes'
    else null
  end;
  update public.connector_connections
  set last_error = case when last_error = 'auth' then 'auth' else p_code end,
      next_attempt_at = case
        when p_code = 'auth' or last_error = 'auth' then null
        else coalesce(retry, next_attempt_at)
      end,
      sync_claimed_at = null
  where company_id = p_company
    and provider = p_provider
    and (p_slot is null or slot = p_slot);
  if not found then
    raise exception 'connector is not connected';
  end if;
  return retry;
end;
$$;

revoke all on function public.note_connector_failure(uuid, public.connector_provider, text, smallint) from public, anon, authenticated;
grant execute on function public.note_connector_failure(uuid, public.connector_provider, text, smallint) to service_role;

create or replace function public.note_connector_rejection(
  p_company uuid,
  p_provider public.connector_provider,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempts integer;
  retry timestamptz;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_code = 'auth' then
    update public.connector_connections
    set last_error = 'auth',
        next_attempt_at = null
    where company_id = p_company
      and provider = p_provider;
    if not found then
      raise exception 'connector is not connected';
    end if;
    return jsonb_build_object('code', 'auth');
  end if;
  if p_code is distinct from 'rejected' then
    raise exception 'unknown connector code';
  end if;
  update public.connector_connections
  set reject_attempts = reject_attempts + 1,
      last_error = case when last_error = 'auth' then 'auth' else 'rejected' end,
      next_attempt_at = case
        when last_error = 'auth' then null
        else pg_catalog.now() + (
          case least(greatest(reject_attempts + 1, 1), 5)
            when 1 then interval '5 minutes'
            when 2 then interval '15 minutes'
            when 3 then interval '1 hour'
            when 4 then interval '6 hours'
            else interval '24 hours'
          end
        )
      end
  where company_id = p_company
    and provider = p_provider
  returning reject_attempts, next_attempt_at into attempts, retry;
  if attempts is null then
    raise exception 'connector is not connected';
  end if;
  return jsonb_build_object('code', 'rejected', 'attempts', attempts, 'retry_at', retry);
end;
$$;

revoke all on function public.note_connector_rejection(uuid, public.connector_provider, text) from public, anon, authenticated;
grant execute on function public.note_connector_rejection(uuid, public.connector_provider, text) to service_role;

-- lapse, once: the requests claimed before this file and never settled.
delete from public.connector_refresh_requests
where claimed_at is not null
  and claimed_at < pg_catalog.now() - private.sync_claim_window();

commit;
