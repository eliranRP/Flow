# Move a shared line back to one project, one line at a time

**Date:** 2026-10-27
**Status:** Accepted (owner, 2026-10-27, FLOW-150: "implement also this"; the spec's option A)

## Context

A cost shared between projects, such as a property manager's fee split 50/50 between two houses, can stop being shared: from a date the manager runs one house only. That year's payments then belong 100% to that house, while last year's must stay shared. There was no way to move one line:

- `assign_expense` refuses a shared line;
- `assign_expense_split` refuses a single 100% share, or 100/0;
- `split_line` refuses a part that takes the whole line;
- `reassign_recurring_charge` moves every payment of the charge, last year's included.

`reassign_transaction` refuses a shared line on purpose, so that a plain assign never drops a share by accident. Its undo row has always kept a line's shares and role before it ran, and `undo_reassign` already puts them back.

## Decision

1. **`assign_expense` takes `unshare`** (the spec's option A). On a shared line (role shared, or waiting in review as an unsplit shared cost), `unshare: true` removes its shares and files the whole line to `project_id` as a direct cost, under `category_id` or, if that is left out, the line's own category. Undo is `reassign`, as for any assign, and puts the shares and the shared role back. On a line that is not shared it changes nothing.
2. **The refusal stays the default.** `reassign_transaction` goes on with a shared line only under the transaction-local flag `flow.unshare`, which only `mcp_assign_expense` with `unshare` sets. Every other caller still gets the refusal.
3. **One line at a time.** Only that line moves. Other lines of the same supplier or charge keep their shares. `assign_expenses` takes `unshare` per row, so several lines move in one call with one `undo_batch`.
4. **A line split by category is refused** (`line has a split by category`). Its parts carry their own shares, and `split_line` moves them.

## Alternatives rejected

- **A single 100% share in `assign_expense_split` (option B).** A "split" into one project leaves the line with a shared role and one share, a shape no reader expects, and its undo and review rules would differ from an assign's.
- **A date range on `reassign_recurring_charge` (option C).** It covers only lines matched to a recurring charge, and a range picks lines by date rather than by what the person names. The batch with `unshare` does the same per line, and the lines it moves are listed.

## Consequences

- A shared cost that becomes one project's can be moved for exactly the lines that changed, and undone.
- The app is unchanged. Its shared-cost sheet still splits and joins lines through its own writes.
