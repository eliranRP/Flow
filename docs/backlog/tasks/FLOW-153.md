<a id="flow-153"></a>
# FLOW-153 · The ledger is the only write model: cut the legacy split tables and the rollback view
- **Type:** BIG CYCLE (DB + MCP + app) · **Status:** in-progress (#850) · **Depends on:** FLOW-952 · **Source:** owner, 2026-10-28 ("full cut": legs become the only write model).

After FLOW-952 the P&L reads the legs, but every writer still writes the legacy rows (`line_splits`, `loan_splits`, the booking columns on `transactions`) and the legs are compiled from them; `pnl_lines_legacy` and `ledger_pnl_diff` stay as a rollback, and some readers still read the legacy tables. The owner chose to cut it.

- [x] Every writer (database functions, MCP tools, app calls) writes legs; nothing writes `line_splits` or `loan_splits`.
- [x] Every reader reads the legs; nothing reads the legacy tables.
- [x] `line_splits`, `loan_splits`, the posting triggers, `pnl_lines_legacy` and `ledger_pnl_diff` are dropped, with whatever they leave unused.
- [x] Migration gate: the legs before and after are identical for every company, and every P&L read returns the same result.

**Acceptance:** the full pgTAP suite, the flow-mcp Deno tests, the app tests and typecheck; a golden test that every P&L, cash, loan and project read is unchanged across the migration.
