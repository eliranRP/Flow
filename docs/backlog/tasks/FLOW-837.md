<a id="flow-837"></a>
# FLOW-837 · Storybook preview on ready pull requests only
- **Type:** INFRA · **Status:** done (#634) · **Depends on:** FLOW-809 · **Source:** Eliran's decision card, 2026-10-16: draft pushes should not build the Storybook preview.
- [x] The `preview` job in `.github/workflows/storybook-preview.yml` runs only when the pull request is not a draft (`!github.event.pull_request.draft`), so a draft's pushes skip it and the first ready push builds it.
- [x] `scripts/storybook-preview.test.mjs` pins the draft guard on the `if:` line.
- [x] The runbook (`docs/runbooks/ci-cd.md`, Storybook preview) says a draft push skips the preview.
