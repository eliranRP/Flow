# 0095 MCP-first features

- Date: 2026-10-06
- Status: Accepted (owner)

## Decision
Flow is MCP-first. Every new feature or user action ships with `flow-mcp` support in the same pull request, before or together with the UI:

1. A `flow-mcp` tool covers the action. Write tools take an idempotency key, count against the write rate limit, and support `undo`.
2. When the action can also be offered as an API (a Postgres RPC callable through PostgREST, or an edge function endpoint), it is added as well.
3. `docs/mcp/TOOLS.md` lists the new tool in the same pull request.

A pull request that adds a user action without MCP support is Blocking in review. If MCP support truly can't apply (pure layout or copy), the PR body says why.

## State
| Item | State |
|------|-------|
| Rule in CONTRIBUTING.md and CHECKLIST-code.md | Shipped |
