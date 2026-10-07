# Split one bank line across categories

**Date:** 2026-10-07
**Status:** Accepted

## Context

`assign_expense_split` splits a line across projects by whole percent with one category. Real lines mix several things: a closing wire carries a purchase price, fees and insurance; an inflow carries rent and a security deposit; one payment covers two projects in exact amounts that no whole percent reaches. The owner needs each part filed under its own category and project, to the cent (FLOW-311).

## Decision

- New table `public.line_splits`: one row per part with `category_id`, optional `project_id`, and `amount_minor` (whole minor units of the line's currency, above zero), in input order. A category and project pair appears once per line. Up to 50 parts.
- `private.pnl_lines` emits one row per part for a posted, non-removed line with two or more parts that sum to `abs(amount_net)` and no loan split. The part's category decides `in_pnl`, so a kept-out part (a purchase price, a deposit) goes to the `excluded_*` totals, like a loan split part ([0100](0100-loan-split-pnl.md)).
- A part with a project counts under that project with the project role, or the overhead role when it is the overhead project ([0101](0101-unassigned-and-overhead-project.md)). A part with no project keeps the line's project and role; on a shared line it is shared by the line's allocations in proportion, rounded half to even per part.
- Parts that no longer sum to the line (a bank re-sync changed the amount) are ignored and the line counts whole. `get_line_split` reports `parts_match: false` so the owner can fix them.
- A line takes a loan split or a split by category, never both; a trigger on each table refuses the other.
- `merge_category` moves the parts in the merged category to the kept one. It refuses a line with a part in each category for the same project (`a split line has both categories`); the owner fixes that split first.
- `public.save_line_split(transaction_id, parts)` replaces the parts (an empty array clears them) and marks the line as the owner's choice. It refuses a part whose category kind differs from the line's direction, a project or category of another company, parts that do not sum to the line, a line with a loan split, and a line with an open review (resolve the review first). VAT stays on the line; parts split the net amount.
- MCP write `split_line` wraps it with an idempotency key and the write rate limit. Undo kind `line_split` with the transaction id restores the parts and flags from before the write, or is `conflict` if the parts changed since. `get_expense` adds `line_split` for a split line.

## Alternatives rejected

- Whole percents or basis points: they cannot hit every cent amount, which was the problem.
- Reusing `allocations`: it splits by project only, under one category, and every P&L read already treats it as a project share.
- Closing an open review from the split: the review machinery snapshots one category per line; resolving the review first keeps both paths simple.

## Consequences

Every P&L read (totals, projects, categories, drill-down) follows the parts with no change outside the view and the category helper. A project's own transaction list still shows only lines filed to it or shared with it, not lines that reach it through a part (follow-up FLOW-312). Since FLOW-104 ([0103](0103-reversals-across-directions.md)) the view takes the P&L side from each part's category kind, like a whole line; `save_line_split` still requires each part to match the line's direction, and reversal parts are a follow-up (FLOW-312).
