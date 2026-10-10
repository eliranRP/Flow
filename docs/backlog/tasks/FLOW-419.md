<a id="flow-419"></a>
# FLOW-419 · Project page opens on its cash view
- **Type:** PLAN FIRST · **Status:** done (#504, decision 0176); owner approved option A "Like Home" on a card, 2026-10-10 09:19Z · **Depends on:** [FLOW-413](FLOW-413.md)
- **What:** The owner (2026-10-10) needs too many taps to reach the view he wants on a project. Most of the time he wants the project's cash; investment and loans should have a place of their own.
- **Owner's pick:** A, "Like Home". The project band shows this month's cash for the project (תזרים אוקטובר and the net). Rows: נכנס, יצא, רווח החודש (opens today's profit page with its month pill), השקעה והלוואות (one row with הון עצמי בנכס, opens its own page), then חודשים קודמים. The period pill moves from the project band to the profit page.
- **Mockups:** `mockups/plan-first/project-page/` in the project files: a-1, a-2, a-3 (picked), b-1, b-2, c-1; plan.md has the build plan and the design lead's notes.
- **Acceptance:**
  - [x] A project's cash per month and its lines, from one read each (`project_cash_months`, `project_cash_month_lines`), with MCP tools; a split line counts only its project's part.
  - [x] The project page opens on cash; the profit page and the השקעה והלוואות page are one tap away; an earlier month opens its own page.
  - [x] Skeleton, Storybook stories (cash, loss month, no investment, two currencies), a design log entry, and the 0.7 s open budget kept.
