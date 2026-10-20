# The company's next month: every project's forecast and the general costs

**Date:** 2026-10-20
**Status:** Accepted (owner's board note spec-fcwide items 0 and 2, approved 2026-10-19; FLOW-143). Builds point 5 of [0196](0196-next-month-forecast-card-and-chart.md).

## Context

[0196](0196-next-month-forecast-card-and-chart.md) put next month's card and the month chart on the project screens and left the company profit page for a later change. The board's company page also changed its summary: rows with dividers in place of two bars and a loose "מתחילת השנה" line. A project's forecast is built in the app from four reads of that project (its recurring charges, its loans, its category months and the owner's edits); building the company's the same way would read once per project.

## Decision

1. **The summary is four rows with dividers**, as on a project's profit card: הכנסות (green with +), הוצאות שנספרות ברווח, רווח <month> (bold; a loss in the signal colour) and רווח מתחילת השנה. No share of general expenses: the company is the whole. The two bars and the year-to-date line under the figure are gone.
2. **The company's next month is a sum.** Every project's forecast, exactly as its צפי page builds it (recurring charges due next month, the loans' interest and escrow, six-month category averages, the owner's edits on top), plus the general costs built the same way from what carries no project: charges and loans with no project, and the averages of expense lines with no project or filed as overhead. Lines shared by allocation are already in their projects' averages. Profit terms, in the company currency.
3. **One read, not one per project.** `company_next_month_inputs` gives every project's category months (the same `project_category_months` call each project page makes), the general costs' months and every project's edits for next month. With `expected_months` and the loans for the whole company, the app runs the project builder once per project and once for the general costs.
4. **The card** sits under the summary with no link; its grey caption says what the sum is made of ("7 פרויקטים וכללי"). The net is רווח צפוי. Under הכנסות צפויות rent and other income are named apart ("6 שכירויות ו־2 הכנסות"); under הוצאות צפויות, this month's counted expenses so far ("מול $X באוקטובר").
5. **The chart** is the company's last six profit months (`get_profit_months`, the current one to date) and the forecast pair, with no link. Card and chart show on the current month only; an earlier month's page (Home's `?month=`) shows its own figures.

## Alternatives rejected

- **A read per project from the app.** A company with many projects would make four reads each on every visit.
- **A forecast built in SQL.** The forecast rules live in the app (loan schedules, paces, edits); a second copy in SQL would drift from the צפי page.
- **"2 חשבוניות" as on the board.** The forecast has no invoice lines; it names what it holds.

## Consequences

- A project's forecast and its share of the company's agree by construction; a test checks the sum against the projects' own forecasts.
- flow-mcp does not get the company forecast yet: `get_forecast` (this month's end) and the per-project reads stay as they are. Adding it means porting the builder or calling the app's rules; it is a follow-up.
- A project whose figures are in another currency adds only its company-currency rows; the owner's edits, which carry no currency, apply as on the project page.
