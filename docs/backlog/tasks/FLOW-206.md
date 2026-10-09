<a id="flow-206"></a>
# FLOW-206 · Bulk setup without rate-limit stalls
- **Type:** MCP · **Status:** done (#119) · **Depends on:** —
- **What:** `create_project` and `create_category` hit HTTP 429 after about 10 calls in a row during a company setup. Add batch create tools (like `assign_expenses`) or a higher burst for setup. Also send the MCP `tools/list_changed` notification so clients refresh a stale tool list after a deploy.
- **Acceptance:** a setup of 30 projects and categories runs without a 429; tests for the batch and the notification.
