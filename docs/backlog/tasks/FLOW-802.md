<a id="flow-802"></a>
# FLOW-802 · Health check and usage monitoring
- **Type:** PLAN FIRST · **Status:** on-hold (owner chose "Not now", 2026-10-08; built in #237 and reverted; migration 20261012020000 drops `private.health()` again, since merged migrations stay; the plan is the project's plans/flow-802-health-check.md, and the code can come back by reverting the revert) · **Depends on:** —
- **What:** A `health()` RPC and a daily health-check workflow (stuck queues, cron runs, last sync), usage alerts against the free-tier limits, and a move-to-paid-plan runbook.
- **Acceptance:** an alert on a simulated stuck queue.
