# Flow — Calculations

Exact definitions for Module 1. Screen specs use these rules and do not invent a second formula. Decisions in force: cash basis ([0004](../decisions/0004-cash-basis-for-v1.md), [0007](../decisions/0007-bank-statement-is-primary-input.md)), net of VAT ([0001](../decisions/0001-management-tool-alongside-accounting.md)), auto-approve ([0011](../decisions/0011-auto-approve-high-confidence.md)), overhead in the company total ([0009](../decisions/0009-scalable-pickers.md)).

The calendar is `Asia/Jerusalem`. A "date" is a calendar date in that zone, never a UTC day that slips across midnight.

## Money representation

Every amount is stored as an integer number of agorot. 1 shekel = 100 agorot. Reports add agorot, then display.

Each counting line has:

| Field | Meaning |
| --- | --- |
| `signed_net_agorot` | Cash movement, net of VAT. Positive = money in. Negative = money out. |
| `vat_agorot` | VAT tied to that line. Always ≥ 0. Not part of profit. |
| `category.type` | `income` or `expense`. |
| `bucket` | One project, or overhead. |
| `status` | `suggested` or `approved`. Auto-approved rows are `approved`. |
| `paid` | True when a bank row, or a manual cash/cheque the owner marked paid, exists. |
| `date` | The cash date (statement value date, or the date the owner entered for cash). |

A split parent is not counted. Its lines are. The lines' `signed_net_agorot` sum to the parent's net, and their `vat_agorot` sum to the parent's VAT. See [Splits](#splits).

### Rounding

| Use | Rule |
| --- | --- |
| Stored money | Integer agorot. No binary floating point. |
| VAT Flow computes (manual entry only) | `vat_agorot = round_half_away_from_zero(net_agorot × rate_bps / 10000)`. `rate_bps` is the company VAT rate in basis points. The draft default is 1800 (18%). Extracted VAT on a document is stored as printed and is never replaced by this formula. |
| Whole-shekel display (tiles, project rows, list profit, category totals) | `round_half_away_from_zero(agorot / 100)` to an integer. Group thousands with a comma. Prefix `₪`. |
| Detail display (one transaction, review card, VAT line) | If `agorot` is divisible by 100, show whole shekels. Otherwise show exactly two decimal places (the agorot). |
| Percent (margin, budget used) | `round_half_away_from_zero(numerator / denominator × 1000) / 10`, so one decimal place. If the tenth is 0, show a whole number (`20%`, not `20.0%`). |
| Half away from zero | 50 agorot rounds to 1 shekel. −50 agorot rounds to −1 shekel. A percentage of exactly n.x5 rounds away from zero. |

Negative displayed amounts use the Unicode minus `−` (U+2212), in red. A positive profit on a profit tile is green and has no plus sign. A signed cash row (money in on a transaction list) shows `+` as well as green. Zero is `₪0`, neither green nor red, with no minus.

Hebrew UI is right to left. The amount itself is left-to-right.

## What counts

A line is included in income, expenses, profit, margin, budget-used, and Home activity only when all of these are true:

1. `status` is `approved`.
2. `paid` is true.
3. The line is not an own-account transfer. Transfers are removed on import and never become lines.
4. `date` falls in the selected period.
5. `bucket` is in the selected scope (one project, overhead, or the whole company).

Excluded, and therefore not in the tiles:

- Suggested rows still in the review queue.
- Unpaid invoice documents, including partially paid invoices' remaining balance. The payment that already arrived counts; the unpaid remainder does not.
- Own-account transfers.
- A split parent, once its lines exist.

The Home pending banner counts suggested rows only. It does not count unpaid invoices. Tiles stay approved-and-paid even while the banner is up, so the banner is the signal that the picture can still change.

## Income, expenses, profit, margin

For a scope and a period, over counting lines:

- **Income** = sum of `signed_net_agorot` where `category.type` is `income`.
- **Expenses** = sum of `−signed_net_agorot` where `category.type` is `expense`.
- **Profit** = income − expenses.

A supplier refund is money in (`signed_net_agorot` > 0) with an expense category. It lowers expenses. It does not raise income. A refund to a client is money out with an income category (`תקבול מלקוח` or `הכנסה אחרת`). It lowers income.

**Margin** = profit / income, displayed with the percent rule above. The project tile shows `רווח · {margin}` when profit ≥ 0, and `הפסד · {margin}` when profit < 0. The percent is the absolute value of profit / income. If income is 0, the percent is omitted (a loss with no income is not a margin). Company Home does not show a margin, only `רווח/הפסד`.

Category bars on a project use the expense sum for that category over project-to-date counting lines. A refund lowers that category's bar. The bar widths are shares of the largest category, not of income.

## Period filters

[0019](../decisions/0019-home-periods-and-comparison.md). No custom range. The calendar is `Asia/Jerusalem`.

| Label | Where | Included dates |
| --- | --- | --- |
| `החודש` (this month) | Home, default | The whole calendar month that contains today, from the 1st through the last day of that month. A row dated later this month is included. A row dated next month is not. |
| `חודש קודם` (last month) | Home | The whole calendar month before the one that contains today. |
| `מתחילת השנה` (year to date) | Home | 1 January of the current year through today, inclusive. A row dated after today is excluded until that day arrives. |
| `מתחילת הפרויקט` (project to date) | Project screen, default; projects list | Every counting line on that project, any date. No end cap. The project screen does not offer the Home periods. |

Changing the Home period recomputes tiles, the comparison arrows, the top 5, the collapsed-row profit, overhead, and activity. It does not change the review-queue count.

### Comparison arrow

Income, expenses, and profit on Home each show an up or down arrow and a percent, using the percent rounding rule. The change is `(current − baseline) / |baseline|`.

| Selected period | Baseline |
| --- | --- |
| This month | The full previous calendar month. |
| Last month | The full month before that. |
| Year to date | Not shown. Comparing a year-to-date sum with one month is a different question, and it is [open](../open-questions.md#year-to-date-comparison). |

Direction follows the sign of the change. Zero change shows `0%` and no arrow. If the baseline is 0 and the current total is not, show the arrow and no percent. If both are 0, show nothing beside the total.

Color is whether the change helps: income up and profit up are green; income down and profit down are red; expenses up are red; expenses down are green. A zero change is neutral.

[01-home-v3](screens.md#01-home-v3) draws the three periods and these arrows, including color for whether the change helps. That image is pending owner approval. [01-home-v2](screens.md#01-home-v2) is superseded and still shows only two segments.

## Overhead

Overhead (`הוצאות כלליות`) is a bucket, not a project the owner creates or deletes. Company figures are the sum of every project plus overhead. A project figure never includes overhead.

Home always paints overhead as its own row under the projects, including when the top 5 are sorted by losses. Overhead is not eligible for the top 5. If overhead's profit for the period is 0 and the company has no projects and no transactions, Home uses the empty state and hides the row.

Hiding a project from the top 5 does not remove it from the company tiles. The collapsed row's profit is the sum of counting lines on projects that are not in the top 5.

**Activity** for "top 5 this month" is the sum of the absolute value of `signed_net_agorot` of counting lines on that project in the selected Home period. Ties break by most recent cash date, then by project name.

**Losses first** (`הפסד קודם`) ranks projects by profit ascending (largest loss first). A project with no counting lines in the period is listed after projects that have lines. Overhead stays pinned at the bottom either way.

If fewer than five projects have any lines in the period, Home lists those projects and hides the collapsed row. Finished projects with no lines in the period stay out of the list and out of the picker. Their older lines still sit in year-to-date and in project-to-date reports.

## Budget versus actual

Budget is optional ([0014](../decisions/0014-optional-project-budget.md)). The card `הוצאות מול תקציב` is shown only when the project has a budget greater than 0.

- Used = project-to-date expenses (the sum above), not the Home period.
- Percent used = used / budget, percent rule.
- The bar fills to `min(percent, 100)` visually. The label shows the true percent, including values over 100.
- A budget of 0 is treated as unset. The card is hidden.

## VAT

Tiles, profit, category bars, and budget-used are net of VAT. VAT is displayed beside a single transaction and is included in the accountant export. VAT is never added into profit.

A VAT-exempt line has `vat_agorot = 0` and counts at its net. Extracted VAT is kept even when the company is `עוסק פטור`: the supplier still charged VAT. Manual entry defaults VAT to 0 when the company status is exempt, and to the computed amount when the company charges VAT.

## Splits

The owner splits one cash amount across projects by amount or by percent. Category is the one chosen on the change sheet, copied to every line.

- Amount mode: each line's net agorot is entered. Save is blocked until the lines sum to the parent `signed_net_agorot` exactly.
- Percent mode: each line's percent is entered, one decimal. Flow converts to agorot by the largest-remainder method so the lines still sum exactly to the parent. Save is blocked until the percents sum to 100.0.
- VAT uses the same largest-remainder method on `vat_agorot`.
- At least two lines. A line's bucket is a project or overhead. No line is left unassigned.
- A split does not write a supplier rule. The remember toggle is off and disabled, because a rule maps a supplier to one project.

## Refunds and credit notes

A credit note with no bank movement is a document. It stays out of P&L until a statement row or a manual paid entry links to it, same as an unpaid invoice.

When the cash arrives, the row is an inflow. If the supplier has an expense rule, that rule is high confidence and auto-approves onto the expense category, which reduces expenses. If the owner instead picks an income category, the inflow increases income. Flow does not silently recode a refund as `הכנסה אחרת`.

## Matching

Order for a new Hapoalim row that is not a transfer and not a duplicate of a row already imported:

1. **Invoice link.** Auto-approve only when the link is unique.
   - One unpaid invoice for the same normalized supplier whose remaining net equals the payment net. Remaining net starts as the invoice net and falls as payments are linked.
   - Or the payment net equals the sum of all unpaid invoices for that supplier, and there are two or more. Link every one of them.
   - Two different invoices that each equal the payment, a partial payment, or any other combination: not high confidence. The row goes to review with the candidate invoices listed. The owner can link one invoice (including a partial payment) or tick several whose remainders sum exactly to the payment.
2. **Supplier rule.** If no invoice link won, and a rule exists for the normalized counterparty, auto-approve onto that rule's project and category.
3. **Otherwise** the row is suggested. A client deposit whose counterparty matches exactly one active project's client is suggested onto that project, but it is not auto-approved unless a rule or a unique invoice link says so. If the client matches several projects, or none, the row is suggested with no project selected. Save from review is blocked until a project or overhead is chosen. Flow does not put an unknown client deposit on overhead by itself.

A partial payment links the cash that arrived. That cash counts once it is approved. The invoice's unpaid remainder stays out of P&L and stays on the unpaid list.

Normalized supplier: trim, collapse internal whitespace, strip Hebrew diacritics, ignore punctuation, compare invoice numbers with leading zeros removed.

## Duplicate imports

- The same invoice photo or PDF (same normalized supplier and invoice number; if the number is missing, same supplier, date, net, and VAT) does not create a second document. Flow opens the existing one.
- The same statement file (identical bytes already imported) imports nothing. Upload results is an error: the file was already loaded.
- An overlapping Hapoalim date range imports only rows that are not already stored. A row is the same row when the saved Hapoalim account, value date, signed amount in agorot, and normalized memo all match. Skipped rows are reported on the upload summary and do not move profit. The memo field to use has to be confirmed against a real Hapoalim sample; until then this identity is the working rule and is listed in [open questions](../open-questions.md).

## Worked example

Home v2, September 2026, this month. Figures are the wireframe's example data, in shekels.

| Bucket | Income | Expenses | Profit | Activity |
| --- | --- | --- | --- | --- |
| בניין מגורים חולון | 300,000 | 220,000 | 80,000 | 520,000 |
| וילה רעננה | 180,000 | 130,000 | 50,000 | 310,000 |
| מגדל משרדים פ"ת | 250,000 | 210,000 | 40,000 | 460,000 |
| בית פרטי כפר סבא | 120,000 | 90,000 | 30,000 | 210,000 |
| שיפוץ דירה ת"א | 60,000 | 70,000 | −10,000 | 130,000 |
| Other 12 projects | 400,000 | 330,000 | 70,000 | |
| Overhead | 0 | 60,000 | −60,000 | |

Company income 1,310,000. Company expenses 1,110,000. Company profit 200,000. The top 5 profits sum to 190,000, not to the company profit. Overhead and the other 12 make up the difference.

Project `וילה רעננה` to date: income 900,000, expenses 720,000, profit 180,000, margin 20% because 180,000 / 900,000 = 0.20. Budget 1,000,000, used 72%.
