# The shipped app reads the ledger, and the ledger comes from SUMIT

**Date:** 2026-09-28
**Status:** Accepted

## Context

`?preview=demo` built Home, projects, and unpaid from `packages/shared/fixtures/demo-data.json` inside the client. That file is the Flow Test export used by the golden Vitest. It is not a substitute for the SUMIT API. [0050](0050-demo-splits-and-review.md) already says the sync derives the Flow Test splits. The client was still a second copy of the same books.

## Decision

Every account, document, and amount in the running app comes from `get_dashboard`, `list_unpaid`, and the other RPCs. Those rows are written by `sumit-sync` after `sumit-connect` stores the key. The preview query can still open empty, loading, and error chrome. It does not invent a profit.

`expected-pnl.json` is the answer key for `packages/shared` tests. The app does not import it. `demo-data.json` stays in the unit test that checks the derivation against that answer key (`app/src/demo/model.test.ts` and `packages/shared`). Neither file is in the production bundle. `pnpm check:bundle` walks `app/src/main.tsx` and greps `app/dist`.

`pnpm seed:demo` refuses to run. The hosted database is not seeded with the fixture. `supabase/seed.sql` inserts no documents.

Folder discovery calls `crm/schema/listfolders`. `crm/data/listfolders` now redirects to the SUMIT help site, so the allowlist uses the schema path from the SUMIT research. Document rows still come from `crm/data/listentities`.

The Flow Test supplier map and worker-day weights stay in `supabase/functions/_shared/flow-test.ts`. SUMIT does not send them. They are the derivation rules from [0050](0050-demo-splits-and-review.md), not a copy of the documents.

`pnpm test:e2e:live` signs in to a local Supabase, connects company 2389917160, runs the backfill, and checks Home, Projects, and Unpaid. It then creates one invoice in the SUMIT test account, syncs, sees it, credits it, and syncs back to the golden totals. It does not run in CI unless `SUMIT_LIVE=1` and the key are set. The key is not committed.

## Alternatives rejected

Leaving `?preview=demo` in the bundle behind a flag. Shipping the fixture and calling it demo data. Seeding the hosted project with `seed:demo`.

## Consequences

Storybook screen stories show the real empty, loading, and error routes. They do not paint the golden profit. A reviewer checks the numbers on a signed-in company after a refresh, or with `pnpm test:e2e:live`.
