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
- The output is a table of medians with every run's values, or JSON with `--json`. How each time is taken is in the script's header comment.
