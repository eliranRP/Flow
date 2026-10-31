<a id="flow-998"></a>
# FLOW-998 · The recurring reads pick each charge's category in one grouped pass
- **Type:** SMALL CYCLE (perf) · **Status:** in-progress · **Source:** the perf steward's daily measurement on 2026-10-31 ([report](../../qa/perf/2026-10-31.md)), decision [0230](../../decisions/0230-screens-data-in-half-a-second.md); left for later in FLOW-985.
- **Files:** `supabase/migrations/20261029190013_recurring_category_one_pass.sql`, `supabase/migrations.lock`, `supabase/tests/database/recurring_charge_category.test.sql`, a changelog fragment.

`private.recurring_parties` takes 79 ms in production (Flow QA) and feeds `recurring_schedule`, `expected_months`, `recurring_changes` and `company_next_month_inputs` (279 ms, the slowest screen read). It picks each charge's category with a subquery per charge, about a quarter of its time locally.

- [x] First, a pgTAP test pins which category a charge gets when two categories tie (same count of lines), on today's code: the latest line's category. It passed on today's code before the change.
- [x] Then the pick becomes one grouped pass over the charges' lines, with the same tie order. A full tie (same count and same latest date), arbitrary before, takes the lowest category id.
- [x] Same answers: the outputs of `recurring_parties`, `recurring_schedule`, `recurring_changes`, `expected_months` and `company_next_month_inputs`, for every company on a local database and several days, are byte for byte the same before and after.
- **Acceptance:** the recurring pgTAP files pass; local medians before and after in the PR; production after the deploy in the next report.
