# Review handoff from r23

**Date:** 2026-09-29
**Status:** Accepted

## Context

Eliran approved a process change for every handoff from r23 on. Reviewers were checking screens that had no realistic data, and nits were being treated as merge blockers. The hosted app must not gain a sample ledger.

## Decision

1. Before a handoff, the author self-reviews against the PR reviewer's checklist and the UI design reviewer's checklist, and puts that self-check in the handoff summary. The self-check covers [DESIGN-RULES](../design/DESIGN-RULES.md), [CONTROLS.md](../qa/CONTROLS.md) with a pass or fail on each new or changed control, a 320px clipping and overflow sweep, a no-op-control sweep, the cursor rules (pointer when the control can be used, not-allowed when it cannot, progress while it is busy), and that the numbers on the screen add up to the line they came from.
2. A reviewer preview at `/reviewer` shows sample books: a review queue that includes an unallocated shared cost, the filed-today list (and its empty state), and saves that succeed, that the database would refuse, or that fail because the connection dropped. `?save=ok`, `?save=fail`, and `?save=offline` choose the save. Every screen shows "נתוני דוגמה · Example data". The dev server imports that module. A reviewers-only build sets `VITE_REVIEWER_BUILD=1` and does the same, with the sample names (שיפוץ הרצל 12, וילה רעננה) and with the Supabase URL and anon key left empty, so it does not carry the hosted key or a Flow Test 2 name. The hosted build leaves the flag unset and does not contain the module. `pnpm check:bundle` fails if the hosted `dist` contains "Example data", an `/e2e/` route, or a reviewer marker.
3. Only Blocking and Should items block a merge. A nit is recorded and fixed in the next batch. It does not block the handoff it was found in.

## Alternatives rejected

Shipping the sample books in the hosted build behind a flag. Treating a nit as a merge blocker. Leaving the self-check out of the handoff summary.

## Consequences

A reviewer can open `/reviewer` on the dev server, or in a reviewers-only build that has no hosted key, and walk every queue, list, and save state without a session and without writing a ledger row. The hosted bundle stays free of that sample. A handoff summary names the self-check result. A nit waits for the next batch.
