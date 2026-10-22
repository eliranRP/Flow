# The legs become the P&L's source of truth: posting rules, a shadow view, then the flip

**Date:** 2026-10-22
**Status:** Accepted (FLOW-951 lands step 1; FLOW-952 and FLOW-953 follow. Builds on [0208](0208-balanced-legs-ledger.md))

## Context

[0208](0208-balanced-legs-ledger.md) added a balanced legs ledger beside the P&L and proved, per line, category and project, that the legs project back to `private.pnl_lines`. The legs still could not replace `pnl_lines`:

- **Lost columns.** A kept-out row went to a system account (Loan principal, Escrow, Suspense). The leg lost the row's category, loan-split part, gross-up flag, loan-split fallback and whether the part named its own project. `cash_parts`, the excluded totals of `company_pnl` and `breakdown_rows` read those.
- **Aggregated reconciliation.** `legs_pnl_projection` grouped by line, category and project. A replacement for `pnl_lines` has to match it row for row on all 19 columns.
- **Every edit re-posted.** The transactions update trigger re-derived the legs of every updated line, one at a time. A sync that only touched descriptions re-posted the whole batch, and an insert of N lines ran N postings.
- **A cycle.** The legs were derived from `pnl_lines`, so `pnl_lines` could not simply be pointed at the legs.

## Decision

1. **Three steps, each one migration.**
   - FLOW-951: posting rules and a shadow view. The live P&L does not change.
   - FLOW-952: the flip. `private.pnl_lines` becomes the shadow body.
   - FLOW-953: balance-sheet accounts through `book_line`.

2. **The posting rules.** `private.pnl_lines_legacy` is today's `pnl_lines` body, plus one trailing column, `project_explicit`: the split part named its own project. It is `service_role` only and is read only on the write path. `private.pnl_lines` keeps its own identical body until FLOW-952. A security-invoker view over a service-role view would refuse `authenticated` readers, so `pnl_lines` cannot simply select from it.

3. **One item leg per posting row, with what the row needs.** New columns on `public.legs`:
   - `leg_kind`: `bank`, `vat` or `item`.
   - `category_id`: the category the person sees. It is kept on a kept-out leg too. It is a composite FK to `categories`, deferrable and initially deferred, so `delete_category` and `merge_category` move the lines first and the check runs at commit.
   - `part`, `gross_up`, `loan_split_fallback` and `project_explicit`.

   A leg inserted without a kind takes it from its account. There is no aggregation, so the multiset of rows matches by construction.

4. **Kept-out routing in one place.** `private.kept_out_account(company, category, loan_part)` routes a kept-out row by loan part: principal to Loan principal, escrow to Escrow, anything else to Suspense. FLOW-953 widens it with a category's own ledger account.

5. **Set-based posting.** `private.rebuild_legs_many(company, uuid[])` makes one delete and one insert for many lines. `rebuild_legs` calls it for one line. The ordinal rule is 0208's, so `book_line`'s undo fingerprint of an existing line does not move.

6. **Post only what changed.** Statement triggers stay immediate: a deferred posting would leave `pnl_lines` stale inside the same transaction, which breaks `book_line`'s self-check.
   - **Transactions update.** Old and new transition tables. A line is re-posted only when a posting column changed: `amount_net`, `amount_gross`, `vat_amount`, `direction`, `category_id`, `category_suggested`, `project_id`, `in_pnl_override`, `line_status`, `removed_at`.
   - **Inserts and split tables.** An insert, and a change to `line_splits` or `loan_splits`, posts once per company per statement.
   - **Categories.** 0208's categories trigger (item 9) posts all of a category's lines in one call.
   - **Allocations.** The allocation triggers are dropped: allocations decide only `unassigned`, which the shadow view reads at view time.
   - **Deletes.** The transactions delete trigger is dropped: the legs' FK already cascades.

7. **The shadow view.** `private.pnl_lines_ledger` has `pnl_lines`' 19 columns, in the same order, from the item legs. It is `service_role` only until FLOW-952.
   - `amount_net` is `-amount_minor`.
   - `in_pnl` is true when the leg's account is income or expense.
   - `kind` is the category's kind, else the line's direction.
   - `project_id` is the part's own project when `project_explicit`, else the line's.
   - `pnl_role` and `unassigned` fold `pnl_lines`' three branches into one expression each.
   - Read at view time, so a header edit can never leave it stale: the transactions header (direction, document kind, dates, currency, line net, `pnl_role`, unpaid), the category kind, the company's overhead project and the allocations.

8. **The diff and the gate.** `private.ledger_pnl_diff(company)` is a definer, `service_role` only. It returns `pnl_lines_legacy EXCEPT ALL pnl_lines_ledger` in both directions, over all 19 columns, kept-out rows included. The FLOW-951 migration re-posts every posted line, then raises if any company's diff is non-empty, so a mismatch applies nothing. FLOW-952 repeats the gate before it swaps the view. The diff is run read-only on production after FLOW-951 deploys.

9. **The flip and its rollback (FLOW-952).** `create or replace view private.pnl_lines` takes the shadow body, and `pnl_lines_ledger` is dropped. `pnl_lines_legacy` and the legacy tables stay maintained. Reverting is one migration that puts the legacy body back into `pnl_lines`, and no data is lost. The flip deploys in its own batch.

## Alternatives rejected

- **Point `pnl_lines` at the legs now.** The flip would happen before the shadow is proven on real books. A gated shadow step costs one migration and removes that risk.
- **Keep `pnl_lines` and derive the legacy rows from the legs.** About 60 writers would have to write legs, the triggers would run the other way, and the legacy model cannot express everything the legs can. It is the riskiest rewrite of the write path.
- **Legs authoritative only for MCP bookings.** It keeps two sources of the P&L. It stays a later stage, for ledger-only shapes.
- **Allocations as legs.** The shared split's `div_half_even` rounding would move from read time to write time. Allocations stay in `public.allocations` and are read at view time.
- **A deferred posting step.** It would make `pnl_lines` stale inside the writing transaction and break every RPC that writes and then reads.

## Consequences

- No P&L figure moves in FLOW-951, and every existing pgTAP passes unchanged. The mutation matrix in `legs_reconciliation` shows the diff is empty after every legacy writer: category keep-out and back, overrides, loan split flagged, stale and with VAT, a split invalidated by an amount change, `save_line_split`, `delete_category`, `merge_category`, a deleted project, the overhead project, allocation edits, a transfer confirmed and undone, Jev's fill and its undo, reassigning, a guessed category, pending and removed lines, and a category kind change.
- Writes get faster. A header-only bulk update re-posts nothing, and a bulk insert posts once per statement instead of once per line.
- The live reads are unchanged, since `pnl_lines` is unchanged.
- Some readers still read the legacy tables directly: `get_project`, `get_profit_months`, `projects_cash_month`, `overhead_shares`, `project_category_entries_by_currency`, `recurring_line_parts`, `line_pnl_state(s)`, `company_next_month_inputs` and `get_loan_split`. They stay correct while the legacy rows exist. Moving them to the legs is later work.
