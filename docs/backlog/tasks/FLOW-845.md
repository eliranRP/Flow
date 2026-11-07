<a id="flow-845"></a>
# FLOW-845 · jev-review-queue's "approves … and ביטול reopens it" waits on its toast with a fixed second
- **Type:** BUG · **Status:** done (#1051) · **Source:** UX rules review 2026-11-04, from the review of #966 (the review-queue CI flake), where both failed on main too under `--maxWorkers=4 --sequence.shuffle` (4 of 10 runs on main).
- **Files:** `app/src/screens/jev-review-queue.test.tsx` (about lines 1001-1024), and the app code it drives if the root cause is there.

- [x] Find why the toast can take over a second under load (the toast's own delay, a write queue, or the test's timers) and fix the cause; don't only raise the timeout. If it is the test's clock, drive it with fake timers.
  - Cause: not a delay. The "review card pin" `beforeEach` reset only four of the mock's fields, and the swap test that sets `db.failReopen = true` left it set. Under `--sequence.shuffle` the ביטול test could run next: its reopen failed, the toast said "לא הצלחנו לבטל.", and the wait for the reopened toast ran out (seen in a traced run). Both describes now call one `resetDb()` that resets every field. No app change.

**Acceptance:** the file passes 20 runs in a row with the review test files under `--maxWorkers=4 --sequence.shuffle`.
