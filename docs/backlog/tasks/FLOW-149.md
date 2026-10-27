<a id="flow-149"></a>
# FLOW-149 · Journal entries that move no money (depreciation), and the balance-sheet balances per project
- **Type:** MCP + DB · **Status:** in-progress (#844) · **Depends on:** — · **Related:** [FLOW-953](FLOW-953.md) (balance-sheet accounts), [FLOW-952](FLOW-952.md) (the P&L reads the legs) · **Source:** the MCP/data agent, 2026-10-27: the tax books record a property's yearly depreciation, a debit to a depreciation expense and a credit to accumulated depreciation. Flow has no entry that moves no money: `book_line` needs a bank leg, `create_manual_entry` is cash or a cheque, and the split tools need a bank line. It is the largest gap between the two P&Ls.
- **Files:** `supabase/migrations/20261027203804_journal_entries.sql`, `supabase/migrations.lock`, `supabase/tests/database/journal_entries.test.sql` (and the registries: `privilege_guards`, `cross_company_sweep`, `mcp_undo_company`, `ledger_balance_accounts`), `supabase/functions/flow-mcp/` (`tools_ledger.ts`, `tools_ledger_schemas.ts`, new `tools_ledger_specs.ts`, `tools_schemas.ts`, `tools_specs.ts`, `tools_write.ts`, their tests), `docs/mcp/TOOLS.md`, `app/e2e/journal-entry.spec.ts`, `app/e2e/spec-sources.json`, `packages/shared/src/database.types.ts`, decision [0228](../../decisions/0228-journal-entries.md).

- [x] A system asset account **Accumulated depreciation** in every company, bookable, carried per project on its legs.
- [x] MCP `create_journal_entry` (owner or editor): `doc_date`, `currency`, `description` (1–120), optional `reference`, and balanced `legs` with no bank leg. It counts in the P&L by project and by the month of `doc_date`, stays out of every cash view, never waits for review, cannot be edited, and undoes (`journal_entry`).
- [x] MCP `get_account_balances`: each balance-sheet account's balance per project as of a date, and each project's net book value (Property plus Accumulated depreciation).
- [x] `get_expense` / `get_line_legs` show a journal entry's legs and its reference.

**Refused for now:** an entry with no P&L leg, or whose P&L legs net to 0 (a reclass), until the P&L reads the legs (FLOW-952).

**Later:** the screen (a design task: the "פקודת יומן" entry and its badge in the lists), and a depreciation schedule per property that makes the entries.

**Acceptance:** pgTAP: an entry moves the P&L of its project and month and no cash figure, balances, cannot be edited, and undoes; Deno tests for the tools; an e2e that the profit page shows the entry and the cash lines do not.
