<a id="flow-864"></a>
# FLOW-864 · New dependency releases wait 3 days
- **Type:** SMALL CYCLE (infra) · **Status:** in-progress · **Source:** the weekly security scan, 2026-11-28 (hijacked npm releases this month); the owner's choice the same day.
- **Files:** `.github/dependabot.yml`, `pnpm-workspace.yaml`, `scripts/dependency-cooldown.test.mjs`, a changelog fragment.

- [x] Dependabot's version updates wait 3 days after a release (`cooldown`, both ecosystems). Security updates are not delayed.
- [x] pnpm resolves no version published less than 3 days ago (`minimumReleaseAge: 4320`). Installs from the lockfile, as CI runs them, are not affected.

**Acceptance:** `scripts/dependency-cooldown.test.mjs` fails if either setting is removed; `pnpm install --frozen-lockfile` still passes.
