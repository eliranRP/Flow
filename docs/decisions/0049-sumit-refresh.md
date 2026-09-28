# SUMIT refresh is a button, with an optional daily marker

**Date:** 2026-09-28
**Status:** Accepted

## Context

The Free plan should stay at $0. A network call from Postgres to the Edge Function (`pg_net`) is an extra moving part, and SUMIT bills the customer's own quota per call.

## Decision

The owner taps רענון עכשיו. That calls `sumit-sync` with the user JWT and `force: true`. A forced sync is refused if the previous one was under 60 seconds ago. A non-forced sync is refused inside 6 hours.

If `pg_cron` is installed, the migration schedules `flow-sumit-daily` at 03:00 UTC. The job only inserts a row in `sumit_refresh_requests`. It does not call the network. Draining those rows is a POST to `sumit-sync` with header `x-flow-cron` equal to the secret `CRON_SECRET`. If `pg_cron` is missing, the migration still applies.

The allowlist is two read paths: `crm/data/listfolders` and `crm/data/listentities`. Anything else throws before the request. Nothing in this slice creates or edits a SUMIT document.

## Alternatives rejected

Polling from the browser on every Home open. Calling `getdetails` per document. Waking the function with `pg_net` from the migration.

## Consequences

Data moves when someone taps refresh, or when a scheduled call presents `CRON_SECRET`. One CRM page is 1,000 documents, and the client follows `HasNextPage`, so Flow Test is one or two calls plus the folder lookup.
