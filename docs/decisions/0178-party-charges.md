# A line's charges from the same party

**Date:** 2026-10-10
**Status:** Accepted (FLOW-431, the owner's pick B: a "לעומת הרגיל" chip that opens a sheet)

## Context

The קבועים screen shows a recurring charge that went up or down by a percent, but opening the payment showed only that line. The owner wanted to see the earlier charges from the same supplier, and the usual amount the percent is measured against.

## Decision

1. `public.party_charges(p_id, p_today)` reads one line's supplier (expense) or customer (income) in the line's currency, from the lines `private.recurring_parties` counts: not removed, not void, and for income only invoices, credits and invoice-receipts. It returns the line's month total, the usual amount, the signed percent, the party's 6 months up to the line's month and its 12 newest charges.
2. The usual amount is the recurring rule's (decision [0172](0172-recurring-charges.md)) when the party recurs as of the line's month with at least one complete month, so the chip agrees with the קבועים row. Otherwise it is the median of the party's earlier complete posted months when it has at least 2 of the last 6. With less history there is no usual amount and no chip. There is no percent either for a line the rule does not count (an income receipt; its invoice is compared) or for a month that went the other way (a refund month). The charges listed are the 12 newest up to the line's month.
3. The transaction screen shows one chip under the status pills, "▲ 92% לעומת הרגיל $11.99" (red only for an expense up or income down), or "כמו הרגיל $11.99". A tap opens a sheet with the percent, 6 quiet month bars and the charges; each other charge opens its own line.
4. MCP `get_line_charges` returns the same read for the bookkeeping agent.

## Consequences

- A read only; nothing is stored. It is `stable`, so the live smoke allows it.
- A line in an older month is read against the usual amount of its own month.
