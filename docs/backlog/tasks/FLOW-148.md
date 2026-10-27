<a id="flow-148"></a>
# FLOW-148 · A category for each part of one loan payment, and a dated category switch on the loan
- **Type:** MCP + DB · **Status:** claimed (dev lane 1, 2026-10-27, flow-148-loan-part-category) · **Depends on:** — · **Related:** [FLOW-106](FLOW-106.md), [FLOW-134](FLOW-134.md) · **Source:** the MCP/data agent, 2026-10-27: a rehab loan's interest goes to a kept-out holding-costs category while the rehab runs, and to the P&L once it ends. The only way to file the later payments in the P&L was to detach them from the loan, which drops them from its history and paid interest.
- **Files:** one migration in `supabase/migrations/`, `supabase/migrations.lock`, `supabase/tests/database/loan_part_category_override.test.sql`, `supabase/functions/flow-mcp/tools_loans.ts`, `tools_specs.ts`, `tools_schemas.ts`, `tools_write.ts`, their tests, `docs/mcp/TOOLS.md`, `docs/mcp/KEYS.md`, `app/src/screens/loan-split-draft.ts` and its test, an e2e spec, `packages/shared/src/database.types.ts`, a decision.

Today a loan part's category comes from the loan (or the built-in default) when the payment is attached, and the MCP tools cannot change it on one payment. `loan_splits.category_id` is already stored per part, and the app's `save_loan_split` already takes a category on each part; only the MCP tools and the app's split draft send the fees one alone.

- [ ] `attach_loan_payment` takes `interest_category_id`, `escrow_category_id` and `principal_category_id` beside `fees_category_id`, each checked like fees (`category does not fit the loan part`).
- [ ] New `set_loan_part_category`: one part's category on one or more attached payments, the payments staying attached. Undo kind `loan_part_category`.
- [ ] New `set_loan_category_from`: from a date on, a part of the loan's payments goes to a category (a dated switch on the loan, like `set_loan_rate`). Payments attached later take the category in force on their own date; `apply_to_existing` also moves the payments already attached from that date until the next switch. Undo kind `loan_category_from`.
- [ ] The app's split editor keeps each part's category when a split is saved again, so an edit does not move an overridden part back to the loan's category.
- [ ] A loan-split refusal says why instead of `The write was refused.`

**Acceptance:** pgTAP for the three writes, their undo and the P&L side of an overridden part; Deno tests for the tool arguments; a unit test that the split draft keeps the part categories; an e2e that an attached payment's interest moves into the P&L and stays on the loan.
