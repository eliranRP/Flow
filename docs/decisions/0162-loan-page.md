# The loan page, closed loans and no reorder

**Date:** 2026-10-09
**Status:** Accepted (FLOW-106 screens, FLOW-110; the owner picked layout B and dropped reorder on 2026-10-09)

## Context

Loans gained kinds, rate changes, a status with a close date, part categories, fees and delete with undo (decisions 0122, 0128, 0132, 0142). The loans page under Settings (0116) showed only the balance and the project, and a row opened the project sheet. FLOW-110 also asked for a persisted order on the list.

## Decision

1. Each loan has its own page at `/settings/loans/:id` (layout B of the screens plan). A list row opens it, for the owner and a viewer alike; a viewer reads it as static rows. Every setting on the page saves alone from a small sheet, with its own refusal and a toast with ביטול: kind, rate changes, project (moved here from the list), status, and each part's category.
2. Paid-off and closed loans stay on the list, muted, under a quiet "נסגרו (N)" that starts collapsed on every visit.
3. No reorder. Loans stay alphabetical. `sort_order` and MCP `reorder_loans` stay for the assistant, and the app does not read them.
4. Delete lives on the loan page. The confirm names how many payments go back to their category, and the toast after it has ביטול, which calls `restore_loan`.
5. The payments section reads `mcp_loan_payments`: the last 3, then כל התשלומים in place.
6. A demand loan cannot switch to another kind from the page: it has no term to build a schedule on.

## Consequences

- The project is no longer changed from the list. CONTROLS and the FLOW-119 tests moved to the loan page.
- A status change picks its date from the last attached payment on, so `loan_payments_after_close` is rare; when it comes back it shows inside the date sheet.
- The split editor and the match sheet's demand loans wait for the loan-match work on the transaction screen.
