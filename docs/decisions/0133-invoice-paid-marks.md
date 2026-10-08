# Marked paid stays marked until the sync closes the document

**Date:** 2026-10-08
**Status:** Accepted (owner chose option (a), "store it", for FLOW-330 on 2026-10-08)

## Context

On Unpaid, "סימון כשולם" only hid the row in screen state: the unpaid total never dropped (it sums every row), and after a reload the row was back. The owner chose to store a "marked paid, waiting for the sync" flag on the server, with an MCP tool that returns and sets it.

FLOW-412 is batched in: `list_project_category` had no basis, so on the cash basis its total counted unpaid supplier invoices that `get_project`'s category row leaves out ([0118](0118-unpaid-invoices-cash-basis.md)).

## Decision

**A mark per document.** `public.invoice_paid_marks` holds one row per open document (a row `list_unpaid` lists: a SUMIT `invoice` with an `external_id`, not removed, with an amount still open; a customer invoice, or a supplier invoice with direction `expense` and a negative amount, as the Unpaid screen has always listed them) that the owner marked paid, with its time and who marked it. Row level security lets the owner and viewers read it; nobody writes it directly. `set_invoice_paid(id, paid)` (owner only, a viewer is `forbidden`) adds the mark (a second mark keeps the first time) or clears it (clearing an unmarked one is a no-op). A document `list_unpaid` does not list is `invoice not found`; clearing is allowed on a closed one.

**The row stays listed.** `list_unpaid` keeps a marked document and returns `marked_paid_at` (and its `currency`). The screen shows it as waiting for the sync and leaves it out of the unpaid total. The mark stays until the document closes (a receipt or credit note from the sync brings its open amount to zero, so it leaves the list) or the owner clears it. It does not clear itself at the next sync: a sync that still shows the document open means SUMIT has no receipt yet, which is what the mark says. A mark left on a closed document does nothing; if a later sync removes the receipt and the document opens again, it comes back marked.

**No figure moves.** The mark changes no P&L figure on either basis and no MCP total except `list_unpaid`'s own split between open and marked. The money counts when the receipt arrives, as before.

**MCP.** `list_unpaid` (read) returns the documents in minor units with their `direction`, and totals per currency and direction: `open_gross_minor` (not marked) and `marked_gross_minor`. `set_invoice_paid` (write: idempotency key, write rate limit) sets or clears the mark; undo kind `invoice_paid` with the transaction id puts the mark back as it was (with its first time and author) or takes it away, and is `conflict` when the mark is not the one the write left (compared by its time, so a mark cleared and set again counts as a change). The write locks the document before it reads the mark, so of two writes that queue, the second records the mark the first left.

**The category drill-down on the cash basis (FLOW-412).** `list_project_category` takes `p_basis` (`invoiced` by default, as before; `cash` leaves out unpaid supplier invoices and credit notes, like `get_project`) and echoes `basis`. The app passes its one books basis.

## Alternatives rejected

- Clearing the mark at the next sync: a mark would vanish while the document is still open in SUMIT, which is the reload bug again.
- Dropping a marked row from `list_unpaid`: the owner could not see or clear what they marked.
- Keeping the button as a reminder only (option (b)): the owner chose to store it.
