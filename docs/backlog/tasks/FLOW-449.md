<a id="flow-449"></a>
# FLOW-449 · Next month's forecast card and month chart on the project screens (PR A)
- **Type:** UI (design approved) · **Status:** in-progress (#741) · **Depends on:** [FLOW-140](FLOW-140.md) (the project profit page), [FLOW-445](FLOW-445.md) (the project page) · **Related:** the company profit summary, card and chart, and the category view in two groups come next in PR B · **Source:** the board's canvas notes spec-fcwide ("NEXT MONTH'S FORECAST, THE SAME ON EVERY RELATED SCREEN", approved) and spec-profnext ("NEXT MONTH IN PROJECT PROFIT", approved), Profit and Projects boards, 2026-10-19
- **Files:** `app/src/ui/month-forecast.tsx`, `app/src/ui/month-chart-scale.ts`, `app/src/next-month-chart.ts`, `app/src/screens/next-month-block.tsx` (new), `app/src/screens/project-profit-screen.tsx`, `app/src/screens/project-cash-screens.tsx`, `app/src/screens/project-detail-screen.tsx`, `app/src/screens/project-page-cards.tsx`, `app/src/project-cash.ts`, `app/src/project-next-month.ts`, `app/src/project-next-loans.ts`, `app/src/ui/screen-skeletons.tsx`, `app/src/ui/css/51-next-month.css` (new), `app/src/ui/css/45-project-profit.css` (the old card's blocks), `app/src/ui/css/33-project-flip.css` (the months card's blocks), `design/system/implementation-tokens.css` (`--color-chart-expense`, `--radius-chart-bar`), the dev samples and their stories and tests; `app/src/screens/project-next-month-card.tsx` deleted.

**Shared (built once)**
- [x] The dashed card: the month with its צפי tag, "פירוט ועריכה ›" (or a grey caption where there is no page), הכנסות צפויות (28/400, green with +, grey at $0) and הוצאות צפויות with a caption each, and under a divider the net in grey.
- [x] The chart "הכנסות והוצאות לפי חודש": two bars a month on one scale (108px max, 4px floor, 2px for zero, 4px radius), time right to left, next month dashed and unfilled with "נוב׳ · צפי" in the accent, legend הכנסות · הוצאות · צפי, one image label with next month's numbers.

**Project profit › לפי חודש**
- [x] The card replaces the one-line "נובמבר · צפי" row and opens the צפי page; the chart sits under it with the last six profit months and the forecast. Net "רווח צפוי". לפי קטגוריה is unchanged.

**Project page (פרויקטים)**
- [x] The card and the chart replace "חודשים קודמים"; the net reads "תזרים צפוי"; the chart is the project's cash months (the read now takes six); "רווח לפי חודש ›" opens the profit page. A younger project shows fewer months ("מתחילת הפרויקט וצפי"); a flip's purchase month sets the scale and its income stays a grey $0.
- [x] The owner's decision (2026-10-20): the project page's card and chart are real cash, the צפי page's forecast plus the rest of the project's loan payments due next month that the profit leaves out (`cashForecast`: the principal, and interest or escrow kept out of the profit); a loan whose every row was taken out adds none; the profit page stays on the profit basis.

**Acceptance:** the card's figures are the צפי page's (one forecast, `useNextMonthForecast`); the chart's history is the page's own profit or cash months; unit tests for the scale and the captions, component tests for both screens, stories for the components and the rental, flip and client-job pages (the dark pass draws them in dark), and the controls e2e.
