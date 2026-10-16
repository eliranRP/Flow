<a id="flow-833"></a>
# FLOW-833 · One story per state: delete the width and Dark copies
- **Type:** CLEANUP · **Status:** done (#600) · **Depends on:** [FLOW-832](FLOW-832.md) · **Source:** redesign handoff 2026-10-15 (Storybook dedupe), owner approved 2026-10-15.
- [x] Delete the stories that only repeat another story at a width (`clip-check` already covers 320, 360 and 390 in both themes).
- [x] The Storybook vitest run renders every story in dark as well as light, then the `*Dark` copies are deleted.
- Result: 1,606 stories become 976. The dark pass (`storybook-dark`) passes all 976; it runs on main, and the PR check runs light only. Timing on one machine: main's light run 137 s for 1,606 stories; light plus dark on the branch 167 s for 976 twice, so the PR check's Storybook part drops to about 60% of its old renders. Kept on purpose: layout-measuring stories at each width, stories at 375 SE, 393 and short heights (not covered by clip-check), and the states restored after review.
- **Acceptance:** about 1,646 stories become about 850, every remaining story passes in both themes, and the Storybook vitest phase in gate-times.log drops by about half.
