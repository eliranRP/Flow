# Auto-approve high-confidence items

**Date:** 2026-09-26
**Status:** Accepted. [0080](0080-mcp-connector.md) (proposed) amends this: an MCP suggestion is not high confidence and does not skip the queue.

## Context

[0006](0006-confirm-not-type.md) already treats a bank row linked to an existing invoice, or a row covered by an existing supplier rule, as high confidence. It left the last step open: those rows could wait for a manual "Approve all", or an optional setting could approve them with no tap. The owner decided that on 2026-09-26.

## Decision

High-confidence items are auto-approved by default. High confidence means either of these:

- A bank row matched to an existing invoice.
- An existing supplier rule that assigns the project and the category.

Those items skip the review queue (`לאישור`) and count in reports immediately. After the batch, the owner sees a short summary of what was auto-approved. Any item in that summary can be reopened and changed.

Lower-confidence rows, including an AI guess that is not backed by an invoice match or a rule, still go to the review queue one card at a time. An MCP `assign_expense` or `set_expense_category` on an open review item is that kind of guess. It does not auto-approve. Only `approve_review`, or the owner's אישור, closes the item. [0080](0080-mcp-connector.md).

## Alternatives rejected

Opt-in auto-approve, and a flow whose only bulk action is a manual "Approve all".

## Consequences

The pending count on Home is the review queue, not the auto-approved set. A wrong rule still matters, because it will approve the next row from that supplier without a card; the summary is how the owner spots that and reopens the row. Reopening uses the same change sheet as a review correction, including "remember for this supplier" (`לזכור לספק הזה`).

[03-review-v2](../module-1-project-pnl/wireframes/03-review-v2.png) shows the auto-approved strip above the card and has no `אשר הכל` button. [08-upload-results-v2](../module-1-project-pnl/wireframes/08-upload-results-v2.png) groups those rows as `אושרו אוטומטית` and has no secondary approve button. The v1 wireframes that drew those buttons are superseded.
