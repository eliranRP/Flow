-- FLOW-1197: a held sync change the owner set aside with אישור (leave_held_change / mcp_leave_held_change,
-- hold state `left`) stays set aside, also after the closed date moves back. The owner decided on
-- 2026-11-14 ("Drop it for good"). Until now upsert_connector_lines replayed every hold of the provider once
-- its line was no longer closed, a left one too.
--
-- upsert_connector_lines (last defined by 20261112202048_closed_line_holds.sql; the later migrations only
-- mention it in comments) is patched in place, each anchor found exactly once or the migration fails:
-- 1. the `applied` CTE that applies held voids and removals: `and h.state = 'held'`;
-- 2. the replay loop's union that feeds held updates through the line loop: `and h.state = 'held'`.
-- A left hold is not deleted when the period reopens: it stays left, so the same change sent again stays
-- left, and a provider change with a new fingerprint is held again (the fingerprint upsert is unchanged).
-- The fetched line still wins as before. The undo `held_change_left` puts the hold back to `held` (left_at
-- null), so the next replay applies it; nothing changes there.
--
-- The other half: an open closed_month_change row means its hold is held. A person's reopen of an approved
-- (left) row (reopen_review, undo_reassign, any other undo that reopens it) used to leave the hold left, which
-- list_review does not show (it joins held holds only), so the card had no change on it and now the replay
-- would never take it. A new trigger on review_queue puts the hold back to held, left_at null, whenever a
-- closed_month_change row turns open, as private.undo_held_change_left does. One choke point, so no reopen
-- function is patched.
--
-- Rows: none rewritten. Same signature, security and grants (create or replace keeps them).
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.swap(p_def text, p_from text, p_to text)
returns text
language plpgsql
immutable
as $$
begin
  if (char_length(p_def) - char_length(replace(p_def, p_from, ''))) / char_length(p_from) <> 1 then
    raise exception 'anchor not found exactly once: %', left(p_from, 80);
  end if;
  return replace(p_def, p_from, p_to);
end;
$$;

do $patch$
declare
  def text := pg_get_functiondef(
    'public.upsert_connector_lines(uuid,public.connector_provider,jsonb,text,text,smallint)'::regprocedure);
  a_applied constant text := $a$        and h.kind in ('void', 'remove')
$a$;
  a_update constant text := $a$h.provider = p_provider and h.kind = 'update'
$a$;
begin
  def := pg_temp.swap(def, a_applied, a_applied || $n$        and h.state = 'held' -- FLOW-1197: a left hold is not applied
$n$);
  def := pg_temp.swap(def, a_update, $n$h.provider = p_provider and h.kind = 'update'
        and h.state = 'held' -- FLOW-1197: a left hold is not applied
$n$);
  execute def;
end
$patch$;

create function private.review_held_reopen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.closed_line_holds h
  set state = 'held', left_at = null
  where h.company_id = new.company_id and h.transaction_id = new.transaction_id and h.state = 'left';
  return null;
end;
$$;

revoke all on function private.review_held_reopen() from public, anon, authenticated, service_role;

create trigger review_queue_held_reopen
  after update of status on public.review_queue
  for each row
  when (old.status is distinct from 'open' and new.status = 'open' and new.reason = 'closed_month_change')
  execute function private.review_held_reopen();

commit;
