# Review handoff from r23

**Date:** 2026-09-29
**Status:** Accepted

## Context

Eliran approved a process change for every handoff from r23 on. Reviewers were checking screens that had no realistic data, and nits were being treated as merge blockers. The hosted app must not gain a sample ledger.

## Decision

1. Before a handoff, the author self-reviews against the PR reviewer's checklist and the UI design reviewer's checklist, and puts that self-check in the handoff summary. The self-check covers [DESIGN-RULES](../design/DESIGN-RULES.md), [CONTROLS.md](../qa/CONTROLS.md) with a pass or fail on each new or changed control, a 320px clipping and overflow sweep, a no-op-control sweep, the cursor rules (pointer when the control can be used, not-allowed when it cannot, progress while it is busy), and that the numbers on the screen add up to the line they came from.
2. A reviewer preview at `/reviewer` shows sample books: a review queue that includes an unallocated shared cost, the filed-today list (and its empty state), and saves that succeed, that the database would refuse, or that fail because the connection dropped. `?save=ok`, `?save=fail`, and `?save=offline` choose the save. Every screen shows "נתוני דוגמה · Example data". The dev server imports that module. A reviewers-only build sets `VITE_REVIEWER_BUILD=1` and does the same, with invented sample names (בית הספר אלון, מחסן הנמל, מחצבת הדקל, שינוע הנמל, עגורני החוף) and with the Supabase URL and anon key left empty. It must not carry the hosted Supabase URL, anon key, or project ref, or a Flow Test 2 name, id, or total. The ids include 2375135516. The totals 37700, 134520, and 114000 are also rejected as 37,700, 134,520, and 114,000, with or without a leading ₪. The same guard rejects פ״ת, ת״א, the ASCII-quote forms פ"ת and ת"א, פתח תקווה, צבעי הגליל, and מנופי. The hosted values are read from `app/.env.production`, including when they are quoted. The URL must be `https://<project-ref>.supabase.co` and the key must be a JWT. The check fails when that file is missing or fewer than those two values are found. The reviewers-only build runs that guard when it finishes, and `pnpm check:reviewer-bundle` runs it again. The hosted build leaves the flag unset and does not contain the module. An empty `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` fails that build. `pnpm check:bundle` fails if the hosted `dist` contains "Example data", an `/e2e/` route, or a reviewer marker (`sampleSaveMode`, `sampleRun`, `reviewerBooks`, `reviewerQueue`, `reviewer-preview`, `reviewer-sample`).
3. Only Blocking and Should items block a merge. A nit is recorded and fixed in the next batch. It does not block the handoff it was found in.

## Alternatives rejected

Shipping the sample books in the hosted build behind a flag. Treating a nit as a merge blocker. Leaving the self-check out of the handoff summary.

## Consequences

A reviewer can open `/reviewer` on the dev server, or in a reviewers-only build that has no hosted key, and walk every queue, list, and save state without a session and without writing a ledger row. The hosted bundle stays free of that sample. A handoff summary names the self-check result. A nit waits for the next batch.
