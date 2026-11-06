# 0260 · The forecast reaches 12 months ahead, on Home and its pages

**Date:** 2026-11-06
**Status:** Accepted (the owner, 2026-11-06: "12 months (Recommended)", "Yes, build it (Recommended)", editing on any future month, and "Expected profit (Recommended)" for the פירוט ועריכה row; FLOW-1066). Amends [0200](0200-company-profit-year-and-since-start.md) and FLOW-1056's next-month-only rule.

## Context

The owner, 2026-11-06: "I want to see the forecast revenue on any future month." Home had three month states since FLOW-1056: past, current and future, where future meant next month only. `?month=` stopped at next month, the band had no later arrow there, and the drawer stopped at next month's cell. The editing pages (`/forecast/next`, a project's צפי page and its edit and add pages) were next month only.

The forecast was already built per month on the client: next month's company forecast (decision [0197](0197-company-next-month.md)) is pure in its month, and the year view's rest-of-the-year card ([0200](0200-company-profit-year-and-since-start.md)) builds every month left in this year from the same reads. Only one read was limited to the year: `company_next_month_inputs`' `rest_edits`, the edits of the later months. `expected_months`' `recurring[]` was never limited by `p_months`. The MCP writes already took any month from this month on.

## Decision

1. **The horizon.** The forecast covers 12 months after the current one: next month through the same month next year (in November 2026, December 2026 to November 2027). One constant, `FORECAST_HORIZON_MONTHS` in `packages/shared/src/forecast-horizon.ts`, with `forecastLastMonth`, `forecastMonths` and `inForecastHorizon`; the app, the flow-mcp reads and `company_next_month_inputs` use it.
2. **Server.** `company_next_month_inputs`' `rest_edits` holds every edit that applies to a month of the horizon, each added one with its matched line by month for those months; `edits` stays next month's. `expected_months` takes up to 13 months (this month and the 12).
3. **Client.** `companyMonthForecast` builds any month of the horizon from next month's reads, with that month's edits; next month keeps the read's own `edits`. The year view's card still sums this year's months only: in November it reads סוף 2026, December alone.
4. **Home.** Every month of the horizon is a future month: `?month=` clamps to the last one, the later arrow stays on until it, the earlier arrow on a future month goes one month back. The drawer's year arrows reach the last month's year; every month of the horizon is a dashed צפי cell to pick, and a month past it is faded and disabled. A future month shows what next month shows (the band, its figures, הצפוי ב<month> by project, פירוט ועריכה), built for that month. A month after next has the caption "הערכה · לפי קבועים, הלוואות וממוצע 6 חודשים" in place of what the sum covers, and "קבועים וממוצעים" under צפוי לצאת in place of the comparison with this month.
5. **פירוט ועריכה shows the expected profit** (the owner's ask, 2026-11-06): on every future month the band's foot row shows the month's expected profit (income less expenses, profit terms, no loan principal) where the current month's forecast row has its figure, a bar while it is read. Its line reads "רווח צפוי · הצפי של כל פרויקט ל<month>", and the link's name includes the amount. The band's big figure stays the cash net.
6. **Edit pages.** `/forecast/next`, `/projects/:id/profit/next` and its edit and add pages take `?month=YYYY-MM` in the horizon; no month, or one outside it, is next month, so the old links keep working. Home's links and each page's row links carry it, the titles name the month, and an edit is saved for that month. The add page's FLOW-1006 `?month=` for this month stays.
7. **MCP-first ([0095](0095-mcp-first.md)).** `get_forecast` and `get_project_forecast_edits` take any month up to the horizon's last and refuse a later one with `validation`, before any read; `get_expected_months` takes `months` up to 13; `get_company_next_month_inputs` documents the wider `rest_edits` and how any month is built from them.

## Alternatives rejected

- **The rest of the year only** (as the year view): December would have no later month to step to, and in November the owner could see one month ahead.
- **24 months, or no limit:** the six-month averages and the loan schedules say less the further out they go; the owner picked 12.
- **A new read per month:** the reads are the same for every month; building each month on the client keeps one round of reads.

## Consequences

- Home's month drawer state `next` is now `forecast` (`.ui-month-cell-forecast`), and `withNext` is `withForecast`.
- The pages' and Home's links add `?month=` only for a month after next, so next month's links are as they were.
- `company_next_month_inputs` returns more `rest_edits` for a company with edits next year; the year card filters to this year.
