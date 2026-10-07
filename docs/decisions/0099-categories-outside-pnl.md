# Categories outside the P&L

**Date:** 2026-10-07
**Status:** Accepted

## Context

`categories.excluded_from_pnl` already steers review and loan-split validation ([0088](0088-loans.md), [0091](0091-income-in-review.md)), but `company_pnl`, Home, project totals, and overhead weighting still summed every posted line. Owners could not toggle the flag from the API or MCP. English default category names for balance-sheet money had no automatic seed.

## Decision

- The single P&L setting per category remains `categories.excluded_from_pnl` (boolean). No three-type enum.
- `private.non_pnl_category(kind, name)` and a `BEFORE INSERT` trigger set the flag from an English name list (case- and space-insensitive). **Tax & insurance escrow** is not on that list (escrow counts in the P&L per [0088](0088-loans.md)). **Utility deposits** are kept out. The three Hebrew loan categories (`ריבית משכנתא`, `מסים וביטוח`, `תשלומי הלוואה`) stay fixed; `set_category_excluded_from_pnl` refuses them.
- All P&L reads use one view, `private.pnl_lines` (`in_pnl` per line). Excluded amounts are returned separately (`excluded_income_*`, `excluded_expense_*`, `excluded_count`; project `excluded_categories_by_currency`) so cash still reconciles.
- `public.set_category_excluded_from_pnl` (owner only) and MCP `set_category_pnl` with undo (`category_pnl`). `list_categories` returns `excluded_from_pnl`.
- UI to toggle the setting on `/settings/categories` is deferred until after loan-split P&L (PR B) and a design check.

## Alternatives rejected

- A `pnl_role`-style enum on categories: duplicates `transactions.pnl_role` (allocation) and was explicitly out of scope.
- Hiding excluded lines from totals with no separate fields: would make bank cash disagree with reported P&L buckets.

## Consequences

Loan payment parts in the P&L (follow-up PR) extend `private.pnl_lines` only. MCP `get_totals` and app schemas accept the new optional excluded fields. `list_project_category` still drills into excluded categories.

| Owner call (2026-10-07) | In code |
| --- | --- |
| Escrow / Tax & insurance escrow stays in P&L | Not in `non_pnl_category` defaults |
| Utility deposits kept out | In expense default list |
| Loan costs, failed acquisitions, partner loan interest stay in | Not in default list |
| One boolean flag | `excluded_from_pnl` only |
