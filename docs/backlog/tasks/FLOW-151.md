<a id="flow-151"></a>
# FLOW-151 · Journal entry income legs and Suspense, and re-attaching a detached loan payment
- **Type:** BUG (MCP + DB) · **Status:** in-progress (#849) · **Depends on:** FLOW-148, FLOW-149 · **Source:** the MCP/data agent, 2026-10-28, after #843–#846.
- **Files:** `supabase/migrations/20261028090000_journal_income_and_loan_reattach.sql`, `supabase/migrations.lock`, `supabase/tests/database/journal_income_and_loan_reattach.test.sql`, `privilege_guards.test.sql`, `cross_company_sweep.test.sql`, `mcp_undo_company.test.sql`, `supabase/functions/flow-mcp/` (`tools_ledger_schemas.ts`, `tools_ledger_specs.ts`, `tools_schemas.ts`, `tools_specs.ts`, `tools_write.ts`, `tools_ledger_test.ts`, `tools_writes_test.ts`, `handler_auth_test.ts`, `handler_tools_test.ts`), `docs/mcp/TOOLS.md`, `packages/shared/src/database.types.ts`, decision [0231](../../decisions/0231-journal-income-category-account.md) (amends 0228 and 0210).

**Bug A, `create_journal_entry` with an income leg.** An entry of Dr a kept-out deposits category / Cr rental income returned ok, but:
1. the income it booked counted in no P&L read on either basis. Every income reader counts an income line only by its document kind (receipt on the cash basis; invoice, credit or invoice_receipt on the invoiced basis), and an entry's line was written with kind `other`. An expense entry counted because expense lines count whatever their kind.
2. the deposits leg landed on Suspense: the category had no balance-sheet binding (0210 binds by English name only), so it fell through to Suspense, silently.

**Bug B, `attach_loan_payment` after `detach_loan_payment`.** Re-attaching a detached payment returned a bare `The write was refused.`: the first attach's `loan_split` write stayed open, and `mcp_writes_loan_split_open_idx` (one open `loan_split` write per user and line) refused the second; the unique violation is not a worded reason.

- [x] An entry's line is `invoice_receipt` when it is income (it counts on both bases, out of the cash view as before), `other` when it is an expense, as today.
- [x] A leg on a kept-out category that would land on Suspense is refused with a worded reason; legs on a bound category or a balance-sheet system account work as before.
- [x] MCP `set_category_account` binds a kept-out category to a balance-sheet account (or unbinds it); its lines' legs move, no P&L figure moves; undo kind `category_account`.
- [x] `attach_loan_payment` supersedes the stale open `loan_split` write of a detached line, so the re-attach goes through and undoes.

**Acceptance:** pgTAP: an income entry counts in `company_pnl` and `get_project` on both bases and in its month, stays out of the cash view, and undo takes it back; an expense entry is unchanged; a deposits leg on an unbound kept-out category is refused, and after `set_category_account` the same entry lands on the bound account and `get_account_balances` shows it; binding moves legs and no P&L figure, and undoes; attach, detach, re-attach with exact parts and a category goes through and undoes, and the loan's paid figures include it.
