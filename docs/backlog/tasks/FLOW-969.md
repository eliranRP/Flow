<a id="flow-969"></a>
# FLOW-969 · Profit v2: the UX/UI rules review of the profit pages
- **Type:** UI (design approved) · **Status:** in-progress · **Depends on:** — · **Source:** a review of the profit pages against a UX/UI rule set. The owner approved the design on 2026-10-26; on a card the same day: every profit chart (company, project and month) gets a one-line takeaway title. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", the Profit row and its findings note ("PROFIT v2").
- **Files:** `app/src/screens/company-profit-screen.tsx`, `company-profit-period.tsx`, `company-next-month-block.tsx`, `project-profit-screen.tsx`, `project-month-profit-screen.tsx`, `project-next-month-screen.tsx`, `project-next-edit-screen.tsx`, `profit-categories.tsx`, `next-month-block.tsx`, `app/src/ui/css/47-company-profit.css`, `45-project-profit.css`, their stories and tests, a decision record, a design log entry.

- [x] Expense bars, forecast dashed edges and history bars reach 3:1.
- [x] Failed and offline states on the profit pages.
- [x] "הסרה מהצפי" offers a 5s ביטול under the header.
- [x] View chips and period segments are one-choice radios, 44px.
- [x] Every profit chart heads with its takeaway; the metric is the small label (owner card).
- [x] The category search edge and the forecast name underline reach 3:1; placeholders 4.5:1.
- [x] "לכל הפרויקטים" is 44px.
- [x] The shared type pass (sizes on the scale, tabular figures).
- **Acceptance:** stories of the failed and offline states; tests for the states, the takeaways, the undo and the radios; decision record; design log entry.
