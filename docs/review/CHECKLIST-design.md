# Design checklist

Use this with [PITFALLS.md](PITFALLS.md) before changing a screen, and again before handoff.

- [ ] Opened [implementation-guide.md](../../design/system/implementation-guide.md), the screen file under `design/src/`, [DESIGN-RULES.md](../design/DESIGN-RULES.md), and [CONTROLS.md](../qa/CONTROLS.md).
- [ ] Hints use `t-hint` (13px) and the control points at them with `aria-describedby`.
- [ ] Rows use `ListRow` and the same icon slot as the rows beside them.
- [ ] `pnpm build-storybook` then `pnpm clip-check`. At 320, 360, and 390, light and dark, text fits its own box by more than 1px. An inline box is as wide as its text and never clips. Each text node is measured on the nearest ancestor that is not `display: inline` or `display: contents`, once per container. Ellipsis is exempt only on `.ui-row-title` and `[data-clip-ok]`. A single-line `.ui-row-hint` is measured. A wrapping hint is still measured. Visually hidden text, a box of about 1px, is not measured. A `clip-no-text` tag skips the story. `parameters.clipCheck.noText` does not. Any other story that measures nothing fails the run. The tint that sticks out of a row is not text. Read `clip-report.txt` for every element. Stdout keeps the first 40 clips.
- [ ] Q-3, UI polish, not this pull request. Sheet titles and route-sheet titles use `data-clip-ok` (single-line ellipsis, same as a row title). Button labels, `.ui-row-hint`, and `.ui-meter-label` wrap. The `*--long-hebrew` stories are the check.
- [ ] The changed row was walked next to the states it shares a screen with. A failed load shows an error and a retry. It does not show an empty state with an active primary action.
- [ ] No state is shown unless the screen knows that state.
- [ ] New or changed controls are rows in `docs/qa/CONTROLS.md`, marked pass only after a test.
- [ ] Copy that fails says what failed and asks for a retry. It does not reuse another action's error sentence.
- [ ] `aria-label` and `aria-labelledby` name a control. They do not name a generic element.
- [ ] A prop that only a story passes is not on a production component.
- [ ] Stories contain no real personal data, including the owner's email.
- [ ] Inline text that replaced an input inside a vaul sheet is selectable on a desktop fine pointer. `getSelection()` returns the text. Touch is not the only probe.
- [ ] A quick diagonal mouse drag over selectable or shown-once content does not dismiss the sheet.
- [ ] A clip-check pass is not treated as evidence for copy, select, or gesture. Those have their own probe.
- [ ] A `min-block-size` step-jump fix was re-sampled at 320, where the content wraps.
- [ ] Button labels use the action name from `ErrorState` and the toasts ("ניסיון חוזר"), not a sentence.
- [ ] An owner call that shipped in code is also a row in that decision's state table.
