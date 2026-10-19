# Next month's forecast: one card and one chart

**Date:** 2026-10-19
**Status:** Accepted (owner's board notes spec-fcwide and spec-profnext, approved 2026-10-19; FLOW-449). Amends [0176](0176-project-opens-on-cash.md) point 1 (the earlier months under חודשים קודמים).

## Context

A project's profit page showed next month's forecast as one dashed row ("נובמבר · צפי") with its net and what it was made of, and the project page listed its last three months under חודשים קודמים. The owner wanted next month to read the same everywhere it appears, set against the months before it, so the screens that show a forecast agree and a change is seen at a glance.

## Decision

1. **One card and one chart, built once.** The card shows the month with a צפי tag, הכנסות צפויות and הוצאות צפויות with a short caption each, and the net under a divider in grey (never green: it is a forecast). The chart shows income and expenses by month on one scale, time running right to left, with next month dashed and unfilled as its last pair. The markup and the scale live in the shared components; screens pass figures only.
2. **The figures are the existing ones.** The card is the forecast the צפי page shows (recurring charges, the loans' schedules, the six-month category averages and the owner's edits). The chart's months are the page's own history: profit months on a profit page, cash months on the project page.
3. **Project profit (לפי חודש):** the card replaces the one-line row and opens the צפי page; the chart sits under it with the last six months. The net is רווח צפוי. לפי קטגוריה stays history only.
4. **Project page:** the card and the chart replace חודשים קודמים (amending 0176 point 1). The net is תזרים צפוי; the chart is the project's cash months, from its first month when it is younger than six; "רווח לפי חודש ›" under the chart opens the profit page. A month's own page is still reached from נכנס, יצא and the profit page's month rows.
5. **Company profit** takes the same card and chart in a later change, with a grey caption in place of the link.

## Alternatives rejected

- **Keep the one-line row and the month rows.** Each screen said next month differently, and three rows of nets did not show the trend.
- **A chart per screen.** Separate markup drifts; the owner asked for the same markup everywhere.
- **A cash forecast on the project page.** The forecast is in profit terms (a loan's principal is left out). A second forecast would disagree with the צפי page the card opens; the project page names its net תזרים צפוי and shows the same numbers.

## Consequences

- The project page reads six cash months instead of four.
- The card no longer says what the forecast is made of in counts; its captions name the rent or the income instead, and the expenses against the last full month.
- A loan's principal is not in the project page's forecast, though the page is about cash.
