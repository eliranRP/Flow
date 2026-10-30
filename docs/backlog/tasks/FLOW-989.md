<a id="flow-989"></a>
# FLOW-989 · The category drill-down's split by project counts a split line by its parts
- **Type:** BUG · **Status:** claimed (dev lane, 2026-10-30, flow-989-category-by-project-parts) · **Source:** the owner's bug report, 2026-10-30: on Reports → a category → "לפי פרויקט", a line split over several projects put its parts under "בלי פרויקט" or under the wrong project, while `get_pnl_statement` by project was right.
- **Files:** `supabase/migrations/20261029190012_category_by_project_parts.sql` (`get_breakdown_lines`), `supabase/tests/database/category_by_project_parts.test.sql`, `supabase/tests/database/flow_breakdown.test.sql`, `packages/shared/src/dashboard.ts` (`breakdownLinesSchema`), `app/src/screens/report-lines-screen.tsx` and its test, `docs/mcp/TOOLS.md`, a changelog fragment.

Cause: `get_breakdown_lines` merged a line's rows in one category by line and loan part. A split by category has no loan part, so a line's two parts in one category on two projects became one row with no project.

- [x] Each part lists on its own project, with its own amount; a part in another category is not in this one.
- [x] The read returns `projects`: the whole category by project, read as `get_pnl_statement` by project reads it (a split line by its parts, a shared cost by its allocations, a whole line by its project). The screen's split shows it, so it always equals the P&L by project, and "בלי פרויקט" lists only amounts with no project.
- [x] A project's row opens that project's lines in the category (its parts, including parts of lines on another project).

**Acceptance:** pgTAP for the four cases in the report (no-project line split over two projects; a line on A with a part on B; a shared line; the split equals `get_pnl_statement` by project); a unit test for the screen.
