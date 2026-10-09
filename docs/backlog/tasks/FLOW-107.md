<a id="flow-107"></a>
# FLOW-107 · Loan split breakdown on the transaction
- **Type:** SMALL UI · **Status:** done (#83) · **Depends on:** FLOW-101 (merged, #70)
- **Approved:** owner chose option A of the [mockups](https://claude.ai/artifact/MSVfZhxN56T2V6epZaQ25v) on 2026-10-07 (parts list with icons, minus, total, "מחוץ לרווח", "נספר ברווח"; list rows "3 חלקים"). Decision [0107](../../decisions/0107-loan-split-on-the-transaction.md).
- **What:** When a bank line is a split loan payment, show its parts (principal, interest, escrow) on the transaction row and in the detail, so the expense makes sense. Icon-based, minimal wording, expenses with a minus. MCP: `get_expense` returns the split parts.
- **Acceptance:** quick mockup approved; parts add up to the line amount on screen; MCP test; design review.
