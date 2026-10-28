<a id="flow-160"></a>
# FLOW-160 · Reports: one P&L statement read for the app, the MCP and the PDF
- **Type:** MCP · **Status:** claimed (dev lane 1, 2026-10-28, flow-160-pnl-statement) · **Depends on:** FLOW-952, FLOW-152 · **Related:** [FLOW-161](FLOW-161.md) (the screens), [FLOW-162](FLOW-162.md) (the PDF) · **Source:** owner, 2026-10-28: P&L and balance sheet reporting; design approved the same day (Design canvas, page "In design · for approval", row "דוחות").

The reports screen shows the P&L as a statement: sections with subtotals and a bottom line, for all projects together, one project, or each project side by side. Today the app and the assistant build that from several reads (`get_breakdown`, `get_project`, `get_dashboard`), so a statement could drift between the screen, the PDF and the assistant. One read gives all three the same numbers. The balance sheet already has one (`get_balance_sheet`).

- [ ] A database read `get_pnl_statement(from, to, project_id, by_project, basis)` returns, per currency: income and expense sections, each with its categories (a parent with its sub-categories rolled up, the sub-categories listed under it), section totals, and the net profit; the kept-out categories with the account they post to; the review count. `by_project` returns one statement per project plus the overhead and unassigned columns, adding up to the company total.
- [ ] The numbers match the reads the screens use today: the company totals equal `get_dashboard` for the same range and basis, a project's equal `get_project`.
- [ ] MCP `get_pnl_statement` (read, any member), in the ledger reads group, documented in `docs/mcp/TOOLS.md`.
- [ ] Another company's project id is refused like every read (`not_found` / `project not found`).

**Acceptance:** pgTAP for the totals against `get_dashboard` and `get_project` on the broad fixture, both bases, a project, by project, a sub-category, a kept-out category and a second currency; the cross-company refusal with a positive control; the flow-mcp Deno tests.
