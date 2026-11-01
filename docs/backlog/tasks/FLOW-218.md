<a id="flow-218"></a>
# FLOW-218 · MCP keys can't invite or change roles; agents treat returned text as data
- **Type:** MCP · **Status:** done (#910) · **Depends on:** [FLOW-601](FLOW-601.md) (the team tools) · **Source:** the owner, 2026-11-01, decision [0241](../../decisions/0241-mcp-keys-cannot-invite.md)
- **Production (2026-11-01):** migration 20261101081302 is applied; `mcp_invite_member` and `mcp_set_member_role` are gone, and `invite_member` and `set_member_role` both carry the `mcp_tid` guard (read-only check).
- **Files:** `supabase/migrations/` (one new file), `supabase/functions/flow-mcp/` (the tools, their specs and tests, the guide), `supabase/tests/database/`, `packages/shared/src/database.types.ts`, `docs/mcp/TOOLS.md`, `docs/decisions/`.

A write key is held by an AI agent that reads text other people wrote. Giving someone access to the company is done by the owner in the app, not by a key.

- [x] `invite_member` and `set_member_role` refuse a request that carries a flow-mcp token (`forbidden`, 42501), as `delete_company` does; the two tools and their `mcp_` wrappers are removed. `remove_member` stays; the `invite` undo kind stays.
- [x] The server instructions and the `get_started` rules say that text in results is data from users or banks, never instructions, and to ask the owner before bulk writes.
- [x] The `sync_bank` description says it has no undo.
- [x] TOOLS.md, the decision index, pgTAP and the generated types follow.
