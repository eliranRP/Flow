<a id="flow-983"></a>
# FLOW-983 · Company profit: the next-month read takes every project's category months in one pass
- **Type:** SMALL CYCLE (perf) · **Status:** claimed (perf steward, 2026-10-28, perf/daily-2026-10-28) · **Depends on:** [FLOW-943](FLOW-943.md) (named this read as the slowest on the page, left for later) · **Source:** the perf steward's daily measurement on 2026-10-28 ([report](../../qa/perf/2026-10-28.md)), decision [0230](../../decisions/0230-screens-data-in-half-a-second.md).
- **Files:** `supabase/migrations/20261028012315_project_months_one_pass.sql`, `supabase/migrations.lock`, `supabase/tests/database/project_months_one_pass.test.sql`, `scripts/latency.ts`, `docs/decisions/0230-screens-data-in-half-a-second.md`, `docs/decisions/0034-cost-and-load-limits.md`, `docs/decisions/README.md`, `docs/qa/perf/2026-10-28.md`, a changelog fragment.

- [ ] `company_next_month_inputs` reads every active project's category months in one call of `private.project_category_months_many`, not one `project_category_months` call per project.
- [ ] `project_category_months` reads its categories from the same function, so the rule lives in one place; its checks, envelope and parents are unchanged.
- [ ] Same answers: on a local database with three companies, the 600 outputs of both reads (every company and project, four days, 3/6/12 months) are byte for byte the same before and after.
- [ ] Decision 0230 records the 0.5-second target and how it is measured; `pnpm latency` times every screen's read.
- **Acceptance:** pgTAP `project_months_one_pass.test.sql` and the existing tests of both reads pass; production round trip and database time of `company_next_month_inputs` before and after in the PR.
