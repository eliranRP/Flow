# Running cost and load time

**Date:** 2026-09-26
**Status:** Accepted

## Context

The proof of concept has to stay cheap enough to run, and fast enough to use on site. Sign-in already follows that budget: [0033](0033-google-sign-in.md) drops SMS because each code had a cost.

## Decision

The total running cost of the whole system is at most $5 per month. That cap covers hosting, the database, background sync, AI tagging, and everything else.

App load is at most 2 seconds. Home is usable within 2 seconds on a mid-range phone on 4G.

## Alternatives rejected

A higher monthly budget. A first screen that takes longer than 2 seconds to become usable.

## Consequences

A feature that pushes the running cost over $5 a month, or that leaves Home unusable after 2 seconds on that phone and network, does not fit this phase. The $5 cap is the whole system, not a per-service allowance.
