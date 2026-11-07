<a id="flow-846"></a>
# FLOW-846 · jev-review-open's "binds a company row that arrives after the one-second cap" asserts wall-clock time
- **Type:** BUG · **Status:** in-progress (#TBD) · **Source:** UX rules review 2026-11-04, from the review of #966 (the review-queue CI flake), where both failed on main too under `--maxWorkers=4 --sequence.shuffle` (failed once in that review's local loop: 3159 ms against the test's 2500 ms bound; not seen in CI yet).
- **Files:** `app/src/screens/jev-review-open.test.tsx`.

- [x] The test checks elapsed real time, which a loaded runner can exceed. Assert the order of events (or drive the cap with fake timers) instead of a wall-clock bound.
  - The test now waits for the cap's miss (`jevScopeFollowsLive()`), checks the card is usable with no scope bound, then releases the company row and waits for the bind. A company row that came before the cap would never give the miss, so the order is still checked; there is no `Date.now()` bound.

**Acceptance:** the test has no real-time bound and passes 20 runs in a row under `--maxWorkers=4 --sequence.shuffle`.
