<a id="flow-105"></a>
# FLOW-105 · Link a loan to a project
- **Type:** SMALL CYCLE · **Status:** done (#89, server and MCP); the loan sheet picker is [FLOW-119](FLOW-119.md) · **Depends on:** —
- **Owner's go:** 2026-10-07, in the project thread (taken off hold).
- **What:** Optional `loans.project_id` (FK, RLS, migration), settable in MCP `add_loan` / `update_loan` (idempotency, undo, RPC). Show the loan under its project; attached payment splits inherit the loan's project.
- **Acceptance:** cross-tenant project refusal with a positive control; split inheritance tested; undo restores.
