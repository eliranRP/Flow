<a id="flow-838"></a>
# FLOW-838 · txn-step e2e: prev and next walk the list is flaky on CI
- **Type:** BUG (e2e) · **Status:** in-progress (#851) · **Source:** main's ci run for #850 (eacfd73): `e2e/txn-step.spec.ts` › "prev and next walk the list, and Back returns to its scroll spot" failed once (`ספק 14` stayed hidden after the second הבאה tap) and passed on the re-run; 20/20 locally.
- **Files:** `app/e2e/txn-step.spec.ts`, and the step screen only if the root cause is in the app.

- [x] Find why the second tap can leave card 14 hidden on a slow runner, and fix the cause (the test's wait, or the screen if a tap during a transition is lost).
- [x] The spec passes 30 runs in a row with CPU throttled.

**Acceptance:** the spec stable under `--repeat-each`; no other e2e change.

**Root cause:** `useTxnNav.move` (`app/src/txn-nav.tsx`) ignores a press while the old card is still rendered (one move per card). The URL changes to the next line before its card renders, and the test's `toBeFocused()` passed then too (the pressed button keeps focus), so the second הבאה could land during the transition and be dropped. The only `ספק 14` text left was the hidden swipe peek of card 13, so `toBeVisible()` timed out. The test now waits for card 13 on screen before pressing again, as the arrow-key test does; the app's one-move-per-card behaviour is intended and unchanged. Unfixed: 23 of 30 failed at 6× CPU throttling; fixed: 120 of 120 (the whole spec, 30 times, 4 workers, 6× throttling).
