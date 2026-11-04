<a id="flow-846"></a>
# FLOW-846 · jev-review-open's "binds a company row that arrives after the one-second cap" asserts wall-clock time
- **Type:** BUG · **Status:** ready · **Source:** UX rules review 2026-11-04, from the review of #966 (the review-queue CI flake), where both failed on main too under `--maxWorkers=4 --sequence.shuffle` (failed once in that review's local loop: 3159 ms against the test's 2500 ms bound; not seen in CI yet).
- **Files:** `app/src/screens/jev-review-open.test.tsx`.

- [ ] The test checks elapsed real time, which a loaded runner can exceed. Assert the order of events (or drive the cap with fake timers) instead of a wall-clock bound.

**Acceptance:** the test has no real-time bound and passes 20 runs in a row under `--maxWorkers=4 --sequence.shuffle`.
