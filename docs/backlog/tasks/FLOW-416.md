<a id="flow-416"></a>
# FLOW-416 · Cash history: all months from Home (years, then months)
- **Type:** PLAN FIRST · **Status:** claimed (cash-history thread); approved option A "Years, then months" by the owner, 2026-10-10 · **Depends on:** [FLOW-413](FLOW-413.md)
- **What:** Home's cash list stops at the last 3 months. The owner asked (2026-10-10) to reach all history from Home.
- **Owner's pick:** A. A quiet "לכל החודשים" row under "חודשים קודמים" opens the history page: the net since the first cash month in the band, then one row per year. A year opens its months (the current year up to this month), and a month opens today's month page.
- **Design lead notes:** the entry row reads "לכל החודשים"; year rows use the regular row weight; the current year's band reads "תזרים 2026 עד היום".
- **Mockups:** `mockups/plan-first/cash-history/` in the project files (0-home-entry, a-1-years, a-2-year; b and c were the other options).
- **Acceptance:** `cash_years` and `cash_months` by year on the server and in MCP; the history and year pages, with skeletons and stories; each opens in under 0.7 s.
