# Income in review

**Date:** 2026-10-06
**Status:** Accepted
**Supersedes:** [0064](0064-review-round4.md) §3 (income stays out of review), [0075](0075-save-on-tap-and-on-leave.md) §9 (income has no project), [0050](0050-review-round3.md) income card copy where it assumed no project row.

## Context

Connector income arrived with a default category but no project. Owners still need to assign a project for P&L unless the category is off-P&L. Mercury USD lines should not show Israeli VAT copy on the review card.

## Decision

Posted connector income without a project enters לאישור with reason `missing_project` (or `missing_category` when uncategorised). Approval and reassignment require a project unless the category is `excluded_from_pnl`. The review card shows a project row for income, uses "הכנסה" on the source line for SUMIT and Mercury income, and omits VAT hint text when `currency` is not `ILS`. The primary button opens the next missing picker (`בחירת פרויקט` / `בחירת קטגוריה`) before `אישור`. Category pickers with at most eight options hide search and use a fit sheet; project pickers stay tall.

## Alternatives rejected

- Leaving income out of review (old 0064 §3): USD and SUMIT income without a project never reached a project pick.
- Optional project on income: would diverge from expense rules and project P&L.

## Consequences

- `sync_review_queue`, `resolve_review`, and `reassign_transaction` queue and persist income projects.
- `private.fill_suggested_category` default fallback skips `excluded_from_pnl` categories.
- Project figures for USD income still ignore non-ILS income in `get_project` until a later change.
