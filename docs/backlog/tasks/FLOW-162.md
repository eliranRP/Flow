<a id="flow-162"></a>
# FLOW-162 · Reports: share the P&L and balance sheet as a PDF
- **Type:** UI (design approved) · **Status:** ready · **Depends on:** [FLOW-160](FLOW-160.md), [FLOW-161](FLOW-161.md) · **Source:** owner, 2026-10-28. **Approved:** with FLOW-161 on 2026-10-28. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "In design · for approval", the share sheet board and the row "the shared PDF" (three A4 pages) with its build-spec note.

- [ ] The share sheet: pick רווח והפסד, מאזן or both, and whether collapsed sections print in full; the phone's share sheet sends the file.
- [ ] The PDF follows the spec note: A4, Rubik embedded, right to left, header and footer on every page, repeated table headers, rows that never split, a page per report, the by-project page.
- [ ] The assistant gets the same file (an MCP tool), or the plan says why not.

**Decisions needed:** where the file is made (on the phone from the same read, or on the server so the MCP can return it); a short plan before the build.
