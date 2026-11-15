-- FLOW-1163 (SUMIT's resumable pull): a SUMIT company with more than 20 pages (1,000 documents each) of
-- documents ended every run with sync_page_cap, stored nothing, and listed the same 20 pages again. The
-- edge function now stores what a capped run listed and keeps where to continue in the connection's
-- settings (`settings.pull`); this file is the database half.
--
-- 1. public.upsert_sumit_window(p_company, p_docs, p_complete, p_pull) is upsert_sumit_documents with two
--    more arguments, read from its current definition with counted anchors:
--    - p_complete false (and null, the default) stores the documents and never sweeps (upsert_connector_lines sweeps only a
--      complete list). Every run of a window that takes more than one run calls it so, the one that
--      finishes it included: SUMIT's list has no stable order, so a document no run listed could be
--      one that moved between runs, and a wrong removal deletes a real line. Only a window listed
--      whole in one run sweeps, as before. (A company past the cap never has a deleted SUMIT document
--      removed automatically.)
--    - p_pull: the continuation, written to settings.pull in the same transaction as the documents, so
--      it never points past documents that were not stored; null removes it. A partial run also clears
--      a stale sync_page_cap (last_error and its 15-minute wait): the pull is moving.
--    The cursor compare-and-set, the sweep's guards and the counts are upsert_connector_lines', which
--    this file does not touch.
-- 2. upsert_sumit_documents becomes the window function with the sweep on: the same behaviour as before
--    for a run that lists a whole window.
--
-- Deploy order: CI deploys sumit-sync before this file is pushed. Before this file a run that would
-- need upsert_sumit_window ends in sync_page_cap as it did, storing nothing. No row is rewritten. Both
-- functions are service_role only.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $patch$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('public.upsert_sumit_documents(uuid,jsonb)'::regprocedure);
  if pg_temp.anchor_count(def, 'public.upsert_sumit_documents(p_company uuid, p_docs jsonb)') <> 1 then
    raise exception 'upsert_sumit_documents is not the expected definition';
  end if;
  def := replace(def, 'public.upsert_sumit_documents(p_company uuid, p_docs jsonb)',
    'public.upsert_sumit_window(p_company uuid, p_docs jsonb, p_complete boolean, p_pull jsonb)');
  anchor := $a$jsonb_build_object('lines', lines, 'removed_ids', '[]'::jsonb, 'complete', true)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'upsert_sumit_documents does not build the expected line list';
  end if;
  def := replace(def, anchor,
    $n$jsonb_build_object('lines', lines, 'removed_ids', '[]'::jsonb, 'complete', coalesce(p_complete, false))$n$);
  anchor := $a$  return saved.inserted + saved.updated;
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'upsert_sumit_documents does not end as expected';
  end if;
  def := replace(def, anchor, $n$  -- FLOW-1163: the continuation commits with the documents.
  update public.connector_connections c
  set settings = case
        when p_pull is null or jsonb_typeof(p_pull) = 'null' then c.settings - 'pull'
        else (c.settings - 'pull') || jsonb_build_object('pull', p_pull)
      end,
      last_error = case when p_pull is not null and jsonb_typeof(p_pull) = 'object' and c.last_error = 'sync_page_cap'
        then null else c.last_error end,
      next_attempt_at = case when p_pull is not null and jsonb_typeof(p_pull) = 'object' and c.last_error = 'sync_page_cap'
        then null else c.next_attempt_at end
  where c.company_id = p_company
    and c.provider = 'sumit';
$n$ || anchor);
  anchor := $a$  if jsonb_typeof(p_docs) <> 'array' then
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'upsert_sumit_documents does not check its documents as expected';
  end if;
  def := replace(def, anchor, $n$  if p_pull is not null and jsonb_typeof(p_pull) not in ('object', 'null') then
    raise exception 'pull must be an object';
  end if;
$n$ || anchor);
  execute def;
end
$patch$;

revoke all on function public.upsert_sumit_window(uuid, jsonb, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_sumit_window(uuid, jsonb, boolean, jsonb) to service_role;

-- 2. The old name is the window function with the sweep on and nothing else: a run that lists a whole
-- window in one go behaves as before (and leaves no continuation behind).
create or replace function public.upsert_sumit_documents(p_company uuid, p_docs jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  return public.upsert_sumit_window(p_company, p_docs, true, null);
end;
$$;

revoke all on function public.upsert_sumit_documents(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_sumit_documents(uuid, jsonb) to service_role;

comment on function public.upsert_sumit_window(uuid, jsonb, boolean, jsonb) is
  'SUMIT sync write for one run of a documents window: the documents, a sweep only when p_complete (a window listed whole in one run), and the continuation settings.pull, in one transaction. FLOW-1163.';

drop function pg_temp.anchor_count(text, text);

commit;
