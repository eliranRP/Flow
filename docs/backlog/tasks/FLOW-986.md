<a id="flow-986"></a>
# FLOW-986 · דוחות takes קבועים's place in the tab bar; three concepts for where קבועים lives
- **Type:** SMALL UI · **Status:** in-progress (flow-986-reports-tab) · **Source:** the owner, 2026-10-30: "replace the recurring tab with reports on the bottom nav, and suggest 3 design concepts for where to move it".
- **Files:** `app/src/ui/tab-bar.tsx`, `app/src/ui/icons.tsx` (`ReportsIcon`), `app/src/ui/icons.stories.tsx`, `app/src/ui/recurring-list.tsx` (`RecurringBack`), `app/src/screens/recurring-screen.tsx`, `app/src/screens/reports-screen.tsx` (header), `app/src/dev/routes/index.ts`, the tab tests and e2e specs, `docs/design/DESIGN-RULES.md` (row 18), a design log entry, a changelog fragment.

- [x] The tab bar reads בית · פרויקטים · דוחות · הלוואות, in the board's ReportTab order and icon. דוחות is lit on `/reports` and its drill-downs.
- [x] דוחות is a tab root: no "‹ בית" in its header.
- [x] קבועים (`/recurring`, `/missing-bills`) lights בית, and its header gets "‹ בית", until the owner picks where it lives.
- [ ] The owner picks one of the three concepts on the board's "In design · for approval" page (A: a קבועים card on Home; B: a repeat icon in Home's top bar; C: a קבועים segment inside the month's lines). The pick becomes its own task.
- **Acceptance:** the tab unit tests and e2e specs pass with four tabs; the reports screen has no Back; קבועים still opens from Home's late-bills row and goes back to Home.
