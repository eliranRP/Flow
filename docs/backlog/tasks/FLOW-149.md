<a id="flow-149"></a>
# FLOW-149 · Journal entries that move no money (depreciation), and the balance-sheet balances per project
- **Type:** MCP + DB · **Status:** claimed (dev lane 1, 2026-10-27, flow-149-journal-entries) · **Depends on:** — · **Related:** [FLOW-953](FLOW-953.md) (balance-sheet accounts), [FLOW-952](FLOW-952.md) (the P&L reads the legs) · **Source:** the MCP/data agent, 2026-10-27: the tax books record a property's yearly depreciation, a debit to a depreciation expense and a credit to accumulated depreciation. Flow has no entry that moves no money: `book_line` needs a bank leg, `create_manual_entry` is cash or a cheque, and the split tools need a bank line. It is the largest gap between the two P&Ls.
- **Files:** one migration in `supabase/migrations/`, `supabase/migrations.lock`, `supabase/tests/database/journal_entries.test.sql` and the registries other pgTAP files keep, `supabase/functions/flow-mcp/` (the tools, schemas, specs and tests), `docs/mcp/TOOLS.md`, an e2e spec, `packages/shared/src/database.types.ts`, a decision.

- [ ] A system asset account **Accumulated depreciation** in every company, bookable, carried per project on its legs.
- [ ] MCP `create_journal_entry` (owner or editor): `doc_date`, `currency`, `description` (1–120), optional `reference`, and balanced `legs` with no bank leg. It counts in the P&L by project and by the month of `doc_date`, stays out of every cash view, never waits for review, cannot be edited, and undoes (`journal_entry`).
- [ ] MCP `get_account_balances`: each balance-sheet account's balance per project as of a date, and each project's net book value (Property plus Accumulated depreciation).
- [ ] `get_expense` / `get_line_legs` show a journal entry's legs and its reference.

**Later:** the screen (a design task: the "פקודת יומן" entry and its badge in the lists), and a depreciation schedule per property that makes the entries.

**Acceptance:** pgTAP: an entry moves the P&L of its project and month and no cash figure, balances, cannot be edited, and undoes; Deno tests for the tools; an e2e that the profit page shows the entry and the cash lines do not.
