<a id="flow-604"></a>
# FLOW-604 · rename_company follow-ups (#77 review)
- **Type:** BACKLOG NIT · **Status:** done (#120) · **Depends on:** FLOW-602
- **What:** (1) The MCP length check counts UTF-16 units, SQL counts code points; align them. (2) SQL `btrim` strips only spaces while the MCP trims all whitespace; trim all whitespace and reject control characters in `rename_company`. (3) A direct table update can still set any name; add a not-valid check constraint for 2 to 100 characters, or revoke `update(name)` once the screen uses the RPC. (4) pgTAP: assert an `audit_log` row after the MCP rename and after undo, and cover the refused path.
- **Acceptance:** the same name is accepted or refused by the MCP, the RPC, and the table; audit rows tested.
- **Built (#120):** `private.trim_name` trims what JavaScript `trim()` trims and `private.company_name_problem` holds the rule (2 to 100 code points, no control character) for `rename_company` and `mcp_rename_company`; the MCP counts code points. (3) is a `before update of name` trigger, not a check constraint, so a name that already breaks the rule never blocks an update of another column; it refuses with `23514`.
