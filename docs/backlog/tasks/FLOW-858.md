<a id="flow-858"></a>
# FLOW-858 · The undo tool advertises every kind it accepts
- **Type:** SMALL CYCLE (infra) · **Status:** in-progress · **Source:** the weekly security scan, 2026-11-21 (a functional find); the owner's choice the same day.
- **Files:** `supabase/functions/flow-mcp/tools_schemas.ts` (`UNDO_KINDS`), `supabase/functions/flow-mcp/tools_specs.ts` (the undo spec), `supabase/functions/flow-mcp/tools_undo_kinds_test.ts`, a changelog fragment.

- [x] One list, `UNDO_KINDS`, feeds both the undo argument schema and the undo tool's advertised `kind` enum, so the prepaid kinds and `books_closed` are advertised too.

**Acceptance:** the undo tool's spec lists exactly the kinds the server accepts; `set_books_closed_through`'s "undo as kind books_closed" works from a client that validates against the spec.
