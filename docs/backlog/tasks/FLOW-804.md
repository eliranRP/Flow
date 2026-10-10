<a id="flow-804"></a>
# FLOW-804 · Performance pass
- **Type:** PLAN FIRST · **Status:** building option A, "split, then gate" (owner's pick 2026-10-09; dev lane 1, [plan](../../qa/flow-804-performance-plan.md)): part 1 code split done (#360), part 2 the gates and the 0.7 s page-open check merged (#410); the project-page open check (a tapped project row on a stubbed backend, #439) done; Home's idle project prefetch stays off (removed in #429 after three parallel get_project reads timed out live; the owner kept the Micro compute on 2026-10-10, so single warm opens meet 0.7 s but parallel reads can still time out). A touch on a project row still reads that one project ahead, once · **Depends on:** —
- **What:** A bundle budget with a CI check (Home route target), Lighthouse CI, real-user timings, and Hebrew mobile flows in Playwright.
- **Acceptance:** Home usable within 2 seconds on a throttled mid-range profile ([0034](../../decisions/0034-cost-and-load-limits.md)).
