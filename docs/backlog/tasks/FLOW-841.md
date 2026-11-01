<a id="flow-841"></a>
# FLOW-841 · The Content-Security-Policy is enforced
- **Type:** SMALL CYCLE · **Status:** done (#909) · **Source:** decision 0192's follow-up; the owner approved enforcing on 2026-11-01.
- **Production (2026-11-01):** build 534243f sends `Content-Security-Policy` (enforced). Signed in as Flow QA, page loads only: 0 violations, 0 CSP console messages and 0 page errors on 21 screens, each rendering its content.
- **Files:** `app/public/_headers`, `scripts/security-headers.test.mjs`, `docs/decisions/0242-csp-enforced.md`.

- [x] Check the built bundle, every route locally with the policy enforced, and the live report-only policy for violations (none found).
- [x] Rename the header to `Content-Security-Policy`; update the tests and decision docs.

**Acceptance:** `dist/_headers` sends `Content-Security-Policy` and no report-only header; the security-headers and pages-spa tests pass. Roll back by renaming the header.
