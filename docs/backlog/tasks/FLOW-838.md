<a id="flow-838"></a>
# FLOW-838 · txn-step e2e: prev and next walk the list is flaky on CI
- **Type:** BUG (e2e) · **Status:** claimed (dev lane 1, 2026-10-28, claude/peaceful-mccarthy-kxcgv2) · **Source:** main's ci run for #850 (eacfd73): `e2e/txn-step.spec.ts` › "prev and next walk the list, and Back returns to its scroll spot" failed once (`ספק 14` stayed hidden after the second הבאה tap) and passed on the re-run; 20/20 locally.
- **Files:** `app/e2e/txn-step.spec.ts`, and the step screen only if the root cause is in the app.

- [ ] Find why the second tap can leave card 14 hidden on a slow runner, and fix the cause (the test's wait, or the screen if a tap during a transition is lost).
- [ ] The spec passes 30 runs in a row with CPU throttled.

**Acceptance:** the spec stable under `--repeat-each`; no other e2e change.
