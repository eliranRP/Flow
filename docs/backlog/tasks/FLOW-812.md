<a id="flow-812"></a>
# FLOW-812 · Faster CI
- **Type:** SMALL CYCLE · **Status:** in review (dev lane 1; the 2026-10-07 claim on claude/project-thread-uiob2d was stale: branch gone, its PRs closed) · **Depends on:** —
- **What:** Pull requests have no GitHub CI since #106; main runs the suite before each batch deploy. Run 883 (2026-10-09) took 9.9 minutes from plan to the end of deploy, and the every-story shards (5.6 minutes each, 4 of the 8 story groups per runner) and e2e shard 1 (database checks, then half the Playwright suite) set the pace. Split the every-story smoke into 4 runners and the main Playwright suite into 3; shard 1 keeps the database checks.
- **Acceptance:** Same tests run; the required check names stay `lint`, `check`, `e2e`; main's run (plan to deployed) drops by at least a fifth.
