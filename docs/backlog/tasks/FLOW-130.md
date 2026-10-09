<a id="flow-130"></a>
# FLOW-130 · Lock timeouts return retry in every MCP write (#123 review)
- **Type:** BACKLOG NIT · **Status:** done (#124) · **Depends on:** FLOW-129
- [x] The other `mcp_*` write functions still send `lock_not_available` to `others`, so a lock timeout is stored as a refusal under the idempotency key. Map it to `unavailable` / `retry` in each, as #123 did for `attach_loan_payment` and `undo`, and update TOOLS.md. (Migration `20261008050000`, 18 tools, tested in `mcp_lock_retry.test.sql`.)
