<a id="flow-904"></a>
# FLOW-904 · Sync the CI deny-list secret
- **Type:** SMALL CYCLE · **Status:** done (#322; owner, 2026-10-09: the secret list was already up to date) · **Depends on:** —
- **What:** Merge the maintained deny-list into the CI secret without dropping existing entries.
- **Acceptance:** CI deny-list test still green; nothing printed.
