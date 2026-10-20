<a id="flow-145"></a>
# FLOW-145 · Company profit: the period switch, the year and since the start
- **Type:** UI (design approved) · **Status:** in-progress (#749) · **Depends on:** [FLOW-143](FLOW-143.md) (the company profit head), [FLOW-144](FLOW-144.md) (the card's start row and strong net, the chart's dashed cap) · **Source:** the board's canvas note spec-years ("PROFIT BY YEAR AND SINCE THE START", approved), Profit and ProfitLight boards (`co.periods`, `longView`, `YEARS`, `YPROJ`, `chartRows`, presets `year` and `alltime`), ProfitYear and ProfitAllTime frames, 2026-10-20; decision [0200](../../decisions/0200-company-profit-year-and-since-start.md)
- **Files:** `app/src/screens/company-profit-screen.tsx`, `app/src/screens/company-profit-period.tsx` (new), `app/src/company-years.ts`, `app/src/company-year-rows.ts`, `app/src/company-year-forecast.ts`, `app/src/company-years-query.ts` (new), `app/src/company-next-month.ts`, `app/src/company-next-month-query.ts`, `app/src/project-next-month.ts` (a target month), `app/src/company-profit-rows.ts` (`compare` row), `app/src/ui/month-forecast.tsx`, `app/src/ui/month-chart-scale.ts`, `app/src/ui/css/03-controls.css` (`.ui-period-switch`), `app/src/ui/css/46-loans.css` (its two switch rules moved out), `app/src/ui/css/47-company-profit.css` (`.ui-cp-period`, `.ui-cp-period-list`), `app/src/ui/css/51-next-month.css` (`.ui-fc-bars-dense`), `app/src/screens/loans-summary-screen.tsx` (the shared class), `app/src/dev/company-years-sample.ts` (new), `app/src/dev/company-profit-sample.ts`, the stories, unit and screen tests, `app/e2e/company-profit.spec.ts`, `docs/qa/CONTROLS.md`. `supabase/migrations/20261020170625_company_rest_of_year_edits.sql` (`company_next_month_inputs` gains `rest_edits`), `supabase/tests/database/company_next_month_inputs.test.sql`. The other reads exist (`get_profit_months`, `get_breakdown`).

**The switch**
- [x] Under the title and its sub, the loans summary's period switch: אוקטובר | 2026 | מההתחלה (the shown month's name, this year). Everything under it follows it; it keeps its choice while the page is open.

**2026 (the year)**
- [x] Sub "2026 · עד היום, 20/10"; the big figure is the year's profit to date.
- [x] Summary: הכנסות, הוצאות שנספרות ברווח, bold רווח 2026 עד היום, רווח 2025 כולה.
- [x] The forecast card in the תזרים צפוי form: "סוף 2026" with צפי, the start row רווח עד היום, the rest of the year's הכנסות צפויות and הוצאות צפויות, a bold רווח צפוי ל־2026.
- [x] The chart "הכנסות והוצאות לפי חודש": January to this month, the rest of the year dashed.
- [x] Chips לפי חודש (default) and לפי פרויקט: months newest first, the current one opening the month view; each project's year, finished projects as one row, a project opening its profit page.
- [x] A past year (from מההתחלה): "2025 · שנה סגורה", no forecast card, twelve solid months, compared with the year before.

**מההתחלה**
- [x] Sub "מאז ינואר 2024 · 3 שנים"; the big figure is the profit since the start.
- [x] Summary: הכנסות, הוצאות שנספרות ברווח, bold רווח מתחילת הדרך, השנה הרווחית ביותר · <year>.
- [x] The chart "הכנסות והוצאות לפי שנה": a pair per year, this year solid to date with a dashed cap still expected.
- [x] "לפי שנה": a row per year, newest first, opening that year.

**Folded in:** [FLOW-146](FLOW-146.md), the owner's edits of every month left (review of #749). **Follow-up:** [FLOW-147](FLOW-147.md), the month view's כללי row.

**Acceptance:** unit tests for the year and all-time figures and the rest-of-year forecast; a screen test for the switch; stories for the three states in dark and light; the company profit e2e.
