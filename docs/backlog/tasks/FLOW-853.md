<a id="flow-853"></a>
# FLOW-853 · The Storybook preview deploys with code from main only
- **Type:** SMALL CYCLE (infra) · **Status:** in-progress (#1170) · **Source:** the weekly security scan, 2026-11-14; the owner's decision the same day.
- **Files:** `.github/workflows/storybook-preview.yml`, `scripts/storybook-preview.test.mjs`, `docs/runbooks/ci-cd.md` (Storybook preview), a changelog fragment.

- [x] `build` runs the pull request's code with no secret and uploads the static build; `deploy` alone reads the Cloudflare token and runs only the base commit's lockfile and scripts, checking the build again before it deploys.

**Acceptance:** a pull request's code, or a dependency it bumps, never runs in the job that holds the Cloudflare token; the preview link and comment work as before.
