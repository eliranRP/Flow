# Pilot runs on Supabase Free

**Date:** 2026-09-26
**Status:** Accepted

## Context

The earlier technical plan put the whole system on Cloudflare, including D1. [0034](0034-cost-and-load-limits.md) caps the running cost at $5 a month. The current plan is [tech-plan.md](../tech/tech-plan.md). The Cloudflare version is kept at [tech-plan.v1-cloudflare.md](../tech/tech-plan.v1-cloudflare.md).

## Decision

The pilot runs on Supabase Free, in Frankfurt.

That project is Postgres with row-level security, Auth with Google, Storage, Edge Functions, `pg_cron`, and a `pgmq` queue.

Move to Supabase Pro ($25 a month) at the first paying customer or the first technical limit, whichever comes first. The limits are a database of 300 MB, storage of 750 MB, egress of 3 GB a month, a nightly dump of about 100 MB, or about 15–20 active companies.

PWA static files are served free from Cloudflare.

Nightly encrypted backups go to Cloudflare R2 by a scheduled job, with a monthly restore test. Supabase Free has no backups.

This supersedes the Cloudflare D1 recommendation in the v1 plan.

## Alternatives rejected

Cloudflare Workers with D1 as the database. Staying on Free after a paying customer or after one of those limits.

## Consequences

[0034](0034-cost-and-load-limits.md) is refined, not replaced. The $5 a month cap holds for the pilot. Pro means about $27 a month once the pilot is growing. The 2-second load limit is unchanged.

The Pro trigger, photo storage, and the Google sign-in address are the pilot defaults in [0039](0039-pilot-defaults.md).
