<a id="flow-602"></a>
# FLOW-602 · Rename a company
- **Type:** SMALL CYCLE · **Status:** done (#77 RPC and MCP, #82 screen; option A approved by the owner on 2026-10-07: the business name is its own Settings row that opens a one-field rename sheet, decision [0108](../../decisions/0108-rename-company-row.md)) · **Depends on:** —
- **What:** An owner-only RPC and MCP tool `rename_company` (idempotency key, write bucket, undo). The in-app place is a small focused screen or sheet, not a Settings catch-all; it needs a quick mockup and can ship in a second PR.
- **Acceptance:** viewer refused, other company refused with a positive control, undo restores, TOOLS.md.
