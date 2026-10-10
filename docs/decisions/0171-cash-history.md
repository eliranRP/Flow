# Cash history: years, then months

**Date:** 2026-10-10
**Status:** Accepted (owner picked "Years, then months" on the FLOW-416 plan card, 2026-10-10)

## Context

Home's cash view ([0168](0168-cash-flow-view.md)) reads `cash_months(4)`: this month on the band and the three before it under "חודשים קודמים". `cash_months` stops at 24 months, and a month page only opened for a month Home had read. The owner asked to reach the whole history from Home, with summary rows that drill down.

## Decision

1. **Entry.** A quiet "לכל החודשים" link under Home's earlier months opens `/cash/history`.
2. **History page.** The band reads "תזרים מאז <first month> <year>" with the net since the first cash month, then one row per year, newest first, each with its net. This year's row says how many months it holds; the first year's row says the month the books start. A year with nothing in it still has a row, at zero.
3. **Year page.** `/cash/year/<year>`: the band reads "תזרים <year>", or "תזרים <year> עד היום" for this year. Then the year's נכנס and יצא as figures (no link: the lines are per month), then its months from the first cash month, each opening the month page Home's rows open. Back on an older month's page returns to its year.
4. **Server.** `cash_years()` returns the totals since the first cash month (`first_month`, `this_month`, `by_currency`) and per year, on the company's cash basis, through the end of this month. `cash_year_months(year)` is `cash_months` anchored on the year's last month (or today), so a year's months always match Home's months. Both are totals only; a month's lines stay paged by `cash_month_lines`.
5. **MCP.** `get_cash_years` reads the history; `get_cash_months` takes `year` instead of `months`.
6. **Speed.** One read per page. A touch on the history or a year link starts its read before the tap opens it, as project links do.

## Consequences

- At a book of about 2,500 lines the reads take about 50 ms on a local database; at 20,000 lines they take 0.3 to 0.5 s, because `private.pnl_lines` is read in full before the date range applies. Pushing the range into the view is the next step if books grow that large.
- A month older than Home's four now has a page, read through its year.
