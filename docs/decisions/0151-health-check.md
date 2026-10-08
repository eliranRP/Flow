# Daily health check

**Date:** 2026-10-08
**Status:** Accepted.

## Context

Flow runs on its own: a pg_cron job asks for a daily refresh of each bank and SUMIT connection, a drain picks the requests up, Jev tags new lines after a sync, and the MCP runs `sync_bank` jobs. When one of these stops, nothing says so; the owner only sees numbers that stop moving. FLOW-802 asks for a health check, usage alerts against the free-plan limits and a runbook.

## Decision

1. **`private.health(now)`**, for the service role only, returns `{ ok, checked_at, alerts[] }`. Each alert is `{ check, count, detail }`:
   - `refresh_unclaimed`: a refresh request waiting more than 2 hours for the drain (not one whose connection waits on a new key or a retry time);
   - `refresh_claimed`: one claimed more than 1 hour ago and still open;
   - `sync_stale`: a connection with no sync in 36 hours;
   - `sync_error`: a connection whose last sync failed, or rejected 3 times or more;
   - `mcp_sync_stuck`: an MCP `sync_bank` job running more than 30 minutes;
   - `cron_failed`: a failed run of a `flow-*` cron job in the last 24 hours;
   - `cron_late`: a `flow-*` job whose last run is more than 26 hours old (30 minutes for a job that runs every few minutes);
   - `jev_cap`: a company at 80% or more of its daily Jev call cap;
   - `db_size`: the database at 80% or more of the free plan's 500 MB.

   It reads only and changes nothing. The thresholds are constants in the function, so changing one is a one-line migration.
2. **Counts only.** No company names, ids or amounts go in an alert, because the repo and its workflow logs are public.
3. **A daily GitHub run.** `.github/workflows/health.yml` runs `scripts/health-check.sh` at 06:00 UTC, and by hand, with the existing `SUPABASE_DB_URL` secret, in a read-only transaction. A run with an alert fails, and GitHub emails the repo owner. No new service or secret.
4. **Runbook.** `docs/runbooks/health-check.md` says what each alert means, what to do, and when and how to move off the free plan.

## Consequences

- A stuck sync shows up within a day without the owner looking.
- The Production QA thread can call `private.health()` in its hourly deploy check.
- An owner banner in the app (option B in the plan) can read the same function later.
