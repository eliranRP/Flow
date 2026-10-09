<a id="flow-902"></a>
# FLOW-902 · Replace the deny-listed supplier word
- **Type:** BACKLOG NIT · **Status:** done (#322)
- **Outcome:** the repo-wide check found no supplier word. Every hit was the owner's first name, which he keeps in the repo, so the check allows it. · **Depends on:** —
- **What:** One deny-listed supplier word still appears in about 30 places (demo data, docs, e2e). Replace it with invented names and keep the matching test arguments in sync.
- **Acceptance:** 0 deny-list hits; tests pass.
