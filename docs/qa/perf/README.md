# Perf reports

The daily reports (`YYYY-MM-DD.md`) and the perf steward's splits live here. Decision [0271](../../decisions/0271-half-second-by-kept-data-and-one-wave.md) sets the three times each screen is held to (data shown, fresh data shown, first visit), and the method is in [2026-11-23-split.md](2026-11-23-split.md).

## Screen sweep

`scripts/screen-sweep.mjs` (FLOW-1276) measures the three times for Home and every main screen on the FLOW-804 phone (CPU 4×, 85 ms latency, 9/1.5 Mbps, 412×915), 3 runs per state, each in a fresh browser. It also prints the main-thread time, network busy, request waves, request count and KB of each visit.

```sh
pnpm sweep <base-url> <session-file> --project <project-id> [--runs 3] [--only home,projects] [--json]
```

- `<base-url>` is the app to measure (production, or a local production build with the stub backend, see `app/perf`). The arguments can be env vars: `FLOW_SWEEP_URL`, `FLOW_SWEEP_SESSION`, `FLOW_SWEEP_PROJECT`. `FLOW_CHROMIUM_PATH` picks the browser. `FLOW_SWEEP_SUPABASE_URL` names the backend when it is not the one in `app/.env.production` (the stub).
- `<session-file>` is a Supabase session JSON (`access_token`, `refresh_token`) for a test user that the person running the sweep already has, for example from signing that user in once and saving the session from the browser's storage. The script never mints a session and never prints it. Keep the file out of the repo, and use a session whose access token outlasts the sweep: the script estimates its duration (90 seconds per screen per run, plus 5 minutes: about 50 minutes for the full set of 10 screens at 3 runs, inside a one-hour access token; a page that never goes network-idle can take longer, so split the run with `--only` if one does) and exits 2 if the token has less left, because every context seeds the same token and a refresh from many contexts can sign later runs out. Never commit one.
- `--project` is the id of a project in that user's company; without it the project page is skipped.
- Each time is taken from its own state, so "data shown" is the first frame (kept, a later skeleton does not move it) where the location is the target (path and query), the screen's marker below is in the DOM, and no skeleton or busy element is. No skeleton alone is not enough, because a screen's code can load with the old screen still up and a skeleton shows only after 300 ms. "First visit" loads the screen's URL directly as the first page load of a fresh context, timed from navigation start; the fresh context is what guarantees an empty store. "Reads before" (REST reads started before the tap) is printed for in-app repeat visits only. "Fresh data shown" is the first DOM change after the last read's response, then on through changes less than 100 ms apart (if no DOM change follows the last response, it is that response's time); it does not depend on data shown, and is a dash only when the visit starts no read or a read has not answered in the window.
- The output is a table of medians with every run's values, or JSON with `--json`. How each time is taken is in the script's header comment.

### Markers of drawn figures

A selector that matches only once the screen's first-view figures are drawn (the hero amount, or the empty state when the screen has nothing). They are the `marker` of each screen in `scripts/screen-sweep.mjs`; change both together when a screen's markup changes.

| Screen | Marker |
| --- | --- |
| Home (cold) | `.ui-band-body .ui-num` |
| Projects | `.ui-projects-page .ui-project-profits .ui-num` |
| Project page | `.ui-project-cash .ui-project-profits .ui-num` |
| Loans | `.ui-loans-band-figure .ui-num`, or `.ui-loans-screen .ui-empty-state` |
| Recurring | `.ui-recurring-sum-figure`, or `.ui-recurring-body .ui-empty-state` |
| Profit (month, year, by date) | `.ui-cp-figure .ui-num` |
| Review | `.ui-review-motion`, or `.ui-review-queue .ui-empty-state` |
| Forecast | `.ui-forecast-section-total`, or `.ui-forecast-empty` |
