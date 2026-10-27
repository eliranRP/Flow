<a id="flow-974"></a>
# FLOW-974 · Each lazy screen's styles load with its chunk
- **Type:** SMALL CYCLE · **Status:** in-progress · **Depends on:** — · **Source:** the owner's card on 2026-10-27, when main went red on the size budget after the v2 screens (243.7/241 KB Home entry, 580.8/580 KB all JavaScript): raise to 246 / 600 KB now, and take the real trim as its own task.
- [ ] The one global stylesheet (47.2 KB gzip, all of it in Home's entry) keeps only what Home and the shell draw. Each lazy screen's CSS files (`app/src/ui/css/*.css` used by one screen only) are imported by that screen's chunk, so Vite emits them with it.
- [ ] No flash of unstyled content: a screen's CSS arrives with its JavaScript, before it renders.
- [ ] Measure the Home entry before and after, and lower `homeEntryGzipKB` in `scripts/bundle-budget.json` to just over the new size, with the reason.
- **Acceptance:** `pnpm check:bundle` passes with the lower limit; story shots and e2e unchanged.
