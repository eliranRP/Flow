# SUMIT schema-drift check

**Date:** 2026-10-09
**Status:** Accepted (FLOW-510)

## Context

The SUMIT sync reads documents from the CRM `listentities` call, through `Accounting_*` fields SUMIT does not document. Every sync is a full sweep: a document SUMIT no longer returns is voided, unless more than half are missing (`sync_sweep_suspicious`). So if SUMIT renamed or retyped one of those fields, the rows would stop mapping, and every document lost below that half-way guard would be voided in the books without a word. The tech plan (R11, P3-10) asked for a drift check with a fallback and an alert.

## Decision

The sync counts the rows it maps and, for each row it cannot map, the field that broke. A row of a kind the sync does not read (a quote, an order) is skipped by design and is not counted. A row with no definition enum is counted, because a renamed enum field would otherwise make every row look like another kind. A page without its `Data` field, or whose `Data` has none of the row-list keys, is drift too; a null `Data` or an empty list is an empty company. The kinds skipped by design are logged by definition number, so a kind SUMIT renumbers shows up in the log (it cannot be told from a quote by the row alone).

When more than 1 in 20 of the counted rows broke, the sync stops before it writes. The fallback is the last good ledger: nothing is voided or changed. The connection records `sync_schema_drift` through `note_sync_failure`, Settings reads it from `sumit_status`, and the next try waits 15 minutes, as for `sync_failed`. The function log names the broken fields and their counts, never values. Below that share the broken rows are dropped as before and logged the same way.

`accounting/documents/list` is not used as a second source. Flow reads only `DocumentID` and the download link from it today, and filling amounts, VAT, budget sections and parties from it would mean guessing fields no real response has shown. The debounced SUMIT webhook (P3-11) is not built: it needs a new public function, SUMIT triggers on the customer's plan, and a flag, which is not a small change.

## Consequences

A SUMIT change shows up as one Settings error and a log line instead of a quietly emptier ledger. Settings shows the generic Hebrew error for the new code until a UI lane adds its own line to `app/src/sumit-copy.ts`.
