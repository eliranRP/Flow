# Pending bank lines are hidden until they post

**Date:** 2026-10-18
**Status:** Accepted

## Context

[0086](0086-mercury.md) kept a Mercury line that is still pending at the bank visible: it waited in לאישור tagged ממתין and showed in lists, but no total counted it. The owner saw a charge in the app that the bank had not approved yet and asked to see only approved transactions. The owner's words: show only approved transactions.

## Decision

This record supersedes the pending rule of [0086](0086-mercury.md). A line with `line_status = 'pending'` shows nowhere in the app until Mercury posts it.

The sync stores a pending line as before. No ingestion rule changes and no stored line is deleted or voided. The line is hidden when it is read:

- לאישור does not queue it. `sync_review_queue` no longer queues pending income as `pending_income` and does not queue a pending expense. An open review row of a line still pending is removed; the line is not. Settled rows (approved, changed, skipped) stay, so an answer the owner gave is kept.
- When the line posts, the same row turns `posted` and the next queue sync (the upsert runs it after each batch) queues it once, like any other line.
- `list_review`, the review count on Home, the waiting push count, a project's waiting lines and their sum, search and its month totals, the project's transactions list, a loan's payments, a party's charges, the recurring reads (usual amount, arrivals, schedule, latest line, match suggestion, lender suggestion), category line counts, receipt matching and the new-lines push read posted lines only.
- A pending line opened by id (`get_transaction`) reads as not found.

Totals already counted posted lines only, so no total moves.

## Alternatives rejected

Skipping pending lines in the sync. A line can change while pending, and a stored row lets the posted line keep the same row.

Showing pending lines tagged ממתין. That is the rule the owner reversed.

## Consequences

The ממתין mark on a party's charges and the unused בהמתנה chip on the statement row are removed, with the `pending` key on each charge and the `line_status` fields the app schemas no longer read.

A line that was pending when it first arrived is not announced by the new-lines push when it posts; it reaches לאישור and the waiting count.

The rule is in the migration `pending_lines_hidden` and in the [connector contract](../tech/connector-contract.md).
