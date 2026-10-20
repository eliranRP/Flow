<a id="flow-145"></a>
# FLOW-145 · Company profit: the period switch, the year and since the start
- **Type:** UI (design approved) · **Status:** claimed (UI lane, 2026-10-20, feat/profit-year-alltime) · **Depends on:** [FLOW-143](FLOW-143.md) (the company profit head), [FLOW-144](FLOW-144.md) (the card's start row and strong net, the chart's dashed cap) · **Source:** the board's canvas note spec-years ("PROFIT BY YEAR AND SINCE THE START", approved), Profit and ProfitLight boards (`co.periods`, `longView`, `YEARS`, `YPROJ`, `chartRows`, presets `year` and `alltime`), ProfitYear and ProfitAllTime frames, 2026-10-20
- **Files:** to be listed as the build goes.

**The switch**
- [ ] Under the title and its sub, the loans summary's period switch: אוקטובר | 2026 | מההתחלה (the shown month's name, this year). Everything under it follows it; it keeps its choice while the page is open.

**2026 (the year)**
- [ ] Sub "2026 · עד היום, 20/10"; the big figure is the year's profit to date.
- [ ] Summary: הכנסות, הוצאות שנספרות ברווח, bold רווח 2026 עד היום, רווח 2025 כולה.
- [ ] The forecast card in the תזרים צפוי form: "סוף 2026" with צפי, the start row רווח עד היום, the rest of the year's הכנסות צפויות and הוצאות צפויות, a bold רווח צפוי ל־2026.
- [ ] The chart "הכנסות והוצאות לפי חודש": January to this month, the rest of the year dashed.
- [ ] Chips לפי חודש (default) and לפי פרויקט: months newest first, the current one opening the month view; each project's year, finished projects as one row, a project opening its profit page.
- [ ] A past year (from מההתחלה): "2025 · שנה סגורה", no forecast card, twelve solid months, compared with the year before.

**מההתחלה**
- [ ] Sub "מאז ינואר 2024 · 3 שנים"; the big figure is the profit since the start.
- [ ] Summary: הכנסות, הוצאות שנספרות ברווח, bold רווח מתחילת הדרך, השנה הרווחית ביותר · <year>.
- [ ] The chart "הכנסות והוצאות לפי שנה": a pair per year, this year solid to date with a dashed cap still expected.
- [ ] "לפי שנה": a row per year, newest first, opening that year.

**Acceptance:** unit tests for the year and all-time figures and the rest-of-year forecast; a screen test for the switch; stories for the three states in dark and light; the company profit e2e.
