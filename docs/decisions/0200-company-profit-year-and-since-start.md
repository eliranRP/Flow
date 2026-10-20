# The company profit page by year and since the start

**Date:** 2026-10-20
**Status:** Accepted (owner's board note spec-years, approved 2026-10-20; FLOW-145). Builds on [0197](0197-company-next-month.md) and the card and chart forms of [0198](0198-cash-words-month-end-forecast.md).

## Context

The company profit page showed one month: its profit, the year to date as one line, next month's card and six months of chart. The owner asked for the year and the whole life of the company on the same page, behind the same period switch the loans summary has (מתחילת ההלוואות / 2026). The year needs a forecast to its end, and both views need figures the page did not read: every month of the year, the years before, and each project's year.

## Decision

1. **A period switch under the title**: the shown month's name, this year and מההתחלה. It is the loans summary's control (`SegmentedControl` on the card tone with the page's segment radius, now one shared `.ui-period-switch` rule). Everything under it follows it: the big figure, the summary, the forecast card, the chart and the list. The choice is in the URL (`?period=year`, `&year=2025` for a past year, `&list=project` for the year's projects; `?period=all`), written in place, so it holds while the page is open and survives a reload. The month view is unchanged.
2. **One read for every year.** `get_profit_months` already gives the company's profit months in one pass over its lines (the figures `company_pnl` gives for the same months, pgTAP `profit_months`), and takes up to 240 months. The page reads it once, from January twenty years back to today, and builds every year, the previous year's comparison and since the start from that read in the app: no read per year or per month, and no new RPC or migration. The months after this one and the empty years before the first counted line drop out, so "מאז ינואר 2024" names the first month with a line. The figures add up by construction: a year is its months, since the start is its years, and this year to date is the month view's רווח מתחילת השנה.
3. **A year's projects** come from the two `get_breakdown` reads by project for that year (the month view's own read, over the year), only when לפי פרויקט is shown. A finished project (the dashboard's status) folds into one row, "פרויקטים שהסתיימו · N"; כללי is the general costs; a project opens its profit page.
4. **The rest of the year is next month's company forecast, built again for each month left.** The same builder and the same reads as next month's card (0197): `expected_months` (the recurring list does not depend on how many months it is asked for), the company's loans, `company_next_month_inputs` and the categories. `nextMonthForecast` and `companyNextMonthForecast` take a target month; for each month to December, recurring charges come by the shared `dueInMonth` rule (a quarterly charge lands in its month only), loans by their schedules, and the six-month category averages repeat. November is exactly the month view's card. The card is the תזרים צפוי form: "סוף 2026" with צפי, the start row רווח עד היום, the months left's הכנסות and הוצאות צפויות ("נובמבר ודצמבר" in its corner), and a bold רווח צפוי ל־2026, signed as a profit. December has no months left, so no card.
   - **The owner's edits** in the read are those that apply to next month. An edit applies to a later month when its pace lands there (a monthly added line repeats, a one-month change does not). A line that already came against an added edit came in next month; in a later month that edit is expected again.
5. **The charts.** The year's chart is "הכנסות והוצאות לפי חודש", January to this month solid and the months left dashed (the shared `MonthChart`, which now takes several dashed months); a past year is twelve solid months. Since the start is "הכנסות והוצאות לפי שנה": a pair per year, this year solid to date with a dashed cap for the rest of the year. Past eight pairs the columns close up to 4px, and under 360px every other month keeps its label.
6. **The summaries.** A year: הכנסות, הוצאות שנספרות ברווח, bold רווח 2026 עד היום (or רווח 2025), and the whole year before, when the company has it. Since the start: the same two, bold רווח מתחילת הדרך, and the most profitable closed year (this year, still to date, does not compete).

## Alternatives rejected

- **A new yearly RPC (one row per year).** The year view needs the months anyway, and the months already sum to the years; a second read would be a second copy of the counting rules.
- **One `get_profit_months` read per year.** N reads for N years, and the year before for the comparison; one read of every month is smaller than the screen's own month reads.
- **`get_profit_months` with no range.** It would also count lines dated after today, so this year would not match the month view's year to date.
- **A year forecast in SQL, or from the month view's card times the months left.** The forecast rules live in the app (0197); a multiplied card would count a quarterly charge every month and a one-month edit in every month.
- **Extending `company_next_month_inputs` to return the edits of every month left.** A migration for an edge case: edits start at next month from the app, so only an edit whose pace skips next month and lands later in the year is missed. Filed as a follow-up ([FLOW-146](../backlog/tasks/FLOW-146.md)).

## Consequences

- The year and since-the-start views cost one more read (`get_profit_months` over 240 months, about one small object per month) and, for לפי פרויקט, two breakdowns; switching between years reads nothing more.
- A company older than twenty years would lose its first years from מההתחלה; the read's 240-month cap sets that.
- **flow-mcp (0095).** These are reads, not user actions. An agent gets the same figures from `get_profit_months` (every month, by year) and `get_breakdown` by project; the rest-of-year forecast is next month's recipe run per month, which [FLOW-216](../backlog/tasks/FLOW-216.md) documents with the inputs read.
- Coming back from a project's profit page opens the month view: the project page's back link carries only the preview flag.
