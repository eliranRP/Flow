-- FLOW-1166 part 3 (decision 0266; the owner's "safest first", 2026-11-11): the last column rules that
-- tie a state's columns together, each added only because every writer in the schema already keeps
-- it, so nothing valid today is refused. Each rule lists the writers it was checked against.
--
-- 1. Part 1's four CHECKs (20261111071445_state_column_rules.sql) were added NOT VALID; production
--    counted 0 breaking rows for each (2026-11-11 and again 2026-11-13), and no writer of the four
--    tables changed since. They are validated here: VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE
--    (reads and writes go on) and scans tables of a few rows per company.
-- 2. transactions_void_removed_chk: a void line is removed (void => removed_at is not null). Only this
--    direction: the SUMIT sweep and replace_sumit_connection remove a line without voiding it, and a
--    swept document sent again comes back, so a removed line need not be void.
-- 3. transactions_suggested_chk: a suggested category is never the owner's (category_suggested =>
--    not user_assigned and not category_assigned). Of the four provenance flags (user_assigned,
--    project_assigned, category_assigned, category_suggested) this is the only rule every writer
--    keeps: the trigger fill_suggested_category clears category_suggested on every insert and update
--    of a line the owner filed, since the flag was added (20260929190000) and since category_assigned
--    was added (20261002120000), both with the trigger in the same file. user_assigned,
--    project_assigned and category_assigned are set independently by the writers (set_transaction_category
--    sets category_assigned alone, reassign_transaction project_assigned alone, the undo paths put back
--    snapshots), so no rule ties them to each other.
-- 4. review_queue_resolved_chk: an open row has no resolution time, a closed one has it.
-- 5. review_queue_reason_chk: the reason is one the code writes, or none. This CHECK is the one list:
--    the app and flow-mcp compare single reasons (review-copy.ts REVIEW_HELD, split_mismatch and
--    unallocated_shared in the review screens) and keep no list of their own. A new reason is added
--    to this CHECK in the migration that first writes it.
--
-- The counts, read-only (0 in production on 2026-11-13 for 1, 2, 4 and 5; 3 was not counted and is 0
-- by the trigger described there, so it is validated too):
--   select count(*) from public.transactions where line_status = 'void' and removed_at is null;
--   select count(*) from public.transactions
--     where category_suggested and (user_assigned or category_assigned);
--   select count(*) from public.review_queue where (status = 'open') <> (resolved_at is null);
--   select count(*) from public.review_queue where reason is not null and reason not in
--     ('missing_category', 'missing_project', 'suggested', 'unallocated_shared', 'split_mismatch',
--      'closed_month_change');
--
-- Locks: ADD CONSTRAINT (validated) holds ACCESS EXCLUSIVE on transactions and review_queue while it
-- scans them, until commit. transactions has tens of thousands of rows at most and review_queue fewer,
-- so the scan takes milliseconds; a NOT VALID add and a VALIDATE in the same transaction would hold
-- the same ACCESS EXCLUSIVE until commit and gain nothing. lock_timeout stops the file rather than
-- queue behind a long sync.
--
-- 6. sync_review_queue loses what it kept for pending_income rows (two statements and one test),
--    which the reason CHECK leaves with nothing to match. Its signature and privileges stay (restated below as they are).
--
-- No other function changes; no signature, privilege or client list changes.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------
-- 1. Part 1's CHECKs, validated
-- ---------------------------------------------------------------------------------------------

alter table public.loans validate constraint loans_refinance_chk;
alter table public.projects validate constraint projects_finished_chk;
alter table public.prepaid_schedules validate constraint prepaid_schedules_ended_chk;
alter table public.company_invites validate constraint company_invites_decided_chk;

-- ---------------------------------------------------------------------------------------------
-- 2. transactions: a void line is removed
-- ---------------------------------------------------------------------------------------------

-- Writers checked (line_status, removed_at); the clients have select only, and the edge functions
-- only read the table (mercury-sync/stored.ts, mercury-sync/index.ts, sumit-sync/index.ts):
--   upsert_connector_lines (20261112202048_closed_line_holds.sql): a new line first seen as void is
--     inserted with removed_at now(); an update keeps a void line void with its removal time, and
--     removes a line the provider now sends as void; removed_ids voids with coalesce(removed_at, now());
--     a replayed held void does the same; the SUMIT sweep and a replayed held removal set removed_at
--     alone; a line sent again after a sweep comes back (removed_at null, never void).
--   replace_sumit_connection: sets removed_at alone on the old company's documents.
--   private.book_line_core, private.post_journal_entry: insert 'posted' with no removal; every other
--     insert (create_manual_entry) takes the defaults, 'posted' and null.
--   No other function writes either column (the restores and undos put back filings, never these),
--   delete_transaction and the cascades delete the row, and no trigger sets them.
alter table public.transactions
  add constraint transactions_void_removed_chk
  check (line_status <> 'void'::public.line_status or removed_at is not null);

-- ---------------------------------------------------------------------------------------------
-- 3. transactions: a suggested category is never the owner's
-- ---------------------------------------------------------------------------------------------

-- Writers checked: every insert and update of transactions passes the BEFORE trigger
-- transactions_fill_category (private.fill_suggested_category), which sets category_suggested false
-- when user_assigned or category_assigned is true, after the writer's own values; the writers that
-- set category_suggested true (forecast_line_sync, follow_invoice, unfollow_invoice_row,
-- restore_undone_suggestions, collapse_split, jev_prefill, mcp_assign_expense_split,
-- reassign_transaction, reopen_review, resolve_review, set_transaction_category, sync_review_queue,
-- undo_reassign) all pass it. No later BEFORE trigger writes the three flags.
alter table public.transactions
  add constraint transactions_suggested_chk
  check (not (category_suggested and (user_assigned or category_assigned)));

-- ---------------------------------------------------------------------------------------------
-- 4. review_queue: open has no resolution time, closed has one
-- ---------------------------------------------------------------------------------------------

-- Writers checked (status, resolved_at); the clients have select only:
--   insert open with no time: sync_review_queue, forecast_line_sync, line_split_review_sync,
--     delete_category, set_transaction_category, private.undo_held_change_left.
--   insert closed with now(): follow_invoice (approved or changed, from the invoice's settled row).
--   close with now(): resolve_review (approved, skipped, changed), approve_split_review,
--     approve_shared_whole, collapse_split, reassign_transaction, save_split, save_line_split,
--     set_transaction_category, private.book_line_core, private.follow_invoice, private.leave_held,
--     private.transfer_mark_line, replace_sumit_connection.
--   reopen with null: reopen_review, undo_reassign, private.transfer_restore_line,
--     private.undo_held_change_left.
--   follow_invoice also moves a paired row between approved and changed, keeping its time.
--   The other updates (reason, priors, pairing, fingerprint) touch neither column.
alter table public.review_queue
  add constraint review_queue_resolved_chk
  check ((status = 'open'::public.review_status) = (resolved_at is null));

-- ---------------------------------------------------------------------------------------------
-- 5. review_queue: the reasons the code writes
-- ---------------------------------------------------------------------------------------------

-- Writers checked (reason):
--   missing_category: sync_review_queue, delete_category, undo_reassign.
--   missing_project: sync_review_queue, set_transaction_category, private.relabel_income_category_pick.
--   suggested: sync_review_queue, private.forecast_line_sync.
--   unallocated_shared: sync_review_queue, set_transaction_category.
--   split_mismatch: private.line_split_review_sync.
--   closed_month_change: sync_review_queue, private.undo_held_change_left.
--   none: follow_invoice's settled row. No writer has written pending_income since
--     20261018085732_pending_lines_hidden.sql and none is stored; sync_review_queue's code for such
--     rows goes below (6).
alter table public.review_queue
  add constraint review_queue_reason_chk
  check (reason is null or reason in (
    'missing_category', 'missing_project', 'suggested', 'unallocated_shared', 'split_mismatch',
    'closed_month_change'
  ));


-- ---------------------------------------------------------------------------------------------
-- 6. sync_review_queue: what was left for pending_income rows goes
-- ---------------------------------------------------------------------------------------------

-- They deleted an open pending_income row of a posted line and cleared the reason of a closed one,
-- and the income relabel also matched pending_income. No such row is stored and the CHECK above
-- refuses one, so the two statements go and the relabel matches a null reason only, as it did for
-- every row that can exist; nothing else changes.
do $sync$
declare
  def text;
  anchor constant text := $a$  delete from public.review_queue q
  using public.transactions t
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status = 'open'
    and q.reason = 'pending_income'
    and t.line_status = 'posted'
    and t.removed_at is null;

  update public.review_queue q
  set reason = null
  from public.transactions t
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status <> 'open'
    and q.reason = 'pending_income'
    and t.line_status = 'posted'
    and t.removed_at is null;

$a$;
  note constant text := $a$  -- 0184: no row is queued as pending_income any more; the rows below were queued before it.
  -- FLOW-309: an open pending_income row whose line has posted takes the reason the income
  -- insert above would give it, or is removed when the posted line needs no review. A settled
  -- row only drops the pending label, as before. An open income row with a null reason (a
  -- settled row reopened after its line posted) takes the same reason; it is never removed.$a$;
  test constant text := $a$    and (q.reason = 'pending_income' or q.reason is null)$a$;
  settled constant text := $a$    -- Same as the income insert: a line with a settled row is not queued, so an open row
    -- the old code queued after a changed row is removed below, not relabelled.$a$;
begin
  def := pg_get_functiondef('public.sync_review_queue(uuid)'::regprocedure);
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1
     or (length(def) - length(replace(def, note, ''))) / length(note) <> 1
     or (length(def) - length(replace(def, test, ''))) / length(test) <> 1
     or (length(def) - length(replace(def, settled, ''))) / length(settled) <> 1
  then
    raise exception 'sync_review_queue is not the expected definition';
  end if;
  def := replace(def, anchor, '');
  def := replace(def, note, $n$  -- FLOW-309: an open income row with a null reason (a settled row reopened after its line
  -- posted) takes the reason the income insert above would give it; it is never removed.$n$);
  def := replace(def, test, $n$    and q.reason is null$n$);
  def := replace(def, settled, $n$    -- Same as the income insert: a line with a settled row is not queued, so its open row
    -- is not relabelled either.$n$);
  execute def;
end
$sync$;

revoke all on function public.sync_review_queue(uuid) from public, anon, authenticated;
grant execute on function public.sync_review_queue(uuid) to service_role;

commit;
