# Flow — Calculations

Exact definitions for Module 1. Screen specs use these rules and do not invent a second formula. Decisions in force: cash basis ([0004](../decisions/0004-cash-basis-for-v1.md), [0007](../decisions/0007-bank-statement-is-primary-input.md)), net of VAT ([0001](../decisions/0001-management-tool-alongside-accounting.md)), auto-approve ([0011](../decisions/0011-auto-approve-high-confidence.md)), overhead in the company total ([0009](../decisions/0009-scalable-pickers.md)), shared costs versus overhead ([0021](../decisions/0021-shared-costs-and-overhead.md)), and the after-overhead view starting off ([0022](../decisions/0022-after-overhead-starts-off.md)).

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

Overhead (`הוצאות כלליות`) is a bucket, not a project the owner creates or deletes. Stored company figures are the sum of every project plus overhead. A stored project figure does not include overhead. [0021](../decisions/0021-shared-costs-and-overhead.md) does not move overhead onto projects. It adds a view, defined under [Overhead share](#overhead-share).

A company can name one of its projects as its overhead project ([0101](../decisions/0101-unassigned-and-overhead-project.md)). Expense lines filed to that project count as overhead, not as that project's direct cost. Its income and shared shares stay on the project.

Lines that belong to no bucket are **unassigned**: income with no project, and cost with no role, a project role and no project, or a shared role and no split. Company figures are the sum of every project, overhead, and unassigned. Expenses are direct + shared + overhead + unassigned cost.

An expense line counts by its document date on both bases. The one exception is a supplier invoice or credit note that is not paid yet (no cash date): it counts on the invoiced basis and stays out of the cash basis until it is paid ([0118](../decisions/0118-unpaid-invoices-cash-basis.md)). A bank line that has not settled (`pending`) counts on neither basis until it posts.

Home always paints overhead as its own row under the projects, including when the top 5 are sorted by losses. Overhead is not eligible for the top 5. If overhead's profit for the period is 0 and the company has no projects and no transactions, Home uses the empty state and hides the row.

Hiding a project from the top 5 does not remove it from the company tiles. The collapsed row's profit is the sum of counting lines on projects that are not in the top 5.

**Activity** for "top 5 this month" is the sum of the absolute value of `signed_net_agorot` of counting lines on that project in the selected Home period. Ties break by most recent cash date, then by project name.

**Losses first** (`הפסד קודם`) ranks projects by the profit the screen is showing, ascending (largest loss first). With the after-overhead view on, that is profit after the overhead share. A project with no counting lines in the period is listed after projects that have lines. Overhead stays pinned at the bottom either way. Activity ignores the view: it is cash movement, not profit.

If fewer than five projects have any lines in the period, Home lists those projects and hides the collapsed row. Finished projects with no lines in the period stay out of the list and out of the picker. Their older lines still sit in year-to-date and in project-to-date reports.

## Budget versus actual

Budget is optional ([0014](../decisions/0014-optional-project-budget.md)). The card `הוצאות מול תקציב` is shown only when the project has a budget greater than 0.

- Used = project-to-date expenses (the sum above), not the Home period.
- Percent used = used / budget, percent rule.
- The bar fills to `min(percent, 100)` visually. The label shows the true percent, including values over 100.
- A budget of 0 is treated as unset. The card is hidden.

## VAT

Tiles, profit, category bars, and budget-used are net of VAT. VAT is displayed beside a single transaction and is included in the accountant export. VAT is never added into profit.

A document that carries a VAT split uses that split ([0041](../decisions/0041-amounts-before-vat.md)). An expense, or a bank line with no supplier match, that has no split assumes the standard rate, a configurable constant currently 18%: net = gross / 1.18, unless the supplier is marked VAT-exempt, in which case net = gross ([0043](../decisions/0043-assumed-vat-on-expenses.md)). That assumption is `vat_status='assumed'`. The demo target is Rule A: net = gross / 1.18 for a VAT-registered supplier, and gross for the exempt insurer `ביטוח המגן`.

A VAT-exempt line has `vat_agorot = 0` and counts at its net. Extracted VAT is kept even when the company is `עוסק פטור`: the supplier still charged VAT. Manual entry defaults VAT to 0 when the company status is exempt, and to the computed amount when the company charges VAT.

## Splits

The owner splits one cash amount across projects by amount or by percent, or across every active project. Category is the one chosen on the sheet, copied to every line. [0021](../decisions/0021-shared-costs-and-overhead.md).

- Amount mode: each line's net agorot is entered. Save is blocked until the lines sum to the parent `signed_net_agorot` exactly.
- Percent mode: each line's percent is entered, one decimal. Flow converts to agorot by [largest remainder](#largest-remainder) so the lines still sum exactly to the parent. Save is blocked until the percents sum to 100.0.
- Across all active projects. Three methods. Active means status `active`. Finished projects and overhead are not targets. A project with a computed share of zero is omitted; the lines that remain still sum to the parent.
  - **Equal.** Weight 1 for each active project. Unavailable when there are no active projects. One active project receives the whole payment.
  - **Income share.** Weight is that project's income in the calendar month of the payment's cash date (`Asia/Jerusalem`). A project with income 0 gets nothing. Unavailable when the active projects' combined income in that month is 0.
  - **Manual.** The owner enters percents or shekels, same remainder rules as amount and percent mode. At least two lines.
- VAT uses the same largest-remainder method on `vat_agorot`.
- A hand-built manual split does not turn on `לזכור לספק הזה`. That toggle stays off. A separate control, off until the owner enables it, saves a split rule ("split like this every month").
  - Equal: the rule stores the method. The next payment uses whoever is active that day.
  - Income share: the rule stores the method. Each later payment uses the calendar month of that payment. It is not frozen to the month the rule was saved.
  - Manual: the rule stores each chosen project's share of this payment as a weight in agorot (the absolute line nets). A later payment of a different size uses those weights and largest remainder. A finished project named in the rule still receives its share. If a named project is gone, the rule does not run and the row waits in review.
- A split rule replaces a one-project rule for that payee, and a one-project rule replaces a split rule. The next payment is auto-approved already split, unless the method is unavailable for that month, in which case the row waits in review and nothing is guessed into equal shares.

### Largest remainder

Used for percent splits, equal splits, income-share splits of a payment, and VAT on a split. The overhead view uses the [₪100 rule](#overhead-share) instead.

Given a signed total `T` in agorot and positive integer weights `w_i` with `W = sum w_i`:

1. Participants with weight 0 get 0 and are not in the steps below.
2. If `W` is 0, there is no allocation.
3. Let `A = |T|`. For each participant, `quota_i = A × w_i / W` (rational). `base_i = floor(quota_i)`. `frac_i = quota_i − base_i`.
4. `left = A − sum base_i`. Give one extra agora to the `left` participants with the largest `frac_i`. Ties break by project code ascending.
5. If `T` is negative, negate every share. If `T` is 0, every share is 0.

The shares then sum exactly to `T`.

### Overhead share

View only. Stored transactions, the overhead bucket, and the company income, expenses, and profit do not change. [0021](../decisions/0021-shared-costs-and-overhead.md).

The period is the one selected on that screen. On Home that is this month, last month, or year to date. On the project screen it is project to date, meaning every counting line on every project and on overhead, any date. The project screen does not gain the Home period switch.

Let `H` be overhead profit in that period (income − expenses on the overhead bucket). Let `I_p` be project `p`'s income in that period. Let `I = sum I_p` over projects, not including overhead's own income. The company's overhead project is left out of `I` and its share is 0: its cost is the overhead being spread, so it does not carry a share of it ([0117](../decisions/0117-overhead-project-weights.md)).

- If `I` is 0, allocation is unavailable. The after-overhead view is not shown. The screen says so. It does not pretend every share is zero.
- Otherwise each exact share is `H × I_p / I`. A project with `I_p = 0` has share 0.
- Round every other exact share to the nearest ₪100 (10,000 agorot), half away from zero. A zero-income project stays ₪0. It is not rounded up to ₪100.
- The rounded shares can miss `H`. The difference `H − (sum of rounded shares)` is added to one project, so the shares then equal `H` exactly. That project is the one whose exact share was reduced the most by rounding (largest `exact − rounded`). If nobody was reduced and a difference remains, it goes to the project with the largest income. Ties break by project code ascending. A zero-income project does not receive this difference.
- After that, only the project that absorbed the difference may be off a multiple of ₪100. Everyone else is on a multiple of ₪100, or ₪0.
- Displayed profit after overhead = the project's own profit + `s_p`.
- Displayed margin uses that displayed profit and the project's own income. Income, own expenses, category bars, and the budget card stay on stored project figures.
- Company tiles, including comparison arrows, stay the stored company totals.
- On Home, with the view on, the overhead row is grey and struck through, with the stored overhead amount still readable, and a note that this view has spread it. The row still opens the overhead screen, which shows the stored bucket. Displayed project profits then sum to company profit. The struck row is not added on top.

Example data, September 2026, this month, overhead profit −₪60,000, company project income ₪1,310,000. Nearest ₪100, then the ₪100 shortfall on `שיפוץ דירה ת"א` (its exact share was reduced the most):

| Project | Exact cost share | After ₪100 rounding, then the difference |
| --- | --- | --- |
| בניין מגורים חולון | ₪13,740.46 | ₪13,700 |
| וילה רעננה | ₪8,244.27 | ₪8,200 |
| מגדל משרדים פ"ת | ₪11,450.38 | ₪11,500 |
| בית פרטי כפר סבא | ₪5,496.18 | ₪5,500 |
| שיפוץ דירה ת"א | ₪2,748.09 | ₪2,800 |
| Other 12 | ₪18,320.61 | ₪18,300 |

Those six shares sum to ₪60,000. They are the figures on [01-home-v4](screens.md#01-home-v4). The ₪40,000 on [02-project-v2](screens.md#02-project-v2) is a different example, for project to date, not this September split.
- The overhead screen itself has no toggle.
- Home, the project screen, and the Settings display option share one preference. It starts off ([0022](../decisions/0022-after-overhead-starts-off.md)), so the first figures match the bank and the accountant. The owner turns it on for this view.

Losses-first and the collapsed-row profit use the displayed profit. Activity does not.

## Refunds and credit notes

A credit note with no bank movement is a document. It stays out of P&L until a statement row or a manual paid entry links to it, same as an unpaid invoice.

When the cash arrives, the row is an inflow. If the supplier has an expense rule, that rule is high confidence and auto-approves onto the expense category, which reduces expenses. If the owner instead picks an income category, the inflow increases income. Flow does not silently recode a refund as `הכנסה אחרת`.

## Matching

There is no statement-file import. A bank row arrives from the SUMIT sync ([0065](../decisions/0065-review-round5.md) point 40). The order below is how that row is matched once it exists. It is not a file parser.

Order for a new bank row that is not a transfer and not a duplicate of a row already stored:

1. **Invoice link.** Auto-approve only when the link is unique.
   - One unpaid invoice for the same normalized supplier whose remaining net equals the payment net. Remaining net starts as the invoice net and falls as payments are linked.
   - Or the payment net equals the sum of all unpaid invoices for that supplier, and there are two or more. Link every one of them.
   - Two different invoices that each equal the payment, a partial payment, or any other combination: not high confidence. The row goes to review with the candidate invoices listed. The owner can link one invoice (including a partial payment) or tick several whose remainders sum exactly to the payment.
2. **Supplier rule.** If no invoice link won, and a rule exists for the normalized counterparty, auto-approve. A one-project rule uses that project and category. A split rule writes the lines from [Splits](#splits) and auto-approves them. If that split method is unavailable for this payment, the rule does not run and the row is suggested.
3. **Otherwise** the row is suggested. A client deposit whose counterparty matches exactly one active project's client is suggested onto that project, but it is not auto-approved unless a rule or a unique invoice link says so. If the client matches several projects, or none, the row is suggested with no project selected. Save from review is blocked until a project or overhead is chosen. Flow does not put an unknown client deposit on overhead by itself.

A partial payment links the cash that arrived. That cash counts once it is approved. The invoice's unpaid remainder stays out of P&L and stays on the unpaid list.

Normalized supplier: trim, collapse internal whitespace, strip Hebrew diacritics, ignore punctuation, compare invoice numbers with leading zeros removed.

## Duplicate imports

- The same invoice photo or PDF (same normalized supplier and invoice number; if the number is missing, same supplier, date, net, and VAT) does not create a second document. Flow opens the existing one.
- There is no statement file to import twice. Bank rows arrive from the SUMIT sync, and a repeated sync does not create a second counting line. The identity of a SUMIT document stays the sync's own document identity.

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
