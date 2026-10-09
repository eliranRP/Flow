<a id="flow-403"></a>
# FLOW-403 · Project timeline and expected months
- **Type:** PLAN FIRST · **Status:** done (#260). Approved option A by the owner, 2026-10-08 (plans/jev-bills-forecast.md and its mockup): Home's late-bills row, the `/missing-bills` list, and a צפוי section of three months with a month sheet on the project page. Screen only (server parts exist: `get_project` takes any date range, [0129](../../decisions/0129-profit-by-month.md) and [0141](../../decisions/0141-period-bar.md); `get_expected_months` takes a project, [0131](../../decisions/0131-jev-patterns.md); `project_category_months` gives the expected cost per category, [0149](../../decisions/0149-project-category-months.md)). A UI lane plans the screen with a mockup · **Depends on:** FLOW-401
- **What:** Transactions by a chosen date range (for example last month), plus expected future months from past data, computed in SQL. Shares the recurring-pattern base with FLOW-701.
- **Acceptance:** plan approved.
