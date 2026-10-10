<a id="flow-103"></a>
# FLOW-103 · One P&L basis for the app and MCP totals
- **Type:** PLAN FIRST · **Status:** in progress (owner picked payment date for everyone, 2026-10-10; server and MCP #473, decision 0170; the app reads and the Settings row in UI lane 1's PR, waiting on the owner's shots) · **Depends on:** —
- **What:** The app shows the invoiced basis ([0060](../../decisions/0060-library-review-calls.md)) while MCP `get_totals`, `list_projects` and `get_project` default to cash. The owner's answer (2026-10-09): the user chooses the basis, invoice date or payment date, and the MCP defaults follow the same choice, so the app and the tools never disagree. It changes behaviour for existing MCP clients. Also decide what to do with `get_home` (cash, only used at sign-in): align it or remove it.
- **Acceptance:** plan and 390px mockups approved by the owner; then the basis choice, MCP defaults that follow it, tools that echo the basis, TOOLS.md updated.
