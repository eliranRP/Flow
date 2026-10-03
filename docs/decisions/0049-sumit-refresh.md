# SUMIT refresh is a button, with an optional daily marker

**Date:** 2026-09-28
**Status:** Accepted. [0064](0064-review-round4.md) schedules the drain with `pg_net` when that extension is installed. The daily marker in this record stays.

## Context

The Free plan should stay at $0. A network call from Postgres to the Edge Function (`pg_net`) is an extra moving part, and SUMIT bills the customer's own quota per call.

## Decision

The owner taps רענון עכשיו. That calls `sumit-sync` with the user JWT and `force: true`. A forced sync is refused if the previous one was under 60 seconds ago. A non-forced sync is refused inside 6 hours.

If `pg_cron` is installed, the migration schedules `flow-sumit-daily` at 03:00 UTC. The job only inserts a row in `sumit_refresh_requests`. It does not call the network. Draining those rows is a POST to `sumit-sync` with header `x-flow-cron` equal to the secret `CRON_SECRET`. `20261003140000_sumit_daily_schedule.sql` fails if `pg_cron` is missing. The phase 1 migration is unchanged and still skips that schedule.

The allowlist is two read paths: `crm/data/listfolders` and `crm/data/listentities`. Anything else throws before the request. Nothing in this slice creates or edits a SUMIT document.

## Alternatives rejected

Polling from the browser on every Home open. Calling `getdetails` per document. Waking the function with `pg_net` from the migration.

## Consequences

Data moves when someone taps refresh, or when a scheduled call presents `CRON_SECRET`. One CRM page is 1,000 documents, and the client follows `HasNextPage`, so Flow Test is one or two calls plus the folder lookup.
