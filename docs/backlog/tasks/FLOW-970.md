<a id="flow-970"></a>
# FLOW-970 · Forecast v2: the UX/UI rules review of תזרים צפוי
- **Type:** UI (design approved) · **Status:** in-progress · **Depends on:** — · **Source:** a review of the month-end forecast (/forecast) against a UX/UI rule set. The owner approved the design on 2026-10-26, with no owner call open. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", the Month-end forecast row and its findings note "FORECAST v2".
- **Files:** `app/src/screens/forecast-screen.tsx`, `app/src/screens/forecast-parts.tsx`, `app/src/screens/forecast-item-page.tsx`, `app/src/screens/forecast-category-view.tsx`, `app/src/forecast-chart.ts`, `app/src/ui/css/28-forecast.css`, `app/src/ui/css/28-forecast-categories.css`, their stories and tests, a decision record, a design log entry.

- [ ] The category view's bar track and every forecast graphic reach 3:1 (the "out" bars and the dashed card edges come with FLOW-961 and FLOW-969).
- [ ] Failed and offline states: a failure card over the figures, an offline line.
- [ ] Toasts sit under the header, ביטול 5s and a note 4s.
- [ ] The view chips and the chart's link are 44px.
- [ ] The chart's title is its takeaway ("אוקטובר צפוי להיסגר ב־−$5,741").
- [ ] The item page's button says what it saves: "שמירת השינוי בצפי".
- [ ] Type scale only, tabular figures.
- **Acceptance:** stories of the failed and offline states; tests for the toasts' place and times, the states and the takeaway; decision record; design log entry.
