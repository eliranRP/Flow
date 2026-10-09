<a id="flow-811"></a>
# FLOW-811 · CI and deploy follow-ups
- **Type:** BACKLOG NIT · **Status:** done (this PR) except the Dependabot item · **Depends on:** —
- [x] Migration checker: scan nested dollar-quoted bodies and commits inside DO or function bodies; don't flag `begin atomic`; flag unwrapped create/drop index. (A nested body after `do` or `as` is now scanned too; the other three were already in.)
- [x] Record the production row-hash baseline query in a script, so a baseline can be recomputed after a deploy. (`scripts/prod-row-hash.sh`: prints the baseline, or compares with one; runbook "Row-hash baseline".)
- [ ] If Dependabot is added, give it the fixture deny-list secret (CI fails closed without it). (Not now: there is no Dependabot.)
- [x] Optional: indexes for composite foreign keys without a matching index (advisor info). (34 indexes cover the 35 keys the advisor listed; a pgTAP test fails on a new foreign key without one.)
- [x] Smoke: a failure message on the sheet-stack scrim check; anchor the auth allowlist to the Supabase host; a unit test for the reporter. (The scrim check already had its message. The write guard moved to `e2e/smoke-allow.ts`: the auth, status and list-RPC POSTs pass only on the Supabase origin. Unit tests for it and the reporter.)
- [x] Add `supabase migration repair` to the CI/CD runbook. (Already in `docs/runbooks/ci-cd.md`.)
- [x] Consider per-PR changelog fragments; `docs/changelog.md` conflicts on almost every parallel PR. (`docs/changelog.d`.)
