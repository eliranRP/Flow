<a id="flow-832"></a>
# FLOW-832 · Push to checks done in 2 minutes
- **Type:** INFRA · **Status:** claimed (fast cycle lane, 2026-10-15, claude/project-thread-zozsvp) · **Depends on:** — · **Source:** owner, 2026-10-15: code push to finished CI checks takes no more than 2 minutes; plan approved on a card 18:34Z.
- [ ] The pre-push hook runs only the quick part of `scripts/local-ci.sh` in at most 60 s, with no Docker: lint of the changed files, the incremental typecheck, and the unit and Storybook vitest tests related to the change, capped at 45 s (what the cap leaves goes to the PR check).
- [ ] A `pull_request` workflow runs the rest of the scoped gate on GitHub as parallel jobs (the scoped e2e specs in shards, the scoped Storybook clip and layout specs, the related tests past the hook's cap, and pgTAP for a migration change). A UI or server PR finishes in 2 minutes or less after the push; a migration PR is the one exception, about 4.
- [ ] `main` runs the full suite on every merge; the deploy stays batched every 5 merges.
- [ ] The backlog README's cycle says: one Haiku reviewer per PR with the code, pixel and motion checklist; merge when the PR check is green and the review approves the same head.
- **Acceptance:** gate-times.log and the PR check's run time on a one-line UI change and a one-line server change are both 120 s or less, and `scripts/ci-cd.test.mjs` pins the new structure.
