<a id="flow-953"></a>
# FLOW-953 · Balance-sheet accounts through book_line (transfers in transit, loan principal, escrow, owner capital, deposits)
- **Type:** BIG CYCLE · **Status:** ready (start after FLOW-951 merges; may run beside FLOW-952: the files overlap only in the lock, the decisions index and TASKS.md) · **Source:** Switch plan, step 3 of 3; decision [0209](../../decisions/0209-legs-source-of-truth.md); a new decision 0210
- **Files:** `supabase/migrations/<ts>_ledger_balance_accounts.sql` (new), `supabase/migrations.lock`, `supabase/functions/flow-mcp/tools_ledger_schemas.ts`, `tools_book_line_test.ts`, `docs/mcp/TOOLS.md`, `supabase/tests/database/mcp_book_line.test.sql`, `supabase/tests/database/ledger_balance_accounts.test.sql` (new), `docs/decisions/0210-balance-sheet-accounts.md` (new), `docs/decisions/README.md`, `docs/changelog.d/<date>-flow-953.md` (new), `docs/backlog/tasks/FLOW-953.md`.
- [ ] `categories.ledger_account_id`, and `private.kept_out_account` reads it first (then the loan part, then Suspense).
- [ ] A "Transfers in transit" asset system account; hidden kept-out categories bound to Owner capital and Security deposit held.
- [ ] `mcp_book_line` accepts asset and liability legs and mirrors them as kept-out category parts; its self-check also compares the accounts. VAT, more than one bank leg and mixed currencies are refused; the new reasons join `mcp_refused`.
- [ ] Each shape is balanced legs on the right account type, with `pnl_lines` showing an excluded row under the bound category: a transfer pair (bank to Transfers in transit on both lines, netting to 0), loan principal to the liability, escrow to the asset, owner capital and draws, a security deposit held. No P&L figure moves.
- [ ] `cross_company_sweep` and `privilege_guards` keep covering `mcp_book_line`.

**Acceptance:** the full pgTAP suite; the flow-mcp Deno tests; `pnpm typecheck`; `pnpm db:types:check`.
