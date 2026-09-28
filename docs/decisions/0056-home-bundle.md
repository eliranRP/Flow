# The Home bundle budget is a ceiling, not the 120 KB target yet

**Date:** 2026-09-28
**Status:** Accepted

## Context

The plan's Home target is 120 KB gzip. The shell includes React, the router, TanStack Query, and supabase-js, which already sit near that size before a screen is drawn.

## Decision

`scripts/check-bundle.ts` fails when the main JavaScript gzip exceeds 260 KB. The 120 KB figure stays the target for a later split of supabase-js. This slice does not add a paid performance service or RUM vendor. `log_rum` stores a sample in Postgres when the client sends one.

The last dashboard payload is kept in `localStorage` so a returning open can paint numbers before the network returns.

## Consequences

A dependency that pushes the entry over 260 KB gzip has to be justified in a new decision.
