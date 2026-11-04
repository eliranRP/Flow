<a id="flow-845"></a>
# FLOW-845 · jev-review-queue's "approves … and ביטול reopens it" waits on its toast with a fixed second
- **Type:** BUG · **Status:** ready · **Source:** UX rules review 2026-11-04, from the review of #966 (the review-queue CI flake), where both failed on main too under `--maxWorkers=4 --sequence.shuffle` (4 of 10 runs on main).
- **Files:** `app/src/screens/jev-review-queue.test.tsx` (about lines 1001-1024), and the app code it drives if the root cause is there.

- [ ] Find why the toast can take over a second under load (the toast's own delay, a write queue, or the test's timers) and fix the cause; don't only raise the timeout. If it is the test's clock, drive it with fake timers.

**Acceptance:** the file passes 20 runs in a row with the review test files under `--maxWorkers=4 --sequence.shuffle`.
