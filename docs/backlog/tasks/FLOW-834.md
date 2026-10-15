<a id="flow-834"></a>
# FLOW-834 · Delete what nothing uses: code, CSS, old mockups, duplicate tests
- **Type:** CLEANUP · **Status:** ready · **Depends on:** [FLOW-833](FLOW-833.md) · **Source:** owner, 2026-10-15: delete the UI pages, stories, tests and anything not in use.
- [ ] Run the unused-code and unused-CSS checks over the whole tree and delete what they find (components, CSS blocks, helpers, fixtures, scripts).
- [ ] Delete old design mockup files that nothing links to.
- [ ] Delete e2e specs whose whole check a unit or story test already makes.
- [ ] The PR body lists every deletion before it merges.
- **Acceptance:** the unused checks pass over the whole tree, and the full suite on main stays green.
