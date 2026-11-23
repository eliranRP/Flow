# Perf reports

The daily reports (`YYYY-MM-DD.md`) and the perf steward's splits live here. Decision [0271](../../decisions/0271-half-second-by-kept-data-and-one-wave.md) sets the three times each screen is held to (data shown, fresh data shown, first visit), and the method is in [2026-11-23-split.md](2026-11-23-split.md).

## Screen sweep

`scripts/screen-sweep.mjs` (FLOW-1276) measures the three times for Home and every main screen on the FLOW-804 phone (CPU 4×, 85 ms latency, 9/1.5 Mbps, 412×915), 3 runs per state, each in a fresh browser. It also prints the main-thread time, network busy, request waves, request count and KB of each visit.

```sh
pnpm sweep <base-url> <session-file> --project <project-id> [--runs 3] [--only home,projects] [--json]
```

- `<base-url>` is the app to measure (production, or a local production build with the stub backend, see `app/perf`). The arguments can be env vars: `FLOW_SWEEP_URL`, `FLOW_SWEEP_SESSION`, `FLOW_SWEEP_PROJECT`. `FLOW_CHROMIUM_PATH` picks the browser. `FLOW_SWEEP_SUPABASE_URL` names the backend when it is not the one in `app/.env.production` (the stub).
- `<session-file>` is a Supabase session JSON (`access_token`, `refresh_token`) for a test user that the person running the sweep already has, for example from signing that user in once and saving the session from the browser's storage. The script never mints a session and never prints it. Keep the file out of the repo, and use a session whose access token has more than 15 minutes left. Never commit one.
- `--project` is the id of a project in that user's company; without it the project page is skipped.
- Each time is taken from its own state, so "data shown" is the first frame where the location is the target (path and query), the screen's marker below is in the DOM, and no skeleton or busy element is. No skeleton alone is not enough, because a screen's code can load with the old screen still up and a skeleton shows only after 300 ms. "First visit" loads the screen's URL directly as the first page load of a fresh context, timed from navigation start, and the table's "Reads before" column must be 0 for it. "Fresh data shown" is the first DOM change after the last read's response, then the next quiet 100 ms; it is a dash when the visit starts no read.
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
