-- FLOW-508: the sync claim window goes from 15 to 10 minutes. An edge function stops at its wall
-- clock limit (400 seconds at most), so no run outlives 10 minutes; a run that died without
-- clearing its claim now frees the connection, and the busy row in Settings, 5 minutes sooner.
-- mercury-sync and sumit-sync use the same window (CLAIM_MS). The view is rebuilt from
-- 20261006211000 with the new interval; sumit_status and both claim_connector_refreshes overloads
-- are patched in place, so their grants stay.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace view public.connector_connection_status
with (security_invoker = true) as
select
  company_id,
  provider,
  (last_error is distinct from 'auth') as connected,
  last_sync_at,
  last_error,
  next_attempt_at,
  import_from,
  account_labels,
  (
    select count(*)::integer
    from public.connector_skips s
    where s.company_id = connector_connections.company_id
      and s.provider = connector_connections.provider
  ) as skip_count,
  (
    sync_claimed_at is not null
    and sync_claimed_at > pg_catalog.now() - interval '10 minutes'
  ) as syncing
from public.connector_connections;

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
  fn text;
begin
  def := pg_get_functiondef('public.sumit_status()'::regprocedure);
  anchor := $a$c.sync_claimed_at > pg_catalog.now() - interval '15 minutes'$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'sumit_status is not the expected definition';
  end if;
  execute replace(def, anchor, $n$c.sync_claimed_at > pg_catalog.now() - interval '10 minutes'$n$);

  -- Both overloads: the one-argument form (every provider) and the per-provider one mercury-sync calls.
  foreach fn in array array[
    'public.claim_connector_refreshes(integer)',
    'public.claim_connector_refreshes(integer, public.connector_provider)'
  ]
  loop
    def := pg_get_functiondef(fn::regprocedure);
    anchor := $a$c.sync_claimed_at < pg_catalog.now() - interval '15 minutes'$a$;
    if pg_temp.anchor_count(def, anchor) <> 1 then
      raise exception '% is not the expected definition', fn;
    end if;
    execute replace(def, anchor, $n$c.sync_claimed_at < pg_catalog.now() - interval '10 minutes'$n$);
  end loop;
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
