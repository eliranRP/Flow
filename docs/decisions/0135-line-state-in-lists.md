# Lists say where a line came from and whether it counts; a split line has a P&L state

**Date:** 2026-10-08
**Status:** Accepted (FLOW-124 items 1 and 2, FLOW-125 item 1, server parts)

## Context

The transaction lists (a category drill-down, a project's waiting rows, לאישור, שויכו היום, the breakdown lines) passed a fixed `source="invoice"` because the reads did not return the line's source, so bank lines showed the document icon (FLOW-125). They also did not say when a line was out of the P&L, so a kept-out line looked like any other (FLOW-124). `get_project`'s `transactions[]` already had both ([#166](../../supabase/migrations/20261010110000_project_rows_kept_out.sql)).

On a line split by category, `get_transaction`'s `in_pnl` reads the line's own category. A split whose parts are partly kept out showed no pill, and the hint named the line's category (FLOW-124).

## Decision

**One rule for a line's state.** `private.line_pnl_state(transaction, project, category)` is `in`, `out` or `mixed`. A posted line reads its parts in `private.pnl_lines`, the rows every total counts from: all parts in is `in`, none is `out`, some is `mixed`. When a project and a category are given and the line has parts there, only those parts count. A pending line, which `pnl_lines` does not hold yet, follows the line rule `get_transaction`'s `in_pnl` uses (so a guessed kept-out category still counts).

**`get_transaction` returns `pnl_state`.** It sits next to `in_pnl`, which is unchanged. MCP `get_expense` passes it through. The app drives the split-line pill and hint from it.

**Each list row returns `source` and `kept_out`.**
- `list_project_category` and `project_waiting`: `kept_out` is the state of the line's parts on that project (and category), so the kept-out part of a split line is kept out in its category's drill-down and the counted part is not.
- `list_review` and `list_auto_assigned_today`: the whole line. A mixed line is not kept out; the detail shows it.
- `get_breakdown_lines`: every row is already a part in or out of the P&L (`p_excluded` picks which list), so `kept_out` is `p_excluded`.

MCP `list_review` and `search_expenses` (pending) rows pass `kept_out` through.

Each read is patched from its current definition, so earlier changes to it (viewer reads, the basis) stay.

## Alternatives rejected

- Working the state out in the app from the override and the category flag: that is the bug on split lines, and it would repeat the P&L rule in a second place.
- A whole-line `kept_out` everywhere: a split line's kept-out part would show as counted in its own category's drill-down.
