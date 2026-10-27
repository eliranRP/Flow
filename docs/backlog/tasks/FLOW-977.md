<a id="flow-977"></a>
# FLOW-977 · Flow QA holds at least twice the data of the largest real company, topped up daily
- **Type:** SMALL CYCLE (infra, perf) · **Status:** claimed (perf steward, 2026-10-27, claude/flow-977-qa-seed) · **Source:** the owner on 2026-10-27: the QA account must hold at least as much data as the real company, and more, so the daily load timings measure a full payload.
- **Files:** `supabase/qa/seed-flow-qa.sql` (new, not a migration, never run on deploy), `supabase/qa/README.md`, `docs/runbooks/qa-user.md` (a line pointing at the generator), a changelog fragment.

- [ ] One SQL generator, run by hand through the owner's Supabase connector, that tops Flow QA up to 2× the real company's row count (counts only) in every company-scoped table a screen reads.
- [ ] It follows the runbook's seed guards: it first checks the target is the company named `Flow QA` with `is_demo` false, and every insert names that company id. It never reads another company's rows, only counts them.
- [ ] Synthetic rows are marked (`source` manual, idempotency key `qa-seed:`, deterministic ids), so no sync touches them and they can be listed and removed.
- [ ] Idempotent: a second run with unchanged counts adds nothing; a run after the real company grows adds only the shortfall.
- [ ] Every insert goes through the existing constraints and triggers: the ledger stays balanced, allocation shares sum to 100%, loan splits match their lines.
- **Acceptance:** run twice on a local database built from the migrations (second run adds 0 rows); run on production; counts ≥ 2×, Flow QA's dashboard P&L adds up, the real company's counts unchanged before and after.
