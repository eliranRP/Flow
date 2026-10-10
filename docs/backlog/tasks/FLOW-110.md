<a id="flow-110"></a>
# FLOW-110 · Loans list and detail
- **Type:** PLAN FIRST · **Status:** done (#197 server, #305 screens) · **Depends on:** FLOW-501 (where loans live)
- **What:** (1) Reorder loans (persisted order; dropped by the owner, 2026-10-08). (2) Edit and delete on each loan, with a confirm for delete. (3) A loan detail page with its attached payments (principal, interest, escrow, fees) linked to the bank rows. MCP: `reorder_loan`, `delete_loan` (update and list exist).
- **Acceptance:** mockup approved; MCP tools with undo.
- [x] Server and MCP: `delete_loan` with `restore_loan` and MCP undo `loan_delete` (payments unmatch, the owner's choice), `reorder_loans` with MCP undo `loan_order`, `list_loans` in the saved order (migration `20261011030000`, decision [0142](../../decisions/0142-loan-delete-and-order.md)). Plan: the project's plans/flow-110-loans-server.md.
- Owner, 2026-10-08: loan reordering is dropped. Loans stay alphabetical; delete with undo and the payments section stay. The server's `reorder_loans` stays unused by the app.
- [x] Screens (PR #343): delete on the loan page with a confirm that names how many payments go back and a toast with ביטול (`restore_loan`), and the payments section (`mcp_loan_payments`: the last 3, then כל התשלומים). No reorder (dropped above); `sort_order` and `reorder_loans` stay for MCP.
