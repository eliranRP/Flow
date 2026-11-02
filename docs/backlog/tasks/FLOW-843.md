<a id="flow-843"></a>
# FLOW-843 · Every launch opens the newest deploy, without closing the app again
- **Type:** BUG · **Status:** claimed (bug fixes, 2026-11-02, flow-843-launch-new-deploy) · **Depends on:** [FLOW-910](FLOW-910.md), [FLOW-935](FLOW-935.md). **Source:** Owner report 2026-11-02: after each deploy the app has to be closed and opened several times before the change shows.
- **Files:** `app/vite.config.ts`, `app/src/sw-reload.ts`, `app/src/sw-reload.test.ts`, `app/src/main.tsx`, `app/src/screen-loaders.ts`, `app/src/screen-loaders.test.ts`, a changelog fragment.

- [ ] Every launch served `index.html` from the worker's precache, so the first launch after a deploy always ran the old bundle. Navigations now go to the network first (3 s timeout), and fall back to the last cached page offline.
- [ ] A page found behind its deploy before the user did anything reloads at once, instead of waiting for a move to another screen or the background, which iOS often freezes before the reload runs.
- [ ] The watch starts at launch, not after the idle screen preload.
