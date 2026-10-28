<a id="flow-217"></a>
# FLOW-217 · An MCP agent learns the tools in one call
- **Type:** MCP · **Status:** done (#850; deployed eacfd73 by the manual ci run of 2026-10-28; prod check by dev lane 1, read-only SQL through the Supabase connector: migration 20261028093217 recorded, 0 legacy tables or functions, 0 unbalanced lines, every company and currency nets to 0, the app serves eacfd73) · **Source:** owner, 2026-10-28.
- **Files:** `supabase/functions/flow-mcp/handler.ts`, `tools_specs.ts`, `tools_schemas.ts`, a new guide module and its test, `docs/mcp/TOOLS.md`.

An agent that connects sees 120+ flat tools with long descriptions and no map: no server instructions on `initialize`, no overview tool.

- [x] `initialize` returns `instructions`: what Flow is, the ledger model in five lines, and "call get_started first".
- [x] A read tool `get_started` (every scope): the tool groups with one line per tool, the common workflows step by step (book a bank line, a journal entry, bind a category, read the P&L and the balance sheet, undo), and the rules (idempotency keys, undo, amounts in minor units). Only the tools the caller's scope allows are listed.
- [x] A test keeps the guide in step with the tool list: every tool is in exactly one group.

**Acceptance:** Deno tests; `tools/list` and `initialize` checked in the handler tests.
