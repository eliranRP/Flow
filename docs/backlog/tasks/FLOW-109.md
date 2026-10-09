<a id="flow-109"></a>
# FLOW-109 · Income assigned to a project: confirm it counts in that project
- **Type:** BUG · **Status:** done (#74) · **Depends on:** —
- **What:** Income filed to a project through MCP `assign_expense` gets no allocation row and a null `pnl_role`, while expenses filed the same way get a 100% allocation with role `project`. Verify whether that income counts in the project's P&L; if not, fix `assign_expense` (and the batch path) for income.
- **Acceptance:** pgTAP: income assigned to project A shows in A's `get_project` income and in the company total exactly once; undo removes it; MCP test for the income path.
