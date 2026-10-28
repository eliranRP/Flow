# Every screen shows its data within 0.5 seconds

**Date:** 2026-10-28
**Status:** Accepted

## Context

[0034](0034-cost-and-load-limits.md) set two limits for the proof of concept: a running cost of at most $5 a month, and Home usable within 2 seconds on a mid-range phone on 4G. The owner has raised the bar for speed: every screen, not only Home, should show its data in under half a second. A daily perf steward measures it and fixes what misses.

## Decision

Every screen shows its data within 0.5 seconds. This supersedes 0034's load limit; its $5 cost cap stays.

What is measured, each day, on the Flow QA sandbox company (at least twice the size of the largest real company, [supabase/qa/README.md](../../supabase/qa/README.md)), signed in as its owner:

1. **Data round trip.** Each screen's main read (`get_home`, `get_dashboard`, `list_review`, `get_project`, and the others the screens call; `pnpm latency` lists them), 10 calls each, p50 and p90, from the measuring machine to production. Loans read their tables directly rather than through one read, so the Loans screen is measured by its screen-ready time only. The database time of each read (`EXPLAIN ANALYZE`) is reported beside it, because the network from the measuring machine is part of the round trip.
2. **Screen ready.** On the FLOW-804 phone (CPU slowed 4×, 4G), the time from an in-app tap to the screen's data on screen: no skeleton or busy marker, and the page has stopped changing. The first visit in a session and a repeat visit are both reported.
3. **Cold Home.** `node scripts/load-report.mjs --speed 7`, Home ready on the stub build including the 4G network, reported against the goal.

The gate is the screen-ready time and the data round trip. A daily report goes to `docs/qa/perf/YYYY-MM-DD.md`.

## Alternatives rejected

Home only, as in 0034: the owner reads every screen, and the slow ones were not Home. Timing only the database: users wait for the whole round trip. A looser or per-screen allowance: the target is the same for every screen.

## Consequences

A change that makes a screen slower than 0.5 seconds, or more than 10% slower than the last report, is a regression for the perf steward to fix. Speed work never changes what a screen shows; a fix that would is a task for the owner. The cost cap still applies to anything speed work adds.
