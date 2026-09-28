# A SUMIT row stays in the P&L while it waits

**Date:** 2026-09-28
**Status:** Accepted. [0063](0063-owner-ledger.md) removed the Edge Function copy of the worker-day table. The table stays in the fixture for the parity test. [0064](0064-review-round4.md) records that this amends [0006](0006-confirm-not-type.md) for SUMIT rows already in the books.

## Context

[0006](0006-confirm-not-type.md) says a row enters a report only after the owner confirms it. SUMIT documents are already the books. Holding them out of profit until Review would hide the contractor's invoices and miss the totals the owner expects to see.

The golden P&L still needs the site-worker split (`shared_alloc_worker_days` in the demo fixture). That table is an answer key for the parity test. Sync does not copy it, and it does not special-case any SUMIT company.

## Decision

A SUMIT document is written into the ledger as soon as a complete sync accepts it. It counts in `company_pnl` while an expense with no category sits on the review queue. Approving or changing the row sets the project and category. Skipping leaves the amounts as they are and closes the card. Income is given the default income category at sync and does not enter the queue. [0064](0064-review-round4.md).

The worker-day weights are not applied by sync. The owner enters a shared-cost split with `save_split`. The parity test still checks the fixture's results.

This amends [0006](0006-confirm-not-type.md) only for SUMIT rows that are already in the books. A manual row still waits for confirmation before it is part of the report.

## Alternatives rejected

Holding every SUMIT row out of profit until a person approves it. Copying the fixture's worker-day table inside the Edge Function.

## Consequences

Home already includes SUMIT money that is still on the review queue. The worker-day table lives in the fixture. Sync never writes it.
