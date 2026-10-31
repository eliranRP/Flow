<a id="flow-985"></a>
# FLOW-985 · The recurring reads' first step reads split lines without a nested loop over every line
- **Type:** SMALL CYCLE (perf) · **Status:** done (#857) · **Source:** the perf steward's daily measurement on 2026-10-29 ([report](../../qa/perf/2026-10-29.md)), decision [0230](../../decisions/0230-screens-data-in-half-a-second.md).
- **Files:** `supabase/migrations/20261029185829_recurring_parts_one_join.sql`, `supabase/migrations.lock`, `docs/qa/perf/2026-10-29.md`, a changelog fragment.

- [x] `private.recurring_line_parts` carries each split line's own columns from its split step, so its parts step no longer joins the split lines back to all the company's lines (a nested loop under the function's generic plan).
- [x] Same answers: on a local database with three companies, 84 outputs (`recurring_line_parts`, `recurring_stream_lines`, `recurring_parties`, `recurring_schedule`, `recurring_changes`, `expected_months`, `company_next_month_inputs`, four days each) are byte for byte the same before and after.
- **Acceptance:** the 17 pgTAP files of the recurring reads pass; local medians before and after in the PR; production after the deploy in the next report.
- **Production (2026-10-31 report):** deployed with build `8adba04`; database time `recurring_schedule` 137 → 116 ms, `expected_months` 94 → 80 (both −15%), `company_next_month_inputs` 301 → 279 (−7%).
- **Left for later (FLOW-998):** `recurring_parties` picks each charge's category with a subquery per charge (about 9 of its 33 ms locally). A grouped pick is faster, but its tie order must be pinned first, or a tie could pick another category.
