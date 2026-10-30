<a id="flow-991"></a>
# FLOW-991 · Reports by property or by period: the grid read, export_report's columns and project_ids, and the landscape PDF
- **Type:** MCP (design approved) · **Status:** claimed (dev lane, 2026-10-30, flow-991-report-columns) · **Source:** the owner, 2026-10-30: export the P&L and the balance sheet as PDF and Excel, aggregated by date or project, filtered by date and project, from the app and the MCP, in the layout of an accounting app's "by property" report. **Approved:** the owner, 2026-10-30 ("Approve"). Design: [Reports export](https://claude.ai/artifact/Bhc1JVsCQYmdVXFGcb9PuU), sections "PDF · רווח והפסד לפי נכס", "לפי חודש", "מאזן לפי נכס", "מאזן לפי רבעון", MCP.
- **Files:** `supabase/functions/_shared/report_grid.ts` (new), `report_model.ts`, `report_pdf.ts`, `report_csv.ts`, `report_sample.ts`, `report_files_test.ts`, `supabase/functions/flow-mcp/tools_export.ts`, `tools_export_test.ts`, `tools_ledger_specs.ts`, `tools_schemas.ts`, `tools_guide_data.ts`, `docs/mcp/TOOLS.md`, a changelog fragment.

One rule: the columns are projects or periods, never both; the other is a filter.

- [ ] `export_report` takes `columns` (total, project, month, quarter or year; default total) and `project_ids` (one or more; empty is every project). `by_project: true` still works and means `columns: "project"`; `project_id` still works and means `project_ids: [id]`.
- [ ] P&L by project: a row per category and sub-category, a column per project, a "כללי" column (overhead and lines with no project) when no projects are picked, and a total that equals the company P&L. With projects picked, only those columns and their total.
- [ ] P&L by period: a column per month, quarter or year from `from` to `to` (both needed), each read with the same projects filter; the total is the sum of the columns.
- [ ] Balance sheet by project: a column per project, read with that project; "כללי" is the company less the projects; a "נכסים נטו" row; equity only in the total column.
- [ ] Balance sheet by period: the balance at the end of each period, the last column at `to`.
- [ ] The PDF draws a grid on A4 landscape when it has more than 4 amount columns, up to 13 amount columns a block; more columns take more blocks. The total-only reports are unchanged.
- [ ] The CSV writes the same grid. `format: "json"` returns the grid itself, so the assistant can read the numbers without a file.

**Acceptance:** unit tests: the project grid's total equals the company statement; the "כללי" balance column is the company less the projects; the period grid's total equals the sum of its columns; the argument refusals; the PDF renders landscape pages for a wide grid.
