<a id="flow-822"></a>
# FLOW-822 · Remove CSS rules no screen uses
- **Type:** SMALL CYCLE · **Status:** claimed (temporary lane, owner request, 2026-10-11, claude/compassionate-goldberg-ubfcqg) · **Depends on:** FLOW-819 · **Source:** owner, 2026-10-11: review the app for dead code after many changes.
- [ ] About 50 classes in `app/src/ui/css/` and the design tokens have no reference in app/src, app/e2e or Storybook. Delete each rule whose class is not built at runtime (`ui-chip-${kind}` and the like stay).
