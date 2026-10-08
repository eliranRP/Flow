# Unpaid supplier invoices stay out of the cash basis

**Date:** 2026-10-08
**Status:** Accepted

## Context

[0007](0007-bank-statement-is-primary-input.md) says that on the cash basis an unpaid invoice stays out of profit until a payment is linked or the owner marks it paid. The P&L reads did not follow it for expenses: an expense line counted by its document date on both bases, so a posted supplier invoice with no payment yet already lowered cash-basis profit. [0101](0101-unassigned-and-overhead-project.md) recorded this as a follow-up (FLOW-128).

## Decision

- An expense line whose document is a supplier invoice or credit note (`doc_kind` `invoice` or `credit`) and that has no cash date is **unpaid** (`private.line_unpaid`). `private.pnl_lines` carries it as the `unpaid` column.
- On the cash basis an unpaid line counts nowhere: not in the totals, the buckets, `count`, the excluded fields, the project card, its category lists, or the breakdown. Once it gets a cash date it counts.
- On the invoiced basis nothing changes: an unpaid supplier invoice counts by its document date.
- Every other expense line keeps counting by its document date on both bases. Bank lines and manual expenses always carry a cash date, so they are never unpaid. A pending bank line still counts on neither basis ([0086](0086-mercury.md)).
- The after-overhead view (`private.overhead_share`) still weights by invoiced income on both bases. The overhead cost it spreads follows the basis: on cash it leaves unpaid overhead invoices out, so the projects' shares add up to the cash `overhead_*` total.
- The owner was asked on 2026-10-08; this is the recommended answer ("leave unpaid out") and can still be switched to counting cash-basis expenses by payment date.

## Alternatives rejected

- Counting every cash-basis expense by its payment date. It also drops unpaid invoices, but it moves bank lines whose posting date differs from their document date across month ends, so today's monthly numbers would shift.

## Consequences

`company_pnl` (`get_dashboard`, MCP `get_totals` and `list_projects`), `get_project`, `get_breakdown`, `get_breakdown_lines` and `get_home` drop unpaid supplier invoices on the cash basis. Companies whose expenses all come from bank lines see no change.

Nothing sets a cash date on a supplier invoice yet: there is no mark-paid action and no link to the bank line that pays it. Whoever adds one must make sure the invoice and its bank line do not both count on the cash basis ([0007](0007-bank-statement-is-primary-input.md)).
