<a id="flow-152"></a>
# FLOW-152 · Chart of accounts and the balance sheet from the ledger
- **Type:** BIG CYCLE (MCP + DB) · **Status:** claimed (dev lane 1, 2026-10-28, claude/peaceful-mccarthy-kxcgv2) · **Depends on:** FLOW-952, FLOW-953, FLOW-151 · **Source:** owner, 2026-10-28 (spec "manage balance-sheet accounts from the Flow MCP", reviewed in session).
- **Files:** `supabase/migrations/<ts>_ledger_only.sql` (new), `supabase/migrations.lock`, `supabase/functions/flow-mcp/` (ledger tools, specs, schemas, tests), `docs/mcp/TOOLS.md`, `supabase/tests/database/` (new chart-of-accounts and balance-sheet tests), `packages/shared/src/database.types.ts`, a new decision.

The ledger is the books, but the chart of accounts is fixed: 12 system accounts, nothing can be created, renamed, archived or merged. A kept-out category with no fitting account sits on Suspense.

- [ ] `accounts` gets `is_system`, `archived_at`, `description`, and an `equity` type; Owner capital becomes equity.
- [ ] MCP `create_account`, `update_account`, `archive_account`, `restore_account`, `merge_account`: owner or editor, idempotency key, undo. The 12 system accounts are locked (no rename, archive or merge away).
- [ ] `list_accounts` returns type, system flag, archived, description, balance per currency and linked categories (`include_archived`).
- [ ] `create_journal_entry` takes balance-sheet-only entries (no P&L leg needed) on any open account.
- [ ] MCP `get_balance_sheet` as of a date, per project and currency: assets, liabilities, equity and retained earnings (the running P&L), with the check assets = liabilities + equity + retained earnings and Suspense as a warning.

**Acceptance:** pgTAP for every write, refusal and undo; the first use case (a deposits account, the deposits category bound to it, Suspense 0, no P&L figure moves); the balance check holds on the broad fixture.
