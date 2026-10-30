<a id="flow-988"></a>
# FLOW-988 · The P&L lists numbered categories by their number
- **Type:** SMALL CYCLE · **Status:** in-progress (flow-988-report-number-order) · **Source:** the owner, 2026-10-30: "sort the list by the numbers if exists so 05, 06, 07 and so on".
- **Files:** `app/src/reports.ts` (`byCategoryNumber`), `app/src/screens/reports-parts.tsx` (`sideRows`), `app/src/reports.test.ts`, a changelog fragment.

- [x] On the reports' P&L, a side's categories and a group's children that start with a number come first, by that number (05, 06, 07 … 11). The rest follow in the statement's order (largest first). Display only: `get_pnl_statement` and the MCP keep their order.

**Acceptance:** a unit test for the order.
