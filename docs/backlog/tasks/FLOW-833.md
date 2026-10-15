<a id="flow-833"></a>
# FLOW-833 · One story per state: delete the width and Dark copies
- **Type:** CLEANUP · **Status:** claimed (Review state lane, 2026-10-15, claude/project-thread-zozsvp) · **Depends on:** [FLOW-832](FLOW-832.md) · **Source:** redesign handoff 2026-10-15 (Storybook dedupe), owner approved 2026-10-15.
- [ ] Delete the stories that only repeat another story at a width (`clip-check` already covers 320, 360 and 390 in both themes).
- [ ] The Storybook vitest run renders every story in dark as well as light, then the `*Dark` copies are deleted.
- **Acceptance:** about 1,646 stories become about 850, every remaining story passes in both themes, and the Storybook vitest phase in gate-times.log drops by about half.
