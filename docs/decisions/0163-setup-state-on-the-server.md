# Setup progress on the server

**Date:** 2026-10-09
**Status:** Accepted (FLOW-506). Amends [0089](0089-setup-runner.md) point 5.

## Context

The first-run setup flags (skips, the run and resume stamps, the closed Home card) lived only in `localStorage` under `flow.setup.<user>.<company>`. On a new phone or browser the run started again, and a skipped step came back as if it had never been skipped. Decision 0089 kept them local because no table existed and a migration slot was held.

## Decision

1. `setup_states` holds one row per owner and company: `state` is the same object the app already keeps (an object of at most 4 kB), with `updated_at`, which the server stamps. Row level security lets only the owner read and write their own row, for their own company. A viewer gets no row and cannot write one, since a viewer never runs setup.
2. `localStorage` stays the copy the screens read without waiting. Every write with a company also uploads the whole object; the last write wins. Before a company exists nothing is uploaded, as step 0 always opens then.
3. Once per page load the app reads the row. A row replaces the local copy. With no row, local flags from before this change are uploaded once. A write made in this tab before the read answered wins over the row and is uploaded. A failed read or write keeps the local copy and the run goes on; after a failed read, writes stay local for the rest of that page load, so a new phone's empty copy never replaces the row, and the next load reads again.
4. The one automatic resume, the Home card and its completed toast wait for that read, so a new phone does not open a step the owner already skipped or finished elsewhere.
5. The resume is considered once per page load per user, so signing in as another user in the same tab gets its own resume.

## Consequences

- Two phones writing at the same moment keep the later object. The flags are timestamps the owner sets by hand, so a lost write at worst shows a step once more.
- No MCP tool reads these flags; they are app state, not books.
