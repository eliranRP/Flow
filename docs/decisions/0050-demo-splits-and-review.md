# Flow Test splits are rules, and a SUMIT row stays in the P&L while it waits

**Date:** 2026-09-28
**Status:** Accepted

## Context

The golden P&L needs the site-worker split (`shared_alloc_worker_days` in the demo fixture). SUMIT's document list does not include the expense-item name, so Flow cannot copy the fixture's item→category map off the wire. [0006](0006-confirm-not-type.md) says only an approved row enters a report. Waiting for that approval would hide every uncategorised expense and miss the golden totals.

## Decision

For SUMIT company 2389917160 only, sync copies the worker-day table onto `split_rules` / `split_rule_targets` (method `worker_days`, supplier כוח אדם מקצועי א.ר. בע"מ) and splits each shared expense with those weights. The same company maps known supplier names to the default categories. ביטוח המגן בע"מ is VAT-exempt.

Any other supplier is stored with no category and an open review row (`missing_category` or `missing_project`). The row still counts in `company_pnl`. Approving or changing it sets the project and category. Skipping leaves the amounts as they are and closes the card.

This is the smallest reading of the list API that still matches [0043](0043-assumed-vat-on-expenses.md) and the golden file.

## Alternatives rejected

Calling `getdetails` for every expense to read the item name. Holding SUMIT rows out of profit until a person approves them. Guessing a category other than the demo map.

## Consequences

A contractor who is not Flow Test will see a review card per uncategorised expense, and Home will already include the money. The worker-day table is duplicated in `supabase/functions/_shared/flow-test.ts` and checked against the fixture's results by the ledger parity test.
