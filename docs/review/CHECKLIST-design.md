# Design checklist

Use this with [PITFALLS.md](PITFALLS.md) before changing a screen, and again before handoff.

- [ ] Opened [implementation-guide.md](../../design/system/implementation-guide.md), the screen file under `design/src/`, [DESIGN-RULES.md](../design/DESIGN-RULES.md), and [CONTROLS.md](../qa/CONTROLS.md).
- [ ] Hints use `t-hint` (13px) and the control points at them with `aria-describedby`.
- [ ] Rows use `ListRow` and the same icon slot as the rows beside them.
- [ ] `pnpm build-storybook` then `pnpm clip-check`. At 320, 360, and 390, light and dark, text fits its own box by more than 1px. A single-line ellipsis is the designed title truncation. A wrapping hint is still measured. The tint that sticks out of a row is not text.
- [ ] The changed row was walked next to the states it shares a screen with. A failed load shows an error and a retry. It does not show an empty state with an active primary action.
- [ ] No state is shown unless the screen knows that state.
- [ ] New or changed controls are rows in `docs/qa/CONTROLS.md`, marked pass only after a test.
- [ ] Copy that fails says what failed and asks for a retry. It does not reuse another action's error sentence.
