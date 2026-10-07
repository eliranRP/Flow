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

## Update 2026-10-07 (FLOW-112)

- Default names match on a normalised key, `private.pnl_name_key`: lower case, apostrophes dropped, other punctuation to spaces (Hebrew letters stay part of the name), `&` and `and` dropped, and a plural `s` dropped from words of four or more letters. `Owner distribution`, `CapEx/Rehab`, and `Closing and acquisition costs` now start kept out. The migration backfills such names, except a category whose flag the owner already set through `set_category_pnl`.
- The default also runs on a rename (insert or update of `name` or `kind`), but only into a default name. A rename away from a default name, or between two default names, keeps the current flag, so an owner's choice is never undone by a rename.
- The three loan categories carry `categories.loan_part` (`interest`, `escrow`, `principal`, unique per company), seeded and backfilled by their Hebrew names. The database checks use `loan_part`: the loan split check, the default category guess, `set_category_excluded_from_pnl`, and `attach_loan_payment`, so a renamed loan category still passes them and stays fixed. Since FLOW-122 the app does too: the split sheet (`loan-match.tsx`) files each part under the category with that `loan_part`, offers the loan match on the `principal` category, and the categories screen marks the three loan categories by `loan_part`. The Mercury loan hint is `loan_part:principal`, which `upsert_connector_lines` resolves by key. The owner has no update grant on `categories` and no rename RPC, so only the seed sets `loan_part` and nothing renames a loan category today.
- `set_category_excluded_from_pnl` checks the caller's own company first. An owner who is also listed as a viewer of a demo company is no longer refused; a user who is only a viewer still gets `forbidden`.
- Still open in [FLOW-121](../backlog/TASKS.md#flow-121): whether a guessed kept-out category takes a line out before it is confirmed, and kept-out project income in `get_project`.
