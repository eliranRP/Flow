<a id="flow-855"></a>
# FLOW-855 · The pr check runs its full jobs for every file the app ships
- **Type:** SMALL CYCLE (infra) · **Status:** in-progress · **Source:** the weekly security scan, 2026-11-21.
- **Files:** `.github/workflows/pr.yml` (the `changes` job), `scripts/ci-cd.test.mjs`, a changelog fragment.

- [x] The docs-only rule is local-ci.sh's `docs_files`: design images count as docs, the design system's CSS does not (the app imports it), so a change to it runs the typecheck, the CSS checks and the tests.
- [x] The e2e rule also covers `app/public/` (push-sw.js, `_headers`, `_redirects`), `app/index.html`, `app/library-aliases.ts` and `design/system/`.

**Acceptance:** a pull request that changes only one of those files gets the full `pr` run, not a green check with the jobs skipped.
