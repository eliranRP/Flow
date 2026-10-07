# Reversals across directions

**Date:** 2026-10-07
**Status:** Accepted

## Context

Until now a line's category kind had to match its direction ([0091](0091-income-in-review.md) and the earlier review rounds). Rent that bounced and was taken back is an outflow that belongs under income. A supplier refund is an inflow that belongs under an expense category. Owners had to file these under the wrong side, or leave them uncategorised.

## Decision

- The category kind decides the P&L side. `transactions.direction` and the signed `amount_net` stay as stored: expenses negative, income positive. An outflow under an income category adds a negative amount to income. An inflow under an expense category is a negative expense, because the expense totals still negate the sum.
- `private.pnl_lines` gets one new last column, `kind`: the category kind, or the direction when the line has no category. For a split loan payment it is the kind of the part's category.
- Basis. A reversal income line (direction `expense`, income-kind category) counts on both bases whatever its document kind: cash by `coalesce(cash_date, doc_date)`, invoiced by `doc_date`. A reversal expense line (direction `income`, expense-kind category) counts like any expense line: no document-kind filter, by `doc_date`. Lines that are not reversals keep today's filters.
- `company_pnl` (including `by_currency`, `other_currencies`, projects and the excluded totals), `get_project`, `get_home`, the project category helper and the overhead income weights read `kind` instead of `direction`. The excluded totals follow the same rule: a kept-out income-kind outflow is negative excluded income, a kept-out expense-kind inflow is negative excluded expense.
- `reassign_transaction`, `resolve_review` and `set_transaction_category` no longer refuse a category of the other kind. `approve_split_review` accepts it too and still refuses a missing category.
- Role and project follow the category kind. An income-kind category on an outflow needs a project the same way income does, with the same off-P&L exception, and leaves `pnl_role` empty with no allocation. An expense-kind category on an inflow needs a project, sets `pnl_role` to `project` and writes one allocation. When `resolve_review` changes only the project, the kind comes from the category it was given, else from the line's own category. `set_transaction_category` keeps a shared or overhead line's role and shares, and moves only a line filed to one project.
- Unchanged: auto-suggest (`private.fill_suggested_category`), connector upserts, `loan_splits_check` and `mcp_assign_expense_split` keep the same-kind rule. The `private.mcp_refused` whitelist keeps its messages.

## Alternatives rejected

- Counting a reversal by the line's direction and flipping its sign: the category kind is what the owner chose, and the totals by category already follow it.
- A new `reversal` flag on the line: the kind and the direction together already say it.

## Consequences

The app category picker still lists the line's own kind. A "reversal" section for the other kind is a later small UI task. A shared, split or overhead outflow under an income category counts as company income with no project, and is not allocated across its shares: every read (`company_pnl`, `get_project` shared amounts, the overhead share) skips it as a cost. `set_transaction_category` does not ask for a project, as before. Round 4, 5 and 8 pgTAP assertions that expected the mismatch error now assert acceptance. pgTAP `reversals.test.sql`.
