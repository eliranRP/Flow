-- FLOW-856 (the security scan, 2026-11-21; the owner's decision the same day): the closed-date reads
-- hold the company row until the write commits. The books-closed guards read
-- companies.books_closed_through with a plain SELECT, while a close (mcp_set_books_closed_through and
-- the undo of a move back, in private.undo_prepaid_write) takes that row FOR UPDATE. Under READ
-- COMMITTED a person's write could read the old date and pass, the close commit, and the write then
-- commit a line inside the closed period. Each read below now takes the row FOR SHARE, as the prepaid
-- writers already do (20261028102302_prepaid_schedules.sql): a close waits for a write in flight, and a
-- write waits for a close in flight and then reads the date it set.
--
-- 1. private.books_closed_guard (the line triggers on transactions, allocations and overhead).
-- 2. private.books_closed_check (a line's parts). It was STABLE, and a locking read is allowed only in
--    a volatile function, so it becomes VOLATILE; its callers (set_line_parts, set_loan_parts,
--    set_loan_parts_review) are volatile already.
-- 3. private.books_closed_setting_guard (a category's settings; the companies branch reads the row it
--    fires on, which the update already holds).
-- 4. public.jev_prefill and public.jev_prefill_loan (Jev, as the service role).
-- 5. private.review_held_change_guard (a person's change to a held, closed line's review row: a
--    review row, which the line guard does not cover).
-- 6. private.journal_entry_editable (a journal entry's edit and its undo): the entry's split parts
--    are public.legs rows, which the line guard does not cover, and a split-only edit changes no
--    column the line's guard fires on, so this read is the only check.
-- The early return when no person writes (auth.uid() is null) stays first in the four guards, so a
-- sync takes no lock there. Jev, as the service role, takes the share lock: it acts on the date.
-- Not locked, on purpose:
-- - private.follow_invoice and private.fill_suggested_category read the date for a filing choice.
--   The line they then write (a receipt's filing, a line's category) passes
--   private.books_closed_guard for a person, which reads the date FOR SHARE; if a close commits
--   between the two reads, the guard sees the new date and refuses the write. Both also run for the
--   sync, where a lock would add a deadlock with no person to retry it.
-- - private.prepaid_apply: both its callers (the prepaid undo and the MCP delete) lock the company
--   row in an earlier statement, so its read already sees any close committed before that lock.
-- The line guard covers a line, an allocation and an overhead row; a line's parts (public.legs)
-- only through books_closed_check or the line's own update when a column its guard fires on changes.
--
-- Lock order. A writer holds its line (or category) row and then share-locks the company row. A close
-- takes the company row FOR UPDATE and after that only reads (prepaid_rows, review_queue and
-- transactions in private.books_close_review_check, all plain reads) and updates that same row, whose
-- triggers (companies_audit, companies_lock_closed_month, which does not fire for this column) take no
-- row lock on a line. So a close never waits for a line row, and a writer waiting for a close cannot
-- close a cycle. Share locks do not conflict with each other, so two writers do not wait on each
-- other here; a share lock that is compatible with the holders does not queue behind a waiting close.
-- Two cases can still deadlock, and Postgres aborts one side with deadlock_detected (40P01,
-- retryable), which the MCP writers already answer as `unavailable` / `retry`; an app RPC shows its
-- usual error and the person tries again. Before, one side waited for the other instead.
-- a. Two transactions each share-lock the row through a line write and then update that same
--    company row (for example a delete of the overhead project, whose lines lose the project before
--    the company's overhead_project_id is cleared): each waits for the other's share lock.
-- b. One such transaction (T1) has written a line and waits to update the company row, while a
--    person's edit of that same line (T2) holds the share lock and waits for T1's line lock.
-- Share locks do not queue behind a waiting FOR UPDATE, so a close can wait while new writers keep
-- arriving. Each write holds the share lock only until it commits, so the close waits for those
-- short writes; no lock_timeout or fairness is added here.
--
-- Rows: functions only; nothing is rewritten. Signatures do not change; the patched functions keep
-- their grants, restated below as they are. No client-callable function is added.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- Replaces each anchor (found exactly once) in a function's definition and runs the result.
create or replace function pg_temp.patch(p_fn text, p_from text[], p_to text[])
returns void
language plpgsql
as $$
declare
  def text := pg_get_functiondef(p_fn::regprocedure);
  i integer;
begin
  for i in 1 .. cardinality(p_from) loop
    if pg_temp.anchor_count(def, p_from[i]) <> 1 then
      raise exception '% is not the expected definition (anchor %)', p_fn, i;
    end if;
    def := replace(def, p_from[i], p_to[i]);
  end loop;
  execute def;
end;
$$;

-- 1. The line guard.
select pg_temp.patch('private.books_closed_guard()',
  array[$a$  select c.books_closed_through into closed from public.companies c where c.id = cid;$a$],
  array[$n$  -- FLOW-856: held against a books-closed change until this write commits.
  select c.books_closed_through into closed from public.companies c where c.id = cid for share;$n$]);

-- 2. A line's parts.
select pg_temp.patch('private.books_closed_check(uuid,uuid)',
  array[$a$  select c.books_closed_through into closed from public.companies c where c.id = p_company;$a$],
  array[$n$  -- FLOW-856: held against a books-closed change until this write commits.
  select c.books_closed_through into closed from public.companies c where c.id = p_company for share;$n$]);
alter function private.books_closed_check(uuid, uuid) volatile;

-- 3. The category setting guard.
select pg_temp.patch('private.books_closed_setting_guard()',
  array[$a$    select c.books_closed_through into closed from public.companies c where c.id = cid;$a$],
  array[$n$    -- FLOW-856: held against a books-closed change until this write commits.
    select c.books_closed_through into closed from public.companies c where c.id = cid for share;$n$]);

-- 4. Jev.
select pg_temp.patch('public.jev_prefill(uuid,uuid,uuid,uuid,text,numeric)',
  array[$a$    (select c.books_closed_through from public.companies c where c.id = p_company), line, null)$a$],
  array[$n$    -- FLOW-856: held against a books-closed change until this write commits.
    (select c.books_closed_through from public.companies c where c.id = p_company for share), line, null)$n$]);
select pg_temp.patch('public.jev_prefill_loan(uuid,uuid,uuid,jsonb,text,numeric)',
  array[$a$    (select c.books_closed_through from public.companies c where c.id = p_company), line, null)$a$],
  array[$n$    -- FLOW-856: held against a books-closed change until this write commits.
    (select c.books_closed_through from public.companies c where c.id = p_company for share), line, null)$n$]);

-- 5. The held line's review row.
select pg_temp.patch('private.review_held_change_guard()',
  array[$a$  select c.books_closed_through into closed from public.companies c where c.id = old.company_id;$a$],
  array[$n$  -- FLOW-856: held against a books-closed change until this write commits.
  select c.books_closed_through into closed from public.companies c where c.id = old.company_id for share;$n$]);

-- 6. A journal entry's edit.
select pg_temp.patch('private.journal_entry_editable(uuid,uuid,date)',
  array[$a$  select c.books_closed_through into closed from public.companies c where c.id = p_company;$a$],
  array[$n$  -- FLOW-856: held against a books-closed change until this write commits.
  select c.books_closed_through into closed from public.companies c where c.id = p_company for share;$n$]);

-- Privileges, restated as they are.
revoke all on function private.books_closed_guard() from public, anon, authenticated;
revoke all on function private.books_closed_check(uuid, uuid) from public, anon, authenticated;
revoke all on function private.books_closed_setting_guard() from public, anon, authenticated;
revoke all on function public.jev_prefill(uuid, uuid, uuid, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.jev_prefill(uuid, uuid, uuid, uuid, text, numeric) to service_role;
revoke all on function public.jev_prefill_loan(uuid, uuid, uuid, jsonb, text, numeric) from public, anon, authenticated;
grant execute on function public.jev_prefill_loan(uuid, uuid, uuid, jsonb, text, numeric) to service_role;
revoke all on function private.review_held_change_guard() from public, anon, authenticated, service_role;
revoke all on function private.journal_entry_editable(uuid, uuid, date) from public, anon, authenticated, service_role;

-- The helpers are session-wide: a later migration in the same session can make its own.
drop function pg_temp.patch(text, text[], text[]);
drop function pg_temp.anchor_count(text, text);

commit;
