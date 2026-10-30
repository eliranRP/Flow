# Next month's forecast: one card and one chart

**Date:** 2026-10-19
**Status:** Accepted (owner's board notes spec-fcwide and spec-profnext, approved 2026-10-19; FLOW-449). Amends [0176](0176-project-opens-on-cash.md) point 1 (the earlier months under חודשים קודמים).

## Context

A project's profit page showed next month's forecast as one dashed row ("נובמבר · צפי") with its net and what it was made of, and the project page listed its last three months under חודשים קודמים. The owner wanted next month to read the same everywhere it appears, set against the months before it, so the screens that show a forecast agree and a change is seen at a glance.

## Decision

1. **One card and one chart, built once.** The card shows the month with a צפי tag, הכנסות צפויות and הוצאות צפויות with a short caption each, and the net under a divider in grey (never green: it is a forecast). The chart shows income and expenses by month on one scale, time running right to left, with next month dashed and unfilled as its last pair. The markup and the scale live in the shared components; screens pass figures only.
2. **The figures are the existing ones.** The card is the forecast the צפי page shows (recurring charges, the loans' schedules, the six-month category averages and the owner's edits). The chart's months are the page's own history: profit months on a profit page, cash months on the project page. The project page takes that forecast in cash terms (point 4).
3. **Project profit (לפי חודש):** the card replaces the one-line row and opens the צפי page; the chart sits under it with the last six months. The net is רווח צפוי. לפי קטגוריה stays history only.
4. **Project page:** the card and the chart replace חודשים קודמים (amending 0176 point 1). The net is תזרים צפוי, and it is real cash (the owner's decision, 2026-10-20): הוצאות צפויות and the net include the whole loan payment due next month, its principal as well as its interest and escrow. The rest of the payment that the profit leaves out (the principal, and an interest or escrow part whose category is kept out of the profit, as a flip's hard-money interest is under [0166](0166-loan-interest-kept-out.md), or has no category) comes from the same loans and payments as the forecast's loan rows (each open loan filed under the project, in the forecast's currency, with a payment due next month on the loan page's payments left; a closed or paid-off loan gives none), and is added to the one forecast's expenses, never kept as a second forecast. When the owner takes out every row of a loan on the צפי page, that loan's rest is left out too: the payment will not happen. A loan with no row to take out keeps it. The chart's forecast pair takes the same cash figures, beside the project's cash months, and the expense caption stays against the last full cash month. The card opens the צפי page, whose expenses are lower by the rest of the payment; the chart is the project's cash months, from its first month when it is younger than six; "רווח לפי חודש ›" under the chart opens the profit page. A month's own page is still reached from נכנס, יצא and the profit page's month rows.
5. **Company profit** takes the same card and chart in a later change, with a grey caption in place of the link.

## Alternatives rejected

- **Keep the one-line row and the month rows.** Each screen said next month differently, and three rows of nets did not show the trend.
- **A chart per screen.** Separate markup drifts; the owner asked for the same markup everywhere.
- **The profit forecast labelled as cash on the project page.** The first version showed the צפי page's numbers under תזרים צפוי, leaving a loan's principal out of a page about cash. The owner chose real cash instead (2026-10-20).
- **A separate cash forecast.** Two forecasts would drift; the cash figures are the one forecast plus next month's principal.

## Consequences

- The project page reads six cash months instead of four.
- The card no longer says what the forecast is made of in counts; its captions name the rent or the income instead, and the expenses against the last full month.
- On a project with a loan, the project page's הוצאות צפויות is higher than the צפי page's by the rest of next month's payment that the profit leaves out (an amortizing loan's principal, a hard-money flip's interest), and its net lower; with no loan, or no payment next month, the two agree. Project profit › לפי חודש stays on the profit basis (רווח צפוי). Amended by [0236](0236-forecast-page-leads-with-cash.md): the צפי page now leads with the card's cash and lists that rest as a row.
