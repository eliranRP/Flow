# Review handoff from r23

**Date:** 2026-09-29
**Status:** Accepted

## Context

Eliran approved a process change for every handoff from r23 on. Reviewers were checking screens that had no realistic data, and nits were being treated as merge blockers. The hosted app must not gain a sample ledger.

## Decision

1. Before a handoff, the author self-reviews against the PR reviewer's checklist and the UI design reviewer's checklist, and puts that self-check in the handoff summary. The self-check covers [DESIGN-RULES](../design/DESIGN-RULES.md), [CONTROLS.md](../qa/CONTROLS.md) with a pass or fail on each new or changed control, a 320px clipping and overflow sweep, a no-op-control sweep, the cursor rules (pointer when the control can be used, not-allowed when it cannot, progress while it is busy), and that the numbers on the screen add up to the line they came from.
2. The dev server has a reviewer preview at `/reviewer`. It shows sample books: a review queue that includes an unallocated shared cost, the filed-today list (and its empty state), and saves that succeed, that the database would refuse, or that fail because the connection dropped. `?save=ok`, `?save=fail`, and `?save=offline` choose the save. Every screen shows "נתוני דוגמה · Example data". The module is imported only inside `import.meta.env.DEV`, so the hosted build does not contain it. `pnpm check:bundle` already fails if `dist` contains "Example data".
3. Only Blocking and Should items block a merge. A nit is recorded and fixed in the next batch. It does not block the handoff it was found in.

## Alternatives rejected

Shipping the sample books in the hosted build behind a flag. Treating a nit as a merge blocker. Leaving the self-check out of the handoff summary.

## Consequences

A reviewer can open `/reviewer` on the dev server and walk every queue, list, and save state without a session and without writing a ledger row. The hosted bundle stays free of that sample. A handoff summary names the self-check result. A nit waits for the next batch.
