# Anomaly flags, recurring suppliers, missing bills and expected months, from SQL

**Date:** 2026-10-08
**Status:** Accepted (owner's FLOW-701 answers, 2026-10-08)

## Context

FLOW-701 items 3 and 4. The owner chose anomalies as a flag on the review card, with no new screen, and recurring patterns that feed both missing-bill notices and expected future months. Numbers come from SQL, never from Jev ([0084](0084-jev-auto-prefill.md)). [0018](0018-two-notifications.md) allows exactly two push notifications, so a missing bill is something to read, not a push.

## Decision

Everything is computed when it is read, for the caller's company (`private.readable_company_id()`). Nothing is stored. Amounts, history and percentiles read posted lines that are not removed: a pending line is in no total ([0086](0086-mercury.md)), though it still counts as this month's bill. Income reads the invoiced basis (`invoice`, `credit`, `invoice_receipt`), so an invoice and its receipt count once. A party is the supplier of an expense line or the customer of an income line. Amounts are `amount_net` in the line's currency (minor units, expenses negative), grouped by currency. "Today" is Asia/Jerusalem.

**Anomaly candidates** (`review_anomalies(ids[])` for the card, at most 500 ids; `mcp_review_anomalies()` for the open review lines, newest 500):

- `duplicate`: another posted line of the same party, direction, document kind, currency and gross amount within 7 days. It names the other line. A document and the one it links to (an invoice and its receipt), an invoice that a credit note cancels, and payments of two different loans are not duplicates.
- `amount_spike`: at least 3 times the median of the party's last 12 lines in the year before, and at least 10000 minor units more (100.00 in that currency). It needs 3 such lines.
- `new_party_large`: the party's first line, at or above the company's 90th percentile line amount in that direction and currency over the year up to the newest line asked about (one figure per read, so a long list stays fast). It needs 20 such lines.

A flag is a reason to look. It does not block approval and it does not change the line.

**Recurring parties** (`private.recurring_parties`): a party with lines in at least 3 of the last 6 complete months and in one of the last 2. Its typical amount is the median monthly net. Its typical day is the median first day in the month. Its usual project and category are the most common ones in that window.

**Missing bills** (`missing_bills()`): recurring suppliers with no expense line this month, once today is past their typical day plus 5. When that falls after the month's end, the bill is missing on the month's last day. Each carries the expected-by date, the typical amount, and the usual project and category.

**Expected months** (`expected_months(months 1..12, project_id)`): this month and the next ones. This month counts only the recurring parties not seen yet. Later months count every recurring party. A project filter keeps the parties whose usual project it is (input for FLOW-403).

MCP read tools: `get_anomalies`, `get_missing_bills`, `get_expected_months`. The review card flag and where missing bills show in the app are UI work for the design thread.

## Alternatives rejected

A stored anomalies table filled by the sync. It goes stale when a line is edited or removed, and the card reads only the lines on screen. Asking Jev to find anomalies or forecast. The numbers would not come from SQL. Jev scoring the SQL candidates (to rank them, or to say in words why one looks wrong) is a later step under the daily cap.

## Consequences

The thresholds (7 days, 3 times, 100.00, 90th percentile, 3 of 6 months, 5 days of grace) are constants in SQL. They are tuned by a later migration if the owner finds the flags too loud or too quiet. A supplier that bills every two months is not recurring under this rule.
