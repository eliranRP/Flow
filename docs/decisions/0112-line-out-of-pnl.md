# One line out of the P&L

**Date:** 2026-10-07
**Status:** Accepted

## Context

A category can be kept out of the P&L ([0099](0099-categories-outside-pnl.md), [0106](0106-kept-out-toggle.md)), but some single lines are not real income or expense either: a deposit that came back, a transfer between owners filed under an ordinary category. Keeping their whole category out also takes out every other line in it. The opposite also happens: one line in a kept-out category really is an expense. FLOW-108 was plan-first. Under the owner's standing rule for UI tasks, the design reviewer's recommended option A was built (mockups: [design canvas](https://claude.ai/artifact/QPLXZjbEdoy8x2H49EEuYS)).

## Decision

- **Data.** `transactions.in_pnl_override boolean`: `false` keeps the line out, `true` counts it although its category is kept out, `null` follows the category. `private.line_in_pnl(override, excluded, loan_part)` decides `in_pnl` in `private.pnl_lines`, so every P&L read (totals, projects, breakdown) follows it on both bases. The override covers every part of a split line. `get_project`'s category lists follow it too, so an out line moves to `excluded_categories_by_currency`.
- **Loan lines stay fixed.** A line with a loan split, or in a loan category, is refused (`loan line is fixed`); its parts decide what counts ([0107](0107-loan-split-on-the-transaction.md)). A loan category part never counts through a forced-in override, so principal never becomes an expense.
- **API.** `set_transaction_pnl(p_id, p_in_pnl)`, owner only; a viewer is refused. `get_transaction` adds `in_pnl`, `in_pnl_override`, `category_excluded_from_pnl` and `pnl_fixed`.
- **MCP.** `set_line_pnl` (one line) and `set_lines_pnl` (up to 200, partial success) with idempotency keys and the write rate limit. Undo kind `line_pnl` with the transaction id restores the prior override, or is `conflict` if it changed since; `undo_batch` undoes a `set_lines_pnl` batch.
- **Screen.** The transaction card's עוד sheet gets one secondary button above מחיקה: "מחוץ לרווח והפסד" or "החזרה לרווח והפסד", with a hint that says whether the line or its category put it out. It saves on tap with no confirm, like 0106; the toast "<party> · מחוץ לרווח והפסד" (or "· ברווח והפסד") offers ביטול, which restores the previous override. Going back to the category's own state always clears the override, so overrides don't pile up. An out line shows a ⊘ "מחוץ לרווח" status pill; a line forced in against a kept-out category shows "ברווח והפסד". A loan line gets a locked line instead of the button. Viewers see the pill and no sheet, as before.

## Alternatives rejected

- A switch row on every card: a stray tap changes totals, it adds a row for a rare action, and a switch cannot say why a line is out.
- A tappable status pill: pills are not controls anywhere else, and it is hard to find.
- A three-value enum column: a nullable boolean says the same with less code.

## Consequences

A line taken out appears in the Home drill-down's kept-out group and in the project's kept-out category list, never hidden. Transaction lists do not mark an out line yet (follow-up FLOW-124).
