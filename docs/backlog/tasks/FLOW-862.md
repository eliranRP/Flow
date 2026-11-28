<a id="flow-862"></a>
# FLOW-862 · Kept reads are dropped for a company the user no longer belongs to
- **Type:** SMALL CYCLE (infra) · **Status:** in-progress · **Source:** the weekly security scan, 2026-11-28 (a check of what the kept reads keep on the device, FLOW-1267) (low severity: data kept on the device).
- **Files:** `app/src/kept-reads.ts` (`keepKeptCompaniesFor`, the sweep with no company shown), `app/src/team-queries.ts` (the company list calls it), `app/src/kept-reads.test.ts`, a changelog fragment.

- [x] When the signed-in user's company list arrives, the kept rows of a company not in it go: the stored rows, the ones waiting for their write, and the cache's put-back of them. The rows of the listed companies stay, so a switch back still draws at once.
- [x] An expired row, or one of another version, goes even when no company is shown: the put-back and the session's check both sweep them. A signed-out start still opens no store.

**Acceptance:** a user removed from a company keeps none of its kept reads on the device once the company list comes in; rows older than a week go with or without a shown company.
