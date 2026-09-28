# Onboarding creates the company, and Home can show the whole ledger

**Date:** 2026-09-28
**Status:** Accepted

The cash/invoiced switch in this record is amended by [0060](0060-library-review-calls.md). The proof of concept shows the invoiced basis only.

## Context

A first Google sign-in with no company row stopped on a title-only screen. The books for Flow Test also span April to September 2026, so a "this month" view hides most expenses. [0004](0004-cash-basis-for-v1.md) still makes cash the default. [0028](0028-period-sheet-with-custom-range.md) already opened the period from the band.

## Decision

`create_company(name, vat_registered)` is the onboarding step. עוסק מורשה stores `vat_rate_bp` 1800. עוסק פטור stores 0. One company per owner. An owner who already has a company skips the screen.

Home defaults to this month, cash basis. The period sheet also offers last month, year to date, and כל התקופה. A second control switches the same range to the invoiced basis (tax invoices, invoice-receipts, and credits). Comparison arrows appear only when both the current range and the previous range are bounded. כל התקופה has no arrow.

The Phase 0 Add hint is replaced by the entry form: income (a receipt, or an unpaid invoice) or an expense.

## Alternatives rejected

Leaving onboarding as a heading until a later phase. Showing only this month, which would not match the golden company totals.

## Consequences

A new Google user is not stuck. The golden check uses כל התקופה. This replaces the "Add sheet is a title and one hint" line in [0045](0045-phase-0-design-gaps.md).
