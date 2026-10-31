<a id="flow-998"></a>
# FLOW-998 · The recurring reads pick each charge's category in one grouped pass
- **Type:** SMALL CYCLE (perf) · **Status:** ready · **Source:** the perf steward's daily measurement on 2026-10-31 ([report](../../qa/perf/2026-10-31.md)), decision [0230](../../decisions/0230-screens-data-in-half-a-second.md); left for later in FLOW-985.
- **Files:** a new migration replacing `private.recurring_parties`, `supabase/migrations.lock`, a pgTAP test, a changelog fragment.

`private.recurring_parties` takes 79 ms in production (Flow QA) and feeds `recurring_schedule`, `expected_months`, `recurring_changes` and `company_next_month_inputs` (279 ms, the slowest screen read). It picks each charge's category with a subquery per charge, about a quarter of its time locally.

- [ ] First, a pgTAP test pins which category a charge gets when two categories tie (same count of lines), on today's code.
- [ ] Then the pick becomes one grouped pass over the charges' lines, with the same tie order.
- [ ] Same answers: the outputs of `recurring_parties`, `recurring_schedule`, `recurring_changes`, `expected_months` and `company_next_month_inputs`, for every company on a local database and several days, are byte for byte the same before and after.
- **Acceptance:** the recurring pgTAP files pass; local medians before and after in the PR; production after the deploy in the next report.
