# Health check

A daily GitHub run (`health`, 06:00 UTC, also by hand from the Actions tab on main) reads production with `private.health()` in a read-only transaction and fails when something is wrong ([0151](../decisions/0151-health-check.md)). GitHub emails a failed scheduled run to the user who last changed its schedule line, when that user's Actions notifications are on. The log lists each alert with a count only. A warning is listed but does not fail the run. GitHub turns off schedules in a public repo after 60 days with no activity; re-enable the workflow from the Actions tab if that happens.

To run it yourself against any database: `SUPABASE_DB_URL=... bash scripts/health-check.sh` (exit 0 healthy, 2 an alert, 1 the check did not finish).

## Alerts

| Alert | Means | First step |
| --- | --- | --- |
| `refresh_unclaimed` | A daily refresh request has waited more than 2 hours. The drain cron job is not running or not reaching the sync function. | Check `cron_failed` and `cron_late`; check the Vault `cron_secret` and `flow_sync_url` (`scripts/check-sumit-cron.sh`). |
| `refresh_claimed` | A connection's sync claim is more than an hour old: the sync function died mid-run. The next drain takes it again after 15 minutes. | Read the edge function logs for `mercury-sync` or `sumit-sync` at that time. |
| `sync_stale` | A connection has had no sync in 36 hours (a key waiting to be replaced counts under `sync_error` instead). | Look at the connection's `last_error` and `next_attempt_at`. |
| `sync_error` | A connection's last sync failed, or the provider rejected it 3 times. A `sync_sweep_*` note does not count. | `auth` means the owner must reconnect in Settings → חיבורים; anything else, read the function logs. |
| `mcp_sync_stuck` | An MCP `sync_bank` job started in the last day has run more than 30 minutes. | Read the `mercury-sync` and `flow-mcp` logs. The row stays `running`; reads report it failed after 5 minutes, and it is deleted when the same user starts a new `sync_bank` a day later. |
| `cron_failed` | A `flow-*` cron run failed in the last day. One red day can be a passing hiccup (for example a job start timeout during maintenance). | `select * from cron.job_run_details where status = 'failed' order by start_time desc limit 5;` |
| `cron_late` | A `flow-*` cron job has not run on schedule. | Check `cron.job` (active) and the pg_cron worker in the Supabase dashboard. |
| `jev_cap` (warning) | A company used 80% or more of its daily Jev calls. | Expected on a big import day. If it repeats, raise `daily_call_cap` or look for a loop. |
| `db_size` | The database is at 80% or more of the free plan's 500 MB (the count is the size in MB). | Plan the move below. |

## Free plan limits and moving to a paid plan

The free plan holds a 500 MB database and 1 GB of file storage, pauses a project after a week with no requests, and keeps no backups you can restore. Move when `db_size` alerts, when storage nears 1 GB, or before real customers depend on the app.

1. In the Supabase dashboard, open the organization's billing and choose the Pro plan. The project keeps its URL, keys and data; nothing is migrated.
2. Keep the spend cap on (the default), so usage above the plan's quota stops instead of billing.
3. Check daily backups are listed under Database → Backups.
4. Update the `db_limit_bytes` constant in `private.health()` with a one-line migration, so `db_size` alerts against the new limit.
