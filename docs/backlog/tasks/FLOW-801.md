<a id="flow-801"></a>
# FLOW-801 · Backups and restore tests
- **Type:** PLAN FIRST · **Status:** on-hold (the owner chose "Not now" on the plan, 2026-10-08; plan: nightly age-encrypted pg_dump to R2 with a weekly restore test) · **Depends on:** —
- **What:** From the original plan: a nightly encrypted dump to off-site storage with failure alerts, a weekly storage sync, a monthly restore test (row counts and P&L checksums), and a quarterly drill runbook.
- **Acceptance:** plan approved (storage, keys, cost); seven nightly dumps; an alert fires on a forced failure.
