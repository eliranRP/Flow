<a id="flow-834"></a>
# FLOW-834 · Delete what nothing uses: code, CSS, old mockups, duplicate tests
- **Type:** CLEANUP · **Status:** in-progress (Review state lane B) · **Depends on:** [FLOW-833](FLOW-833.md) · **Source:** owner, 2026-10-15: delete the UI pages, stories, tests and anything not in use.
- [x] Run the unused-code and unused-CSS checks over the whole tree and delete what they find (components, CSS blocks, helpers, fixtures, scripts).
- [ ] Delete old design mockup files that nothing links to. (Waiting on the owner: `design/MANIFEST.txt` keeps every file in `design/`; 108 of them are linked from nowhere else.)
- [x] Delete e2e specs whose whole check a unit or story test already makes.
- [x] The PR body lists every deletion before it merges.
- **Acceptance:** the unused checks pass over the whole tree, and the full suite on main stays green.
