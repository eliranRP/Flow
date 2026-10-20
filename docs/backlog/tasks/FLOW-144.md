<a id="flow-144"></a>
# FLOW-144 · תזרים צפוי: cash words on the forecast card and chart, the month-end sum and its chart
- **Type:** UI (design approved) · **Status:** in-progress (#746) · **Depends on:** [FLOW-141](FLOW-141.md) (the month-end forecast), [FLOW-449](FLOW-449.md) (the shared card and chart), [FLOW-143](FLOW-143.md) · **Source:** the board's canvas note spec-cash2 ("MONTH-END FORECAST → תזרים צפוי, WITH THE SAME CARD AND CHART AS PROFIT", approved 20/10), MonthForecast, MonthForecastLight (`cf`, `chartRows`, preset `cash2`), Flow, Projects and Profit boards (`hasStart`, `netLabel*`), 2026-10-20; decision [0198](../../decisions/0198-cash-words-month-end-forecast.md)
- **Files:** `app/src/ui/month-forecast.tsx`, `app/src/ui/forecast-words.ts` (new), `app/src/ui/month-chart-scale.ts`, `app/src/ui/css/51-next-month.css`, `app/src/ui/css/28-forecast.css` (`.ui-forecast-today` gone, `.ui-forecast-fc`), `app/src/forecast-chart.ts` (new), `app/src/month-figures.ts` (`cashMonthFigures`, moved from `project-cash.ts`), `app/src/use-cash.ts`, `app/src/next-month-chart.ts`, `app/src/forecast-sample.ts`, `app/src/screens/forecast-screen.tsx`, `forecast-parts.tsx`, `forecast-item-page.tsx`, `next-month-block.tsx`, `company-next-month-block.tsx`, `project-cash-screens.tsx`, `project-profit-screen.tsx`, `home-parts.tsx`, `HomeScreen.tsx`, their stories and tests, `app/e2e/forecast.spec.ts`, `app/e2e/controls-projects.spec.ts`, `docs/qa/CONTROLS.md`.

**Shared parts**
- [x] The card and the chart take `kind: "cash" | "profit"`; the words come from one table (cash: צפוי להיכנס / צפוי לצאת / תזרים צפוי, "נכנס ויצא לפי חודש", legend נכנס · יצא · צפי; profit unchanged).
- [x] The card's optional start row (label and figure, a divider under it) and strong net (17/500, the signal colour when negative); the profit and project cards keep the grey 15px net.
- [x] The chart's month in progress: solid so far, a dashed cap still expected, on a scale of the two together.

**תזרים צפוי**
- [x] Title "תזרים צפוי" in the header, the compact bar and the item page's back link; the big figure is the month's end and the "היום $X" line is gone.
- [x] The card under the figure: "עד סוף <month>" with the count of every item, תזרים היום, צפוי להיכנס and צפוי לצאת with honest counts, the strong תזרים בסוף <month>.
- [x] The chart: May to September as they ended and October in progress, from a six-month `cash_months` read under `dashboard`.

**Home and the project page**
- [x] Home's band row reads "תזרים צפוי לסוף <month>".
- [x] The project page's card and chart in cash words; the project profit and company profit pages stay on profit words.

**Acceptance:** unit tests for the in-progress scale, the captions and counts and the card's sum; screen tests for תזרים צפוי, Home and the project page; stories in dark and light at 320 and 393; the forecast and projects e2e.
