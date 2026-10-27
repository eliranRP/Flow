<a id="flow-952"></a>
# FLOW-952 · The P&L reads the legs: flip private.pnl_lines to the shadow body
- **Type:** BIG CYCLE · **Status:** claimed (dev lane 1, 2026-10-27, flow-952-pnl-from-legs; production diff read-only on 2026-10-27: 4 companies, 0 rows) · **Source:** Switch plan, step 2 of 3; decision [0209](../../decisions/0209-legs-source-of-truth.md) item 9
- **Files:** `supabase/migrations/<ts>_pnl_from_legs.sql` (new), `supabase/migrations.lock`, `supabase/tests/database/pnl_golden_switch.test.sql` (new), `docs/changelog.d/<date>-flow-952.md` (new), `docs/backlog/tasks/FLOW-952.md`.
- [ ] The migration repeats FLOW-951's gate (any company's diff non-empty aborts), then `create or replace view private.pnl_lines` with the `pnl_lines_ledger` body (same 19 columns, same order, `security_invoker`, granted to `authenticated` and `service_role`), and drops `private.pnl_lines_ledger`. `pnl_lines_legacy`, the posting triggers and the legacy tables stay.
- [ ] `private.ledger_pnl_diff` then compares `pnl_lines_legacy` with `pnl_lines`.
- [ ] Golden test: on a broad fixture, every consumer's `result::text` is the same with the legacy body and the legs body: `company_pnl`, `get_dashboard`, `get_home`, `get_project` (both overloads, both bases), `get_project_group`, `get_profit_months`, `projects_cash_month`, the cash reads, `get_breakdown(_lines)`, `get_loan_split`, `company_next_month_inputs`, the line-state and recurring reads. Audit consumers that aggregate without `ORDER BY`.
- [ ] The invoker consumers (`get_project`, `get_profit_months`, `get_home`, `get_loan_split`) read through RLS on `legs` and `accounts`; a viewer still reads them.
- [ ] Per-project reads: the legs body filters a project through a `case` (the part's or the line's project); EXPLAIN `get_project` and `project_cash_*` on a 5,000-line fixture and keep them no slower than before. FLOW-951 adds no project index on `legs`; add one here (for example on `(company_id, project_id)` for item legs) only if that EXPLAIN needs it.
- [ ] Rollback: one migration puts the legacy body back into `pnl_lines`. Deploy in its own batch with a manual `deploy` run.

**Acceptance:** the gate passes; the full pgTAP suite (not only the files the change names) and the golden test; EXPLAIN ANALYZE before and after in the PR body.
