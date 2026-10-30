<a id="flow-174"></a>
# FLOW-174 · Correct a posted journal entry in place, with its history
- **Type:** MCP + DB · **Status:** in-progress (#876) · **Depends on:** [FLOW-149](FLOW-149.md), [FLOW-156](FLOW-156.md) · **Source:** the MCP/data agent, 2026-10-30: a posted journal entry can only be removed (`undo`, by the member who wrote it, while unchanged) or offset by a second entry. A bookkeeper needs to correct the entry itself and keep a record of what changed.
- **Files:** a new migration in `supabase/migrations/`, `supabase/migrations.lock`, `supabase/tests/database/journal_entry_update.test.sql` (and the registries: `privilege_guards`, `cross_company_sweep`, `mcp_undo_company`), `supabase/functions/flow-mcp/` (`tools_ledger.ts`, `tools_ledger_schemas.ts`, `tools_ledger_specs.ts`, `tools_schemas.ts`, `tools_specs.ts`, `tools_write.ts`, `tools_guide_data.ts`, their tests), `docs/mcp/TOOLS.md`, `packages/shared/src/database.types.ts`, decision 0234.

- [x] MCP `update_journal_entry` (owner or editor, any member's entry): `journal_entry_id`, `expected_version`, optional `doc_date`, `description`, `reference` and `legs` (replaces every leg, with `create_journal_entry`'s rules), and a required `reason` (1 to 200). The entry keeps its id; left-out fields stay.
- [x] Every edit saves the version it replaces (legs, date, description, reference, who, when, why); MCP `get_journal_entry_history` returns the versions.
- [x] Refused: an out-of-date `expected_version` (`entry changed`), a line that is not a journal entry (`not a journal entry`), an old or new date on or before the books-closed date, an entry of a prepaid schedule, a viewer.
- [x] Undo kind `journal_entry_update` puts the previous version back while the entry is still the version written.
- [x] `get_expense` and `get_line_legs` give the entry's `version`.

**Acceptance:** pgTAP for the edit (same id, legs, P&L and balance-sheet totals move by the difference only, no cash view), the history, every refusal, undo and its conflict, and another company's entry; Deno tests for the tool's arguments.
