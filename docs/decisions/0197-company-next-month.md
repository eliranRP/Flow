# The company's next month: every project's forecast and the general costs

**Date:** 2026-10-20
**Status:** Accepted (owner's board note spec-fcwide items 0 and 2, approved 2026-10-19; FLOW-143). Builds point 5 of [0196](0196-next-month-forecast-card-and-chart.md).

## Context

[0196](0196-next-month-forecast-card-and-chart.md) put next month's card and the month chart on the project screens and left the company profit page for a later change. The board's company page also changed its summary: rows with dividers in place of two bars and a loose "מתחילת השנה" line. A project's forecast is built in the app from four reads of that project (its recurring charges, its loans, its category months and the owner's edits); building the company's the same way would read once per project.

## Decision

1. **The summary is four rows with dividers**, as on a project's profit card: הכנסות (green with +), הוצאות שנספרות ברווח, רווח <month> (bold; a loss in the signal colour) and רווח מתחילת השנה. No share of general expenses: the company is the whole. The two bars and the year-to-date line under the figure are gone.
2. **The company's next month is a sum.** Every active project's forecast, exactly as its צפי page builds it (recurring charges due next month, the loans' interest and escrow, six-month category averages, the owner's edits on top), plus the general costs built the same way from what carries no project: charges and loans with no project, and the averages of expense lines with no project or filed as overhead. Lines shared by allocation are already in their projects' averages. Profit terms, in the company currency.
   - **The overhead project is general.** Its lines are overhead, so they are in the general averages; its charges, loans and edits are built with the general costs, under one set of filled categories, and it is not counted among the projects. Built as a project of its own, a category its charge fills would be averaged again in the general costs (a rent of 1,000 a month read as 2,000).
   - **A stream is a charge or an average, never both.** A line with no project that belongs to a recurring charge of a project (its party's closest project, as `expected_months` files the charge) is left out of the general averages: that project's charge counts it.
   - **A finished project adds nothing**: a sold project's averages and charges are history, not next month.
3. **One read, not one per project.** `company_next_month_inputs` gives every project's category months (the same `project_category_months` call each project page makes), the general costs' months and every project's edits for next month. With `expected_months` and the loans for the whole company, the app runs the project builder once per project and once for the general costs.
4. **The card** sits under the summary with no link; its grey caption says what the sum is made of ("7 פרויקטים וכללי"). The net is רווח צפוי. Under הכנסות צפויות rent and other income are named apart ("6 שכירויות ו־2 הכנסות"); under הוצאות צפויות, this month's counted expenses so far ("מול $X באוקטובר").
5. **The chart** is the company's last six profit months (`get_profit_months`, the current one to date) and the forecast pair, with no link. Card and chart show on the current month only; an earlier month's page (Home's `?month=`) shows its own figures.

## Alternatives rejected

- **A read per project from the app.** A company with many projects would make four reads each on every visit.
- **A forecast built in SQL.** The forecast rules live in the app (loan schedules, paces, edits); a second copy in SQL would drift from the צפי page.
- **"2 חשבוניות" as on the board.** The forecast has no invoice lines; it names what it holds.

## Consequences

- A project's forecast and its share of the company's agree by construction; a test checks the sum against the projects' own forecasts.
- **No flow-mcp tool yet (0095).** This is a read, not a user action, and the forecast is computed in the app from the builder's rules (loan schedules, paces, edits); flow-mcp would have to port them or hand an agent the inputs and a recipe. The second is filed as [FLOW-216](../backlog/tasks/FLOW-216.md) (`get_company_next_month_inputs`, with the recipe in TOOLS.md). Until then an agent can build it from `get_expected_months`, `list_loans`, `get_loan_schedule` and `get_project_forecast_edits`, without the general costs' months.
- **Cost grows with the projects.** The read makes one `project_category_months` call per active project, about 6ms each on a local database: 200 projects take about 1.15s. Past that, the projects' months should come from one pass over the lines.
- A project whose figures are in another currency adds only its company-currency rows; the owner's edits, which carry no currency, apply as on the project page.
