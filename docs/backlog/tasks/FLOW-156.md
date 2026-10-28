<a id="flow-156"></a>
# FLOW-156 · Books closed through a date
- **Type:** MCP · **Status:** in-progress (#852) · **Source:** owner, 2026-10-28 (chose a per-company books-closed date for the prepaid spec's "closed period" rule).
- **Files:** the FLOW-155 migration, its tests, `supabase/functions/flow-mcp/`, `docs/mcp/TOOLS.md`.

- [x] `companies.books_closed_through` and MCP `set_books_closed_through` (owner only, never after today, undo kind `books_closed`).
- [x] Prepaid writes refuse to add, change or remove a posted row on or before it ("the books are closed through YYYY-MM-DD"); closing past a due, unposted prepaid row is refused.
- [x] Other write tools are not gated yet (a later task).

**Acceptance:** pgTAP for the refusals, the owner-only rule and undo.
