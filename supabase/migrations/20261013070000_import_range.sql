-- FLOW-505: the import range for SUMIT and Mercury, database side (the owner picked option B).
-- 1. sumit_status() returns import_from, so the SUMIT sheet can show the current choice. Mercury
--    already returns it through connector_connection_status.
-- 2. upsert_connector_lines() does not write a line dated before the connector's import start,
--    for both providers; the rows already stored stay. SUMIT sends every document, so the sweep
--    still sees them. A run whose lines are all before the start is not an empty sweep.
-- 3. set_import_from() clears Mercury's sync cursor when the range widens (an earlier date, or
--    back to "from the start"), so the next sync reads from the new start. Narrowing keeps the
--    cursor; the sync skips rows dated before the start and keeps the rows already stored.
--    SUMIT reads every document on each run, so it needs no reset.
-- All three functions are patched in place, so their grants stay.
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
  connected text := $a$'next_attempt_at', c.next_attempt_at,$a$;
  disconnected text := $a$'next_attempt_at', null,$a$;
begin
  def := pg_get_functiondef('public.sumit_status()'::regprocedure);
  if pg_temp.anchor_count(def, connected) <> 1 or pg_temp.anchor_count(def, disconnected) <> 1 then
    raise exception 'sumit_status is not the expected definition';
  end if;
  def := replace(def, connected, connected || $n$
        'import_from', c.import_from,$n$);
  def := replace(def, disconnected, disconnected || $n$
      'import_from', null,$n$);
  execute def;
end
$patch$;

do $patch$
declare
  def text;
  declared text := $a$  seen_ids text[] := array[]::text[];$a$;
  missing_id text := $a$      raise exception 'line is missing an external id';
    end if;$a$;
  empty_sweep text := $a$    if coalesce(array_length(seen_ids, 1), 0) = 0 then$a$;
begin
  def := pg_get_functiondef('public.upsert_connector_lines(uuid,public.connector_provider,jsonb,text,text)'::regprocedure);
  if pg_temp.anchor_count(def, declared) <> 1
     or pg_temp.anchor_count(def, missing_id) <> 1
     or pg_temp.anchor_count(def, empty_sweep) <> 1 then
    raise exception 'upsert_connector_lines is not the expected definition';
  end if;
  def := replace(def, declared, declared || $n$
  before_start integer := 0;$n$);
  def := replace(def, missing_id, missing_id || $n$
    -- FLOW-505: a line dated before the import start is not written; stored rows stay.
    if import_from is not null and (line->>'doc_date')::date < import_from then
      before_start := before_start + 1;
      continue;
    end if;$n$);
  def := replace(def, empty_sweep, $n$    if coalesce(array_length(seen_ids, 1), 0) = 0 and before_start = 0 then$n$);
  execute def;
end
$patch$;

do $patch$
declare
  def text;
  anchor text := $a$  set import_from = p_from
  where company_id = cid$a$;
begin
  def := pg_get_functiondef('public.set_import_from(public.connector_provider,date)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'set_import_from is not the expected definition';
  end if;
  execute replace(def, anchor, $n$  set import_from = p_from,
      -- FLOW-505: a wider range makes Mercury's next sync read from the new start.
      sync_cursor = case
        when p_provider = 'mercury'
          and import_from is not null
          and (p_from is null or p_from < import_from)
        then null
        else sync_cursor
      end
  where company_id = cid$n$);
end
$patch$;

commit;
