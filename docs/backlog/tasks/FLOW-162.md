<a id="flow-162"></a>
# FLOW-162 · Reports: share the P&L and balance sheet as a PDF or a CSV for Excel
- **Type:** UI (design approved) · **Status:** ready · **Depends on:** [FLOW-160](FLOW-160.md), [FLOW-161](FLOW-161.md) · **Source:** owner, 2026-10-28. **Approved:** with FLOW-161 on 2026-10-28. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "In design · for approval", the share sheet board and the row "the shared PDF" (three A4 pages) with its build-spec note.

- [ ] The share sheet: pick רווח והפסד, מאזן or both, and whether collapsed sections print in full; the phone's share sheet sends the file.
- [ ] The PDF follows the spec note: A4, Rubik embedded, right to left, header and footer on every page, repeated table headers, rows that never split, a page per report, the by-project page.
- [ ] The assistant gets the same file: MCP `export_report` (PDF or CSV), the file as an embedded resource.
- [ ] A CSV for Excel from the same reads: UTF-8 with a byte-order mark, amounts as decimals, formulas defused.

**Decided** (owner, 2026-10-29, "PDF + Excel"): flow-mcp makes the file on the server from the same reads as the screen (`get_pnl_statement`, `mcp_balance_sheet`), so the app's share button and the assistant get the same file. The MCP tool is `export_report`; the app calls flow-mcp's `report` route with the user's session. An earlier lane default (the phone makes the PDF) is replaced.
