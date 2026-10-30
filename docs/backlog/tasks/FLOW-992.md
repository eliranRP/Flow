<a id="flow-992"></a>
# FLOW-992 · Reports as a real Excel file (xlsx)
- **Type:** MCP (design approved) · **Status:** in-progress (#887) · **Depends on:** [FLOW-991](FLOW-991.md) (same PR) · **Source:** the owner, 2026-10-30, with FLOW-991. **Approved:** the owner, 2026-10-30. Design: [Reports export](https://claude.ai/artifact/Bhc1JVsCQYmdVXFGcb9PuU), section "Excel (xlsx)".
- **Files:** `supabase/functions/_shared/report_xlsx.ts` (new), `report_files_test.ts`, `supabase/functions/flow-mcp/tools_export.ts`, `supabase/functions/flow-mcp/handler.ts` (the `report` route's media type), `docs/mcp/TOOLS.md`.

- [x] `export_report` takes `format: "xlsx"`: a sheet per report, right to left, amounts as numbers with a currency format and cents, every total a SUM formula, sub-categories in an outline group under their category, the head row and the names column frozen, and a "פרטים" sheet (company, period, basis, projects, made at, notes).
- [x] CSV stays in the MCP tool for one release (the app moves to xlsx in FLOW-993).

**Acceptance:** a unit test unzips the file and checks the sheets, a SUM formula, the right-to-left view and the outline levels.
