# Jev labels new lines after each sync, within a daily call cap

**Date:** 2026-10-08
**Status:** Accepted

## Context

FLOW-701 part 1. The owner chose (2026-10-08) that Jev should suggest tags for new bank lines after each bank sync, so lines arrive in לאישור already labelled, with a daily call cap per company set in SQL because the provider has no spend cap. Until now `jev-tag` ran only by hand ([0084](0084-jev-auto-prefill.md)), its only limit was one run per isolate per 60 seconds, and its token counts went to the function log only. A line Jev failed on was sent again on every run.

## Decision

A `pg_cron` job, `flow-jev-tag`, runs every 5 minutes. It posts to `jev-tag` (the `flow_sync_url` Vault value with `/sumit-sync` replaced by `/jev-tag`, and the `cron_secret` header) only when `private.jev_has_work()` is true: some company has Jev enabled in `shadow` or `auto`, calls left today, and an open לאישור expense with no suggestion for the pinned model that is not waiting to retry. Both SUMIT and Mercury syncs add lines to the same queue, so a new line is labelled within about 5 minutes of the sync that brought it, and an idle 5 minutes costs one SQL check and no request. Missing `pg_cron`, `pg_net`, `cron_secret` or `flow_sync_url` skips the schedule with a notice.

`company_integrations.daily_call_cap` (default 200, from 0 to 2000) is the most Jev calls a company may make per UTC day. A call is one line sent, with its retries. Before calling Jev, each run reserves calls for each company with `jev_reserve_calls(company, run, want)`, which locks the company's integration row and grants at most what is left of the cap. A run keeps only the granted lines, newest first; the rest are `cap_skipped` and wait for the next day. A disabled company, `mode` `off`, and no integration row get 0. A run reserves once per company; a second reserve for the same run is `conflict`.

`jev_usage` is the usage log: one row per company per run with `reserved`, `calls`, `input_tokens`, `output_tokens`, `tagged`, `failed`, `started_at` and `finished_at`. It holds no line text, amounts or answers. `jev_finish_usage` records what the run used, at most its reservation, once. A run that never finishes keeps its full reservation counted for that day, which is the safe side. Members of the company read their rows; writes are the service role.

One run at a time: `jev_take_lease(run, seconds)` takes a single database lease (180 seconds from the function, longer than the 150 second Edge limit, so a killed run frees it on its own) and `jev_release_lease(run)` frees it. A run that finds the lease taken returns 409 `busy` and does not call Jev. The in-memory 60 second limit stays.

A line Jev failed on (a timeout, a 5xx, or a bad answer that stored nothing) is written to `jev_line_failures` and is not sent again for 6 hours, or 24 hours from its third failure. A missing key or a rejected key still stops the run without marking lines.

MCP `get_jev_status` (read) returns `enabled`, `mode`, `threshold`, `daily_call_cap`, `calls_today`, `last_run_at` and `lines_without_suggestion` for the token's company.

Jev still never approves a line ([0084](0084-jev-auto-prefill.md)), and amounts, VAT and dates still come from Flow's own data.

## Alternatives rejected

Calling `jev-tag` from the end of `sumit-sync` and `mercury-sync`. It ties two sync functions to Jev, needs a background task after the response, and still needs the same cap and lease. Once a night: lines synced in the morning would wait all day (the owner chose after each sync). Counting the cap in the Edge Function: two runs could each see room and both spend it. A per-company cap the owner sets from the app: not asked for; the column can be changed in SQL until a screen needs it.

## Consequences

`get_jev_status` lets the data agent see whether Jev is on, how much of today's cap is spent and how many lines wait. A failed line waits at least 6 hours before Jev sees it again; the owner can still tag it by hand at any time. The owner-only key status RPC from [0083](0083-jev-connector.md) is still backlog. Learning from confirmations, the shadow accuracy report, anomaly flags and recurring payment patterns are the next FLOW-701 parts.
