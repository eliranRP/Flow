# A split line whose amount changes opens a review

**Date:** 2026-10-08
**Status:** Accepted

## Context

[0104](0104-line-split-by-category.md) splits one bank line into parts that sum to it. When the parts stop summing to the line, `private.pnl_lines` counts the line whole under its own category and project. The bank sync rewrites a line's amount in place, so a changed amount silently moved a split line back to counting whole, and nobody was told (FLOW-312, item 2). Loan splits already flag their parts (`needs_review`) in the same case.

## Decision

- A line with parts whose amount no longer matches them gets an open review item with `reason` `split_mismatch`. It is opened by a trigger on `transactions` when `amount_net`, `removed_at` or `line_status` changes, and by a deferred trigger on `line_splits` (so `save_line_split`'s delete-then-insert is judged once, at commit). Both call `private.line_split_review_sync`, which is idempotent. The migration runs it once over every split line, so lines that already mismatch get their review.
- No review is opened for a removed or void line, or for a line that already has an open review of any reason (one open review per line). When that other review closes (approved, skipped, changed or deleted), a trigger on `review_queue` judges the line again, so the mismatch then gets its own review; if that review is reopened (undo of a skip), the `split_mismatch` review is dropped again, so the line keeps one open review. A `split_mismatch` review that is reopened (`reopen_review`, undo) is judged again too, and closes at once if the parts match by then.
- The review closes (its open row is deleted) when the parts match again: new parts, a cleared split, an amount that comes back, or the line being removed or voided.
- `save_line_split` (and so MCP `split_line`) accepts a line whose only open review is `split_mismatch`; any other open review still refuses it. MCP undo of a fix restores the old parts, and the review comes back with them.
- The P&L rule does not change: a mismatched split counts whole until it is fixed.

## Alternatives rejected

- A `needs_review` flag on `line_splits`, as loans do. It adds a second place to look; the review queue is where the owner and the data agent already find lines that need a decision.
- Scaling the parts to the new amount. The split is the owner's bookkeeping; guessing the new parts could hide a real change.

## Consequences

The review card shows a `split_mismatch` line like any other review for now; a hint for it is handed to the design thread. Approving or skipping the review leaves the split as it is, so the line keeps counting whole until new parts are sent. Like any skipped or approved review, a skipped `split_mismatch` row keeps `sync_review_queue` from queueing the same unchanged line for another reason, and an approved one keeps an income line out of the income review; split lines are already filed by the owner, so this rarely matters.
