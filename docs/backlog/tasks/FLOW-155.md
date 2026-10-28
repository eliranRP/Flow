<a id="flow-155"></a>
# FLOW-155 · Prepaid amortization schedules (MCP)
- **Type:** BIG CYCLE (MCP + DB) · **Status:** claimed (dev lane 1, 2026-10-28, claude/peaceful-mccarthy-kxcgv2) · **Depends on:** FLOW-152, FLOW-153, FLOW-156 · **Source:** owner, 2026-10-28 (spec "prepaid amortization schedules").
- **Files:** `supabase/migrations/<ts>_prepaid_schedules.sql` (new), `supabase/migrations.lock`, `supabase/tests/database/prepaid_schedules.test.sql` (new), `privilege_guards.test.sql`, `cross_company_sweep.test.sql`, `mcp_undo_company.test.sql`, `supabase/functions/flow-mcp/` (new prepaid tools module, schemas, specs, guide groups, tests), `docs/mcp/TOOLS.md`, a new decision, `packages/shared/src/database.types.ts`.

A cost paid once that covers many months (a yearly insurance premium) is filed to a Prepaid asset account, and Flow posts the monthly journal entry (Prepaid → expense on the project) by itself, with no cash moved.

- [ ] Tables `prepaid_schedules`, `prepaid_rows`, `prepaid_refunds`; the payment line is filed (whole or a part) to a kept-out category bound to the prepaid account (default "Prepaid expenses", created if missing), its previous coding kept.
- [ ] A month posts as a normal journal entry (`private.post_journal_entry`, the core of `create_journal_entry`); planned rows are off the books; the last month takes the rounding.
- [ ] A daily job posts every row due on or before today, idempotently; a schedule started in the past backfills at once.
- [ ] MCP `create_prepaid_schedule`, `list_prepaid_schedules`, `get_prepaid_schedule`, `attach_prepaid_refund`, `update_prepaid_schedule`, `end_prepaid_schedule`, `delete_prepaid_schedule`: idempotency key, owner or editor, logged, undo.

**Acceptance:** the spec's seven tests (in invented names): 262,100 over 12 is 11 × 21,842 and 21,838 with Prepaid at 0 after; a past start backfills with the original dates; a re-run posts nothing; a refund of 139,703 against 158,594 remaining leaves 18,891 spread over the months left; end with expense / keep; undo of create restores the line and removes the entries; cash reads and bank totals never move.
