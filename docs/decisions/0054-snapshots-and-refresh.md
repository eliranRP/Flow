# Dirty months refresh before Home, and SUMIT calls have a cap

**Date:** 2026-09-28
**Status:** Accepted

## Context

Home was aggregating on every read. The plan wants dirty months, snapshots, a daily poll, and `request_refresh` with a six-hour floor.

## Decision

Inserts and updates mark `dirty_month`. `get_dashboard` refreshes those months before it returns, using the same `company_pnl` function, and stores `agg_month` plus four snapshots: this month, last month, and all-time cash, and all-time invoiced. `read_home_snapshot` returns `{unchanged:true}` when the version matches.

`request_refresh('app_open')` waits six hours. `pull` waits 30 minutes. `reserve_sumit_call` is service-role only. App-open and pull stop at 70 calls in the Israel month, weekly at 90, everything at 100. The daily cron stays 03:00 UTC. A weekly marker is Saturday 21:00 UTC when `pg_cron` exists.

## Consequences

A custom range still uses `company_pnl` for that range. The snapshots cover the standard periods.
