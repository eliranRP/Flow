# Mercury income is an invoice-receipt

**Date:** 2026-10-07
**Status:** Accepted (owner)

## Context

The app's P&L uses the invoiced basis ([0060](0060-library-review-calls.md)). On that basis `company_pnl` counts income lines with `doc_kind` `invoice`, `credit`, and `invoice_receipt`. Mercury imported every inflow as `doc_kind: receipt`, so a company whose only income is in Mercury showed no USD income. The connector contract planned a `private.cash_receipt_counts_on_invoiced` predicate for Mercury receipts. It was never added.

## Decision

A Mercury deposit is received income. The adapter labels it `invoice_receipt`.

| Mercury line | direction | doc_kind |
| --- | --- | --- |
| Deposit, wire, cashback, or other inflow | income | `invoice_receipt` (was `receipt`) |
| Treasury interest, dividend, or positive amendment | income | `invoice_receipt` (was `receipt`) |
| Card refund or reversal (expense credit) | expense | `credit` (unchanged) |
| Outflow, treasury fee | expense | `expense` (unchanged) |

Migration `20261007010000_mercury_income_doc_kind.sql` relabels stored rows: `source = 'mercury'`, `direction = 'income'`, `doc_kind = 'receipt'`. It also refreshes `review_queue.doc_fingerprint` where the fingerprint matched the line as a receipt, so a skipped Mercury income line stays skipped. Functions deploy before migrations, so a sync in between can relabel a skipped line and queue it again; the migration closes that open row when the skip before it matches the line as a receipt. The relabel is `private.relabel_mercury_income()`, so pgTAP runs it on a fixture.

## Alternatives rejected

- The `cash_receipt_counts_on_invoiced` predicate in every invoiced-basis query. That is more SQL to keep in step, and the owner treats a bank deposit as received income.
- Converting Mercury income to `invoice`. A bank deposit is already paid, and an `invoice` with an `external_id` would show in `list_unpaid`.

## Consequences

- Invoiced-basis totals (`company_pnl`, `get_dashboard`, `get_project`, MCP `get_totals` and `list_projects`) now include Mercury income in its own currency bucket. Cash-basis totals and `get_home` already counted both kinds and do not change.
- SUMIT receipt-to-invoice linking (`list_unpaid`, `open_gross_agorot`) matches `receipt` with a `linked_external_id`. Mercury lines have no link, so nothing changes there.
- Review (0091) queues posted connector income by direction, not `doc_kind`. Income review cards show "הכנסה", not the doc-kind label.
- A Mercury deposit and a SUMIT invoice for the same income can both count on the invoiced basis. That known limitation from the connector contract stays.
- The relabel's update runs `transactions_fill_category`, as any later update or sync of the line does. A Mercury income line stored with no category, because no visible income default existed then, gets the default as a suggestion (`category_suggested`), and review still asks about it. Accepted (2026-10-09).
- MCP-first ([0095](0095-mcp-first.md)) exemption: data labeling only, no new user action. MCP totals already read `company_pnl`.
