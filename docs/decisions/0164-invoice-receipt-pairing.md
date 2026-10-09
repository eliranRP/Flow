# A connector invoice and its receipt are one review card

**Date:** 2026-10-09
**Status:** Accepted (owner, option A)

## Context

SUMIT sends a customer's tax invoice (חשבונית מס) and, when the customer pays, a receipt (קבלה) that names the invoice (`linked_external_id`). Both are posted income lines with no project, so review queued two cards for one payment, and the owner filed the same project and category twice. The invoiced basis counts the invoice and the cash basis counts the receipt, so both lines need the same filing.

## Decision

One card per payment (FLOW-309 option A, mockup `mockups/plan-first/flow-309-pair/a.png`): the receipt joins its invoice, the card shows "✓ שולם · קבלה dd/mm" under the amount, and one approval files both. The receipt never gets a card of its own.

**Matching rule.** A receipt pairs with an invoice when both are income lines from the same connector in the same company, neither is removed or void, and the receipt's `linked_external_id` is the invoice's `external_id`. An invoice can have several receipts (part payments); a receipt has one invoice. `private.invoice_receipts` and `private.receipt_invoice` hold the rule.

**Status rules** (`private.follow_invoice`):

1. While the invoice waits in review (an open row, or a skip as its latest row while the invoice is still unfiled), its receipts have no open review row. A receipt's own `split_mismatch` row stays.
2. When the invoice is settled and filed (a category, and a project unless the category keeps it out of the P&L), each receipt takes its project, category and role. A settled invoice row (approved or changed) gives the receipt a closed row with the same status, `paired_with` naming the invoice row, and a snapshot of the receipt's own values. An invoice filed without review moves its receipts the same way, with no row.
3. A receipt the owner filed on their own (owner-assigned with no paired row, a settled row of its own, a split by category, or a refiling after the joint approval) keeps that filing and stops following its invoice. A receipt a rule already filed moves only when the owner approves or changes the invoice in review; a sync, a change to the line, or the deploy pass leaves it, so deploying moves no filed receipt.
4. Undo: when a settled invoice row opens again (`reopen_review`, `undo_reassign`, MCP `undo`), each receipt row paired with it puts the receipt back from its snapshot and is removed. A receipt the owner refiled since is only unpaired.

Two triggers apply the rules, so every write path follows them without its own code: one on `review_queue` (a row added, or its status changed) and one on the invoice and receipt lines (an invoice added or refiled, a receipt added or relinked).

**Read.** `list_review` adds three fields to every item: `receipts` (each paired receipt's `transaction_id`, `doc_date`, `amount_gross`, `currency`, oldest first; `[]` when none), `paid` (the receipts cover the invoice after its credit notes, the sum `list_unpaid` uses; a pair shares one source, and SUMIT lines are ILS only, so the sums share a currency; a mark from Unpaid's "שולם" (0133) is not a receipt and does not set it) and `paid_on` (the latest receipt's date). MCP `list_review` and `search_expenses` (pending) pass them through.

## Alternatives rejected

- Hiding the receipt only in the app. Counts elsewhere (the tab badge, the evening push, `project_waiting`) would still count two items, and the receipt would stay unfiled.
- Patching each write function (`resolve_review`, `reassign_transaction`, `set_transaction_category`, `undo_reassign`, `reopen_review`, MCP writes). More code to keep in step; a trigger covers every path, including later ones.
- Pairing a Mercury deposit with a SUMIT invoice. Mercury lines carry no link to the invoice; that stays the known limitation from 0097.

## Consequences

- On deploy, a receipt already waiting for review (or still unfiled) joins its invoice, or takes the invoice's filing when the invoice is already filed. A receipt already filed is not touched.
- An approval that runs while a sync holds the receipt skips it rather than wait (the two could deadlock); a receipt left unfiled that way is queued by the next sync and pairs then. Undo still waits for the receipt, so it can fail with a deadlock error and be retried.
- On deploy, a receipt the owner had skipped on its own is filed with its invoice when the invoice is already settled; its new approved row has the deploy time.
- The receipt's approved row means a late receipt filed this way does not show on "filed automatically today" (owner rows are left out there since FLOW-309).
- An invoice that is shared, overhead or split by category does not move its receipts; a receipt that followed it before keeps that filing.
- The review card UI (the "✓ שולם" line) is UI lane 2's, on these fields.
