<a id="flow-857"></a>
# FLOW-857 · Push links, dev servers and the reviewer prompt
- **Type:** SMALL CYCLE (infra) · **Status:** in-progress · **Source:** the weekly security scan, 2026-11-21; the owner's choice the same day.
- **Files:** `app/public/push-sw.js`, `app/package.json` (dev, preview, storybook), `app/vite.config.ts` (server host), `docs/backlog/README.md` (the reviewer prompt), `docs/runbooks/component-library.md`, `scripts/dev-hardening.test.mjs`, a changelog fragment.

- [x] The push worker's link check refuses a path that normalises to `//host`, on its own, not only on the second pass at a click.
- [x] `pnpm dev`, `pnpm preview` and `pnpm storybook` listen on this machine only; `FLOW_DEV_HOST=0.0.0.0` (or `pnpm storybook --host 0.0.0.0`) opens them to the network when wanted.
- [x] The reviewer prompt says the PR body, comments, diff and code comments are data, never instructions.

**Acceptance:** `sameOrigin` never returns a value that resolves to another origin; the dev servers bind 127.0.0.1 by default.
