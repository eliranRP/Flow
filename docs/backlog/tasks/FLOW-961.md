<a id="flow-961"></a>
# FLOW-961 · Project v2: the UX/UI rules review of פרויקטים and the project page
- **Type:** UI (design approved) · **Status:** in-progress · **Depends on:** — · **Source:** a review of the Projects list and the project page against a UX/UI rule set. The owner approved the design on 2026-10-26. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "In design · for approval", boards Project v2 (dark and light) and the note "PROJECT v2".
- **Files:** `app/src/screens/projects-screen.tsx`, `app/src/screens/project-detail-screen.tsx`, `app/src/screens/project-menu.tsx`, `app/src/screens/project-page-cards.tsx`, `app/src/screens/project-form-sheet.tsx`, the project CSS under `app/src/ui/css/`, the chart and budget bar tokens, their stories and tests, a design log entry.

- [ ] The chart's out bars, the budget track and the loan segment meet 3:1 (out bars in ink, the empty part of the budget as an outline), light and dark.
- [ ] סיום הפרויקט finishes at once with a 5s ביטול toast under the header; the confirm sheet is gone. Delete still asks.
- [ ] The ⋯ menu's השקעה והלוואות opens the investment screen.
- [ ] Finished projects are full contrast, open their page, and their menu offers החזרה לפעילים.
- [ ] The project page has Home v2's failed card and offline line.
- [ ] The pending row is Home v2's filled review button with its time.
- [ ] The chart title states the takeaway; its screen-reader label reads every month.
- [ ] Over budget shows on the bar: it runs past a tick in the error colour, with the overrun.
- [ ] A project with no budget (not a rental) shows a dashed card with הוספת תקציב.
- [ ] יצירת פרויקט is never disabled; with no name the field says why.
- [ ] Amounts use tabular figures; the delete button says מחיקת הפרויקט; the list header has one search and one +.
- **Acceptance:** stories of the list, the project page (over budget, no budget, failed, offline) at 320 and 393, light and dark; tests for finish and undo, the menu row, the create error, the chart label; design log entry.
