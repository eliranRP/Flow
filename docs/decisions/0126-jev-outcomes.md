# Jev learns from what the owner files, and reports its accuracy

**Date:** 2026-10-08
**Status:** Accepted

## Context

FLOW-701 part 1 asks Jev to learn from confirmations and to produce a shadow accuracy report on approved lines. [0084](0084-jev-auto-prefill.md) left the confirm or fix write (`record_jev_correction`, in `supabase/pending/`) to the app, and the app never called it. The owner reviews lines one by one in the app and approves in bulk only through MCP (2026-10-08), so a write that only the app's card makes would miss most confirmations.

## Decision

The outcome is captured in the database, whatever path resolved the line. A deferred constraint trigger on `review_queue` (insert, or an update of `status`) calls `private.jev_outcome_sync` at commit. That means after every write of the approval, from `resolve_review`, an MCP tool or a batch. The line's review is its newest `review_queue` row, the same rule the sync uses, so a SUMIT sync that opens a new row takes the outcome away. Later edits that leave the review alone also resync, through deferred triggers on the line (removal, project, category, P&L role), on `line_splits` and on `allocations`; they run only for lines Jev suggested on. When the line's review is `approved` or `changed` and the line has a Jev suggestion, `jev_outcomes` holds one row per line with the following fields:

- the suggestion, its model and its confidence
- the project and category Jev chose (its answer, when it is an id)
- the project and category the line was filed as
- `project_match` and `category_match`

`project_match` is null when Jev gave no project, or when the line is shared, overhead, or split across more than one project (by allocations or by split parts). `category_match` is null when Jev gave no category, or when the line is split by category.

When the review goes back to `open` (undo) or is `skipped`, or the line is removed, the row is deleted. Approving again writes the new result. Deleting the suggestion deletes the row.

Lines approved before this change are backfilled, with the review's own resolved time.

`mcp_jev_accuracy(from, to)` is the shadow accuracy report, plain SQL over `jev_outcomes` for the token's company, by the UTC day the line was resolved. Elsewhere "today" is Asia/Jerusalem; a UTC day is simpler to bound and the report is a trend, so a line approved after midnight Israel time and before 03:00 counts on the day before. It returns:

- `lines` and `all_matched`. A line counts as all matched when every compared field matched and at least one field was compared.
- the per-field compared and matched counts
- `at_threshold`: `lines` and `all_matched` for suggestions at or above the company's threshold, which is what auto mode would pre-fill
- three confidence bands: high from 0.9, medium from 0.7, low below that

MCP `get_jev_accuracy` exposes it.

Members read their company's `jev_outcomes`. Nobody writes to it except the trigger and the service role. Jev still never approves a line.

## Alternatives rejected

Applying the pending `record_jev_correction` and calling it from the review card. It would miss MCP and batch approvals, and it needs a UI change in the design thread. Recording at the moment the review row changes, without deferring. `resolve_review` and other paths can write the line's project or category after the review row, so the outcome would read a stale line.

## Consequences

The confirmations are now data that a later change can feed back to Jev, for example a supplier's recent filed results in the request state. `supabase/pending/20261005120000_jev_corrections.sql` is superseded by this record and removed. The accuracy report is what the owner and the data agent use to judge when auto mode ([0084](0084-jev-auto-prefill.md), FLOW-702) is safe and at which threshold.
