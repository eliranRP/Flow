<a id="flow-847"></a>
# FLOW-847 · The security checklist says the CSP is enforced
- **Type:** SMALL CYCLE (docs) · **Status:** claimed (security, 2026-11-07, flow-847-csp-row) · **Source:** the weekly security scan, 2026-11-07: row C1 of `docs/security/known-attacks.md` still says the CSP is report-only, but decision 0242 (#909) enforces it.
- **Files:** `docs/security/known-attacks.md` (row C1), a changelog fragment.

- [ ] Row C1 says the policy is enforced (decisions 0192 and 0242), and that the weekly scan compares the live header with what `scripts/security-headers.mjs` builds.

**Acceptance:** row C1 matches what production sends.
