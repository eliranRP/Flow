<a id="flow-848"></a>
# FLOW-848 · The offline shell keeps only HTML pages
- **Type:** SMALL CYCLE (infra) · **Status:** in-progress (#1129) · **Source:** the security scan, 2026-11-11.
- **Files:** `app/vite.config.ts` (the navigation cache), `scripts/pages-spa.test.mjs`, a changelog fragment.

- [x] The navigation cache stores a response under `/app-shell` only when it is an HTML page.
- [x] Checked by hand in a local browser (see #1129); the unit test checks the config text.

**Acceptance:** after the app is installed, opening a plain file (`/build.txt`, an icon) in a tab leaves the offline page as the app.
