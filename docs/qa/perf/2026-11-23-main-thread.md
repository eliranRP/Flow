# Where the main thread's time goes, 2026-11-23

The perf steward's profile for [FLOW-1274](../../backlog/tasks/FLOW-1274.md), decision [0271](../../decisions/0271-half-second-by-kept-data-and-one-wave.md) item 4: what a phone's main thread does during an in-app visit to each main screen and during a cold start of Home, so that the big costs can be cut. Numbers are from a production build served locally against the repo's invented-data stub backend; nothing here touches a real account.

## Summary

- A first visit to a main screen keeps the main thread busy for 0.33 to 0.88 s (medians of 3: Projects 0.51, the project page 0.88, Loans 0.60, Recurring 0.53, Profit month 0.51, year 0.33, by date 0.81, Review 0.66, Forecast 0.70). With the screen's data kept on the device, the same visit takes 0.28 to 0.71 s. Style, layout and paint are 17% to 38% of a first visit's busy time (Recurring 38%, Projects 36%, Profit month 17%), and React rendering the screen is the largest part of the rest.
- The biggest group is **React render and commit**: 164 to 446 ms inclusive on a first visit (Projects 320, the project page 446, Recurring 337, Review 342, Profit by date 312). Raising the number of rows adds time (about 5 ms for each Projects row and 9 ms for each Recurring row from a 10-against-40 comparison, with a wide spread between runs; see [Row counts](#row-counts)), since every row is drawn at once (FLOW-1282).
- The second group is **layout read while the page is built**: the hero figure fit (`readPad` 25 to 46 ms on Projects, the project page and Loans), the safe-area probe (`safeTop` 2 to 17 ms) and the scroll read in the first commit (7 to 100 ms; 100 ms on Recurring) each make the browser lay the page out again (FLOW-1281).
- **Dates built the slow way** cost 2 to 71 ms a visit in the per-screen tables (the project page 71 ms; 56 to 88 ms over 5 later runs, median 69), and 25 to 93 ms before Home's first read (median 42 ms over the 5 later runs; 81 ms in the first set's median run): `israelToday` built a new `Intl.DateTimeFormat` with a time zone on every call, about 0.37 ms each on the phone against 0.001 ms to format with a built one (method under [What was fixed here](#what-was-fixed-here)). Fixed in this PR.
- **Schema parsing (zod)** is small on the stub's small answers: 0 to 33 ms a visit. **The big answers were not measured** (the stub sends none of the 127 KB kind), so the forecast, next-month and profit math is not profiled yet (FLOW-1284).
- Cold Home's first read leaves at a median of 715 ms; the entry has been downloaded for 196 ms by then. The first read waits for the app's code to start (FLOW-1280). That is the idea FLOW-1116 built and the owner dropped on 2026-11-14: its inline early reads cut the first read from 801 to 234 ms, but the figures moved only from 1,489 to 1,429 ms, because the app's start-up was the bottleneck. So this profile does not claim the figures would show sooner by the time the first read moves.

## Method

**Build and server.** `vite build` with the perf stub's address (`VITE_SUPABASE_URL=http://127.0.0.1:43199`, as `app/playwright.perf.config.ts` and `scripts/load-report.mjs` do), with source maps on in a scratch build only, served gzipped by `scripts/serve-dist.mjs`. The stub is `app/perf/stub-backend.ts` (it signs the page in and answers every request to its address) with 85 ms added to each answer, plus larger invented answers for the dashboard (40 projects), projects cash, the recurring schedule (60 charges), expected months (60 parties), the review page (50 cards), the unpaid list (60 bills) and the loans tables (12 loans, each with two rate rows). Every other read gets the stub's default (`[]`).

**Where this was run.** In a scratch harness that is not in this PR: the committed stub (`app/perf/stub-backend.ts`) has no 85 ms delay and answers most reads with `[]`, and the larger invented answers above and the tracing script live only in the author's scratch directory. So these tables cannot be re-run from the repository as they stand. FLOW-1284 puts realistic answers into the committed stub and FLOW-1276 adds the sweep script, which together make the profile repeatable.

**The FLOW-804 phone.** Chromium 412 x 915 with touch, CPU 4x (`Emulation.setCPUThrottlingRate`), 85 ms latency, 9 Mbps down and 1.5 Mbps up (`Network.emulateNetworkConditions`).

**A visit.** Each run uses a new browser context: open Home, wait for the network to be idle and 1.5 s more, then `history.pushState` and `popstate` to the screen (as a tap does). "Kept data" repeats the visit in the same context, reloads Home, and visits again, so the second visit finds the screen's reads in the kept-data store (FLOW-1267). The recording starts just before the visit and covers the next 6 s, the window of the 2026-11-23 split. Each cell is the median run of 3.

**The trace.** `browser.startTracing` with the `devtools.timeline`, `v8.execute` and `disabled-by-default-v8.cpu_profiler` categories (the sampled CPU profile). Per category, the self time of the renderer main thread's trace events (style, layout and paint events, compile events, garbage collection). Per function, the profile's self time, mapped back to the source files with the source maps. "Inclusive" rows count a sample in the first group whose frames are on its stack: schema parsing if a zod frame is there, else React render and commit if a react-dom frame is, else our code outside React.

**What the numbers are not.**
- They are an upper bound on cost, as in the split: the whole 6 s window counts, including work after the screen settled.
- The profiler and the stub's request interception add native work to every total, so compare screens with one another, not the totals with the production numbers of the split.
- The machine was shared with other jobs (load average about 5 while the second set of runs went), so two runs of the same build differ by up to 40%. The totals before and after the fixes below are therefore not compared; the fixes are shown by their own functions' time.
- The stub's answers are small. Real companies have more rows, so row-driven costs (rendering, schema parse, schedule math) will be larger.

## Per-screen costs

All times are milliseconds on the phone profile. The first function rows are the top 10 by own time of the first visit, with the same function's time in the kept-data visit. Own time is the time in the function's own code, so a function that forces the browser to lay out the page shows the layout time too.

### Projects

`/projects`. 1 read on a first visit. Main thread over 3 runs: first visit 522, 507, 343 ms; kept data 369, 324, 357 ms. The rows below are the median run of each.

| Cost | First visit (ms) | Kept data (ms) |
| --- | ---: | ---: |
| Main thread, the 6 s window | 507 | 357 |
| Style, layout, paint | 185 | 148 |
| React render and commit, including the components' own code | 320 | 211 |
| Schema parsing (zod) | 6 | 3 |
| Our code outside React (queries, math, kept data) | 22 | 16 |
| Script parse and compile | 0 | 0 |
| Garbage collection | 8 | 9 |
| `readPad` in `ui/amount.tsx`, own time (hero figure fit: reads each ancestor's style) | 46 | 48 |
| `useLayoutEffect` in `ui/back.tsx`, own time (BackButton reads the scroll position in the first commit, which flushes the page layout) | 31 | 15 |
| `israelToday` in `ui/date-math.ts`, own time (builds an Intl.DateTimeFormat on every call (fixed here)) | 12 | 11 |
| `safeTop` in `ui/screen-header.tsx`, own time (safe-area probe on every header mount) | 10 | 7 |
| `anon@41` in `project-list.ts`, own time | 10 | 8 |
| `place` in `ui/segmented-control.tsx`, own time | 6 | 3 |
| `Amount` in `ui/amount.tsx`, own time | 5 | 2 |
| `formatUnsignedMinor` in `shared/money.ts`, own time | 4 | 0 |
| `ProjectCashRowItem` in `screens/projects-screen.tsx`, own time | 4 | 3 |
| `ProjectsScreen` in `screens/projects-screen.tsx`, own time | 3 | 0 |

### Project page

`/projects/<id>`. 19 reads on a first visit. Main thread over 3 runs: first visit 879, 993, 834 ms; kept data 709, 896, 651 ms. The rows below are the median run of each.

| Cost | First visit (ms) | Kept data (ms) |
| --- | ---: | ---: |
| Main thread, the 6 s window | 879 | 709 |
| Style, layout, paint | 173 | 156 |
| React render and commit, including the components' own code | 446 | 324 |
| Schema parsing (zod) | 27 | 12 |
| Our code outside React (queries, math, kept data) | 88 | 78 |
| Script parse and compile | 0 | 0 |
| Garbage collection | 16 | 11 |
| `israelToday` in `ui/date-math.ts`, own time (builds an Intl.DateTimeFormat on every call (fixed here)) | 71 | 57 |
| `readPad` in `ui/amount.tsx`, own time (hero figure fit: reads each ancestor's style) | 25 | 9 |
| `useLayoutEffect` in `ui/back.tsx`, own time (BackButton reads the scroll position in the first commit, which flushes the page layout) | 10 | 22 |
| `ProjectDetailScreen` in `screens/project-detail-screen.tsx`, own time | 8 | 4 |
| `safeTop` in `ui/screen-header.tsx`, own time (safe-area probe on every header mount) | 7 | 7 |
| `sizeOf` in `kept-reads.ts`, own time (kept data: size of each entry) | 4 | 0 |
| `return` in `lib/company-header.ts`, own time | 4 | 5 |
| `useNextMonthForecast` in `project-next-month-query.ts`, own time | 4 | 0 |
| `useProjectNextMonth` in `next-month-for-project.ts`, own time | 3 | 0 |
| `ProjectMenu` in `screens/project-menu.tsx`, own time | 3 | 0 |

### Loans

`/loans`. 5 reads on a first visit. Main thread over 3 runs: first visit 603, 508, 618 ms; kept data 389, 430, 371 ms. The rows below are the median run of each.

| Cost | First visit (ms) | Kept data (ms) |
| --- | ---: | ---: |
| Main thread, the 6 s window | 603 | 389 |
| Style, layout, paint | 147 | 94 |
| React render and commit, including the components' own code | 269 | 154 |
| Schema parsing (zod) | 0 | 0 |
| Our code outside React (queries, math, kept data) | 147 | 87 |
| Script parse and compile | 1 | 0 |
| Garbage collection | 13 | 10 |
| `readPad` in `ui/amount.tsx`, own time (hero figure fit: reads each ancestor's style) | 41 | 0 |
| `useLayoutEffect` in `ui/back.tsx`, own time (BackButton reads the scroll position in the first commit, which flushes the page layout) | 16 | 38 |
| `sizeOf` in `kept-reads.ts`, own time (kept data: size of each entry) | 16 | 9 |
| `israelToday` in `ui/date-math.ts`, own time (builds an Intl.DateTimeFormat on every call (fixed here)) | 14 | 12 |
| `safeTop` in `ui/screen-header.tsx`, own time (safe-area probe on every header mount) | 11 | 9 |
| `toJson` in `kept-reads.ts`, own time (kept data: JSON of each entry) | 10 | 4 |
| `powBig` in `shared/loan-schedule.ts`, own time (loan schedule math) | 8 | 5 |
| `put` in `kept-store.ts`, own time (kept data: store write) | 8 | 8 |
| `buildLoanSchedule` in `shared/loan-schedule.ts`, own time (loan schedule math) | 7 | 0 |
| `divHalfEven` in `shared/money.ts`, own time (loan schedule math) | 6 | 10 |

### Recurring

`/recurring`. 2 reads on a first visit. Main thread over 3 runs: first visit 532, 554, 366 ms; kept data 320, 522, 384 ms. The rows below are the median run of each.

| Cost | First visit (ms) | Kept data (ms) |
| --- | ---: | ---: |
| Main thread, the 6 s window | 532 | 384 |
| Style, layout, paint | 203 | 139 |
| React render and commit, including the components' own code | 337 | 205 |
| Schema parsing (zod) | 0 | 0 |
| Our code outside React (queries, math, kept data) | 20 | 17 |
| Script parse and compile | 0 | 0 |
| Garbage collection | 8 | 0 |
| `useLayoutEffect` in `ui/back.tsx`, own time (BackButton reads the scroll position in the first commit, which flushes the page layout) | 100 | 60 |
| `safeTop` in `ui/screen-header.tsx`, own time (safe-area probe on every header mount) | 11 | 10 |
| `on` in `ui/keyboard-inset.ts`, own time | 6 | 3 |
| `RecurringList` in `ui/recurring-list.tsx`, own time | 3 | 3 |
| `ListRow` in `ui/list-row.tsx`, own time | 3 | 4 |
| `Amount` in `ui/amount.tsx`, own time | 3 | 0 |
| `toRow` in `screens/recurring-screen.tsx`, own time | 3 | 0 |
| `israelToday` in `recurring-schedule.ts`, own time (builds an Intl.DateTimeFormat on every call (fixed here)) | 2 | 2 |
| `monthTitle` in `screens/recurring-screen.tsx`, own time | 2 | 1 |
| `useMemo` in `screens/recurring-screen.tsx`, own time | 2 | 0 |

### Profit, month

`/profit`. 10 reads on a first visit. Main thread over 3 runs: first visit 421, 508, 525 ms; kept data 340, 427, 400 ms. The rows below are the median run of each.

| Cost | First visit (ms) | Kept data (ms) |
| --- | ---: | ---: |
| Main thread, the 6 s window | 508 | 400 |
| Style, layout, paint | 86 | 79 |
| React render and commit, including the components' own code | 195 | 129 |
| Schema parsing (zod) | 17 | 12 |
| Our code outside React (queries, math, kept data) | 61 | 45 |
| Script parse and compile | 0 | 0 |
| Garbage collection | 5 | 0 |
| `israelToday` in `ui/date-math.ts`, own time (builds an Intl.DateTimeFormat on every call (fixed here)) | 14 | 18 |
| `useLayoutEffect` in `ui/back.tsx`, own time (BackButton reads the scroll position in the first commit, which flushes the page layout) | 13 | 8 |
| `CompanyProfitScreen` in `screens/company-profit-screen.tsx`, own time | 5 | 0 |
| `sizeOf` in `kept-reads.ts`, own time (kept data: size of each entry) | 3 | 0 |
| `useCompanyProfitRead` in `use-company-profit.ts`, own time | 2 | 1 |
| `return` in `lib/company-header.ts`, own time | 2 | 3 |
| `BackButton` in `ui/back.tsx`, own time | 2 | 0 |
| `safeTop` in `ui/screen-header.tsx`, own time (safe-area probe on every header mount) | 2 | 3 |
| `useOverheadProject` in `overhead-project.ts`, own time | 2 | 0 |
| `historyIndex` in `ui/back.tsx`, own time | 2 | 1 |

### Profit, year

`/profit?period=year`. 4 reads on a first visit. Main thread over 3 runs: first visit 327, 292, 379 ms; kept data 271, 437, 279 ms. The rows below are the median run of each.

| Cost | First visit (ms) | Kept data (ms) |
| --- | ---: | ---: |
| Main thread, the 6 s window | 327 | 279 |
| Style, layout, paint | 78 | 70 |
| React render and commit, including the components' own code | 164 | 127 |
| Schema parsing (zod) | 2 | 7 |
| Our code outside React (queries, math, kept data) | 24 | 21 |
| Script parse and compile | 0 | 0 |
| Garbage collection | 7 | 0 |
| `useLayoutEffect` in `ui/back.tsx`, own time (BackButton reads the scroll position in the first commit, which flushes the page layout) | 16 | 10 |
| `safeTop` in `ui/screen-header.tsx`, own time (safe-area probe on every header mount) | 11 | 12 |
| `israelToday` in `ui/date-math.ts`, own time (builds an Intl.DateTimeFormat on every call (fixed here)) | 11 | 6 |
| `useCompanyProfitRead` in `use-company-profit.ts`, own time | 5 | 0 |
| `SegmentedControl` in `ui/segmented-control.tsx`, own time | 3 | 0 |
| `queryFn` in `company-years-query.ts`, own time | 2 | 0 |
| `on` in `ui/keyboard-inset.ts`, own time | 2 | 2 |
| `useEffect` in `ui/screen-header.tsx`, own time | 2 | 0 |
| `SkeletonSwap` in `ui/skeleton.tsx`, own time | 1 | 0 |
| `CompanyProfitScreen` in `screens/company-profit-screen.tsx`, own time | 1 | 0 |

### Profit, by date

`/profit?by=date`. 14 reads on a first visit. Main thread over 3 runs: first visit 923, 684, 806 ms; kept data 541, 623, 518 ms. The rows below are the median run of each.

| Cost | First visit (ms) | Kept data (ms) |
| --- | ---: | ---: |
| Main thread, the 6 s window | 806 | 541 |
| Style, layout, paint | 144 | 78 |
| React render and commit, including the components' own code | 312 | 205 |
| Schema parsing (zod) | 33 | 24 |
| Our code outside React (queries, math, kept data) | 116 | 121 |
| Script parse and compile | 0 | 0 |
| Garbage collection | 15 | 0 |
| `useLayoutEffect` in `ui/back.tsx`, own time (BackButton reads the scroll position in the first commit, which flushes the page layout) | 35 | 10 |
| `israelToday` in `ui/date-math.ts`, own time (builds an Intl.DateTimeFormat on every call (fixed here)) | 29 | 11 |
| `safeTop` in `ui/screen-header.tsx`, own time (safe-area probe on every header mount) | 10 | 4 |
| `CompanyProfitScreen` in `screens/company-profit-screen.tsx`, own time | 8 | 3 |
| `agorotSchema` in `shared/dashboard.ts`, own time | 8 | 0 |
| `toJson` in `kept-reads.ts`, own time (kept data: JSON of each entry) | 7 | 1 |
| `useCompanyProfitRead` in `use-company-profit.ts`, own time | 7 | 0 |
| `ScreenHeader` in `ui/screen-header.tsx`, own time | 6 | 0 |
| `put` in `kept-store.ts`, own time (kept data: store write) | 5 | 1 |
| `on` in `ui/keyboard-inset.ts`, own time | 5 | 0 |

### Review

`/review`. 10 reads on a first visit. Main thread over 3 runs: first visit 662, 769, 615 ms; kept data 440, 452, 476 ms. The rows below are the median run of each.

| Cost | First visit (ms) | Kept data (ms) |
| --- | ---: | ---: |
| Main thread, the 6 s window | 662 | 452 |
| Style, layout, paint | 125 | 109 |
| React render and commit, including the components' own code | 342 | 222 |
| Schema parsing (zod) | 24 | 12 |
| Our code outside React (queries, math, kept data) | 89 | 63 |
| Script parse and compile | 0 | 0 |
| Garbage collection | 16 | 0 |
| `safeTop` in `ui/screen-header.tsx`, own time (safe-area probe on every header mount) | 17 | 12 |
| `reviewCountText` in `ui/review-count.tsx`, own time (toLocaleString on every call (fixed here)) | 15 | 3 |
| `ReviewQueue` in `screens/review-queue.tsx`, own time | 8 | 4 |
| `useLayoutEffect` in `ui/back.tsx`, own time (BackButton reads the scroll position in the first commit, which flushes the page layout) | 7 | 4 |
| `on` in `ui/keyboard-inset.ts`, own time | 5 | 7 |
| `ReviewScreen` in `screens/review-screen.tsx`, own time | 3 | 0 |
| `useMyCompaniesQuery` in `team-queries.ts`, own time | 3 | 0 |
| `ReviewSegments` in `ui/review-count.tsx`, own time | 3 | 0 |
| `jevQueueKey` in `screens/jev-connector-scope.ts`, own time | 3 | 0 |
| `Button` in `ui/button.tsx`, own time | 2 | 0 |

### Forecast

`/forecast`. 13 reads on a first visit. Main thread over 3 runs: first visit 679, 702, 801 ms; kept data 783, 698, 706 ms. The rows below are the median run of each.

| Cost | First visit (ms) | Kept data (ms) |
| --- | ---: | ---: |
| Main thread, the 6 s window | 702 | 706 |
| Style, layout, paint | 149 | 161 |
| React render and commit, including the components' own code | 202 | 102 |
| Schema parsing (zod) | 30 | 15 |
| Our code outside React (queries, math, kept data) | 78 | 147 |
| Script parse and compile | 0 | 0 |
| Garbage collection | 9 | 10 |
| `useLayoutEffect` in `ui/back.tsx`, own time (BackButton reads the scroll position in the first commit, which flushes the page layout) | 19 | 0 |
| `ForecastScreen` in `screens/forecast-screen.tsx`, own time | 11 | 2 |
| `safeTop` in `ui/screen-header.tsx`, own time (safe-area probe on every header mount) | 9 | 0 |
| `israelToday` in `ui/date-math.ts`, own time (builds an Intl.DateTimeFormat on every call (fixed here)) | 9 | 7 |
| `on` in `ui/keyboard-inset.ts`, own time | 5 | 3 |
| `return` in `lib/company-header.ts`, own time | 3 | 2 |
| `CompactBar` in `ui/compact-bar.tsx`, own time | 2 | 0 |
| `useEffect` in `ui/screen-header.tsx`, own time | 2 | 0 |
| `anon@165` in `kept-reads.ts`, own time | 2 | 0 |
| `toJson` in `kept-reads.ts`, own time (kept data: JSON of each entry) | 2 | 0 |

## Row counts

The same build, with the stub's lists cut to 10 rows (invented projects, charges, review cards) or left at 40 (the tables above used 40 projects, 60 charges and 50 cards). Main thread over 3 first visits each, in ms:

| Screen | 10 rows | 40 rows | Per row, from the medians |
| --- | --- | --- | ---: |
| Projects | 302, 411, 388 (median 388) | 630, 550, 321 (median 550) | 5.4 ms |
| Recurring | 250, 322, 290 (median 290) | 612, 330, 575 (median 575) | 9.5 ms |
| Review (control: one card at a time) | 553, 455, 555 (median 553) | 632, 523, 542 (median 542) | none |

The spread inside each cell is as large as the difference between the medians for Projects (321 to 630 ms at 40 rows), so the per-row figures are rough: they say rows matter, not how much. FLOW-1282 measures it again.

## Cold Home

Three cold loads on the profile above, with the stub backend (medians). Times are from the start of navigation in milliseconds.

| Moment | Median | Runs |
| --- | ---: | --- |
| The entry's request is sent (after the HTML arrives and is parsed) | 146 | 141 to 165 |
| The entry's first byte (85 ms latency, 203 KB gzipped JavaScript and 43 KB of CSS at 9 Mbps) | 504 | 487 to 509 |
| The entry has downloaded | 519 | 496 to 520 |
| The entry is compiled and run (module evaluation, 28 to 72 ms; compile 5 to 9 ms) | 521 to 590 | |
| The session is restored (`getSession`, the auth client's start) and `startHomeReads` runs: microtasks of 78 to 170 ms | 580 to 715 | |
| **The first `/rest/v1` request** (`cash_months`, then `get_dashboard` 3 to 5 ms later) | **715** | 607 to 758 |
| The next reads (`list_my_companies` and others, after React renders and the session is known) | about 1,100 | 945 to 1,154 |
| First contentful paint | 932 | 778 to 935 |

So the first read waits 196 ms (111 to 238) after the entry finishes. In that gap the profile (before the first read, median run of the first 3) shows 524 ms of main thread over the whole 715 ms: 91 ms in our code (81 ms of it in `israelToday`), 43 ms in supabase-js (the auth client's constructor and session recovery), 17 ms in react-query, 231 ms the profiler cannot place (the browser starting the page), and 142 ms for the rest: about 48 ms of native calls, 18 ms of bundle code the source maps do not cover, 18 ms of HTML parsing, 30 ms of style and layout, 10 ms of compile, and about 18 ms unattributed (these groups overlap a little, so the parts are approximate). `israelToday` was the single largest function: the first `Intl.DateTimeFormat` with a time zone loads the zone data and `defaultPeriod()` in `startHomeReads` was the first to ask for today. Over 5 further cold loads on the build before the fix it took 25 to 51 ms before the first read (median 42), and 25 to 93 ms over all 8 loads.

**What could start the first read sooner**
1. **Take the time-zone start-up off the path (done here).** `index.html`'s inline script now builds the formatter in the idle wait while the entry downloads (the main thread is idle between 146 and 500 ms), and `israelToday` reuses one formatter. The gap between the entry finishing and the first read fell from a median of 196 ms to 85 ms (101, 78, 85 against 111, 196, 238 over 3 runs each), and in 5 further runs each from 104 ms to 67 ms (the first read at a median of 656 against 568 ms after navigation, `israelToday` gone from the path), so the first read leaves 90 to 110 ms sooner. **Only the time the first read leaves was measured**, not when the figures show: by FLOW-1116's finding the figures may not move by that much, and `load-report`'s Home ready (7 paired runs) moved from 1,236 to 1,259 ms, which is within noise (the branch was slower in 3 of 7 pairs).
2. **Send the first two reads from the inline script, before the entry arrives (FLOW-1280).** The reads need only the saved session's token, the project URL and key and the date; none needs the entry's code. They could leave at about 150 to 200 ms after navigation instead of 715 ms. **This is FLOW-1116 again**, which the owner dropped on 2026-11-14 after building it: the first read left 567 ms sooner (801 to 234 ms) but the figures showed only 60 ms sooner (1,489 to 1,429 ms), because they waited for the app's code, and the owner chose to shrink Home's start-up instead. FLOW-1280 is therefore a plan-first task that needs the owner's go, and is judged by when the figures show, not by when the read leaves.
3. **Skip the auth client for the token (part of FLOW-1280).** `startHomeReads` waits for `getSession` only to learn whether there is a session; the first read does not need the client's recovery work (43 ms of supabase-js and the microtask wait).
4. **A smaller entry.** Each 10 KB gzipped is about 9 ms of download at 9 Mbps plus about 3 ms of parse. The entry (JavaScript and CSS) is 246.1 KB of the 248 KB budget, so any new code that Home needs delays the first read directly; the sheet and screen code stay lazy.

## What was fixed here

Small, with nothing a user sees changed.
- `israelToday` (`ui/date-math.ts`) builds one `Intl.DateTimeFormat` instead of one per call, and the duplicate in `recurring-schedule.ts` is gone (its two callers import from `ui/date-math`).
- `reviewCountText` (`ui/review-count.tsx`) uses one `Intl.NumberFormat` instead of `toLocaleString` per call.
- `index.html` warms the same formatter while the entry downloads (above).

**Method for the formatter's cost.** In a bare page (`about:blank`) at CPU 4x, in a new context each time. The first `new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(date)` took 41.1, 55.1, 41.3, 41.2 and 30.5 ms over 5 contexts (30 to 55 ms: the zone data loading). After it, a loop of 200 calls that each built a formatter took 0.372 ms a call; 200 calls on one built formatter took 0.001 ms a call. These came from a scratch script, not committed.

**After the fix, the touched functions** (own time in ms, 5 cold first visits each on the build before the fix and on this branch, the median in bold; the same scratch harness; the machine was shared, which moves totals but not these small figures much):

| Function, screen | Before (5 runs) | After (5 runs) |
| --- | --- | --- |
| `israelToday`, project page | 88, 80, 56, 69, 58 (**69**) | 3.7, 1.9, 3.3, 2.3, 3.3 (**3.3**) |
| `israelToday`, Projects | 16, 9, 12, 19, 6 (**12**) | 1.4, 0.9, 0.5, 1.8, 0.9 (**0.9**) |
| `israelToday`, Loans | 9, 8, 12, 13, 9 (**9**) | 0.8, 1.2, 1.1, 1.2, 0 (**1.1**) |
| `reviewCountText`, Review | 11, 9, 8, 10, 11 (**9.5**) | 0, 1.5, 1.3, 1.3, 4.4 (**1.3**) |
| `israelToday`, before Home's first read | 43, 25, 51, 38, 42 (**42**) | not in the profile in any of 5 runs |

## Costs filed as tasks

| Task | Cost | Measured |
| --- | --- | --- |
| [FLOW-1280](../../backlog/tasks/FLOW-1280.md) (plan first) | Cold Home's first read waits for the app's code (the idea of FLOW-1116, dropped by the owner) | the first read leaves 196 ms after the entry finishes; FLOW-1116 measured the figures at only 60 ms sooner |
| [FLOW-1281](../../backlog/tasks/FLOW-1281.md) | Layout read while the page is built (`readPad`, `safeTop`, the first commit) | 60 to 100 ms a visit on Projects, Loans, Recurring |
| [FLOW-1282](../../backlog/tasks/FLOW-1282.md) | Projects and Recurring draw every row at mount | about 5 ms a Projects row and 9 ms a Recurring row, rough ([Row counts](#row-counts)) |
| [FLOW-1283](../../backlog/tasks/FLOW-1283.md) | Loan schedules built for every loan at list read | about 21 ms with 12 loans (`powBig` 8, `buildLoanSchedule` 7, `divHalfEven` 6) |
| [FLOW-1284](../../backlog/tasks/FLOW-1284.md) | The big answers are not in the stub, so the forecast and profit math and large schema parses are unmeasured | |

Not filed:
- **Kept data's own cost** (`sizeOf`, `toJson` and `put` in `kept-reads.ts` and `kept-store.ts`): 25 to 35 ms on the Loans visit and 4 to 15 ms elsewhere on a first visit, where it measures each answer and writes it. The files belong to the FLOW-1267 line of work, so the owner of that line should look (for example, write after the screen settles and size by the response's length).
- **Zod parse of the small answers** (0 to 33 ms): nothing to cut on this data. FLOW-1273 moves the read-schemas chunk earlier.

## Bundle room

The budget sat at 739.6 of 740 KB (all JavaScript) and 246.1 of 248 KB (Home entry) when this started, and main (abe335b) is at 739.88 KB (757,634 bytes). This branch is at 739.97 KB (757,727 bytes, 33 bytes under the limit) and 246.1 KB for the entry: the shared formatters added about 160 bytes, and three exact duplicate helpers were removed to bring it back under (`reducedMotion` in `fold.tsx` and `dock-filter.tsx` now import the one in `period-swipe.tsx`, and `utility-refund-view.ts` imports `daysBetween` from `recurring-schedule.ts`). **It did not free the 3 KB that was asked for**: every way found that frees that much changes what loads when or what a library does, so each is reported here instead of done.

Measured with the same build (all JavaScript, gzip of each file as the budget counts it):

| Option tried | All JavaScript | Home entry | Why it was not kept |
| --- | ---: | ---: | --- |
| Group small modules that 5 or more screens share into one chunk (rolldown `codeSplitting.groups`, `includeDependenciesRecursively: false`) | 739.6 to 732.5 KB (`minShareCount` 3 and `maxModuleSize` 8000: 718.5) | about -0.8 | The group chunk and the screens' chunks import each other, which breaks the build's execution order: the app failed on load with "not a constructor" in zod. With zod's modules left out it loads, but the chunk graph still has a cycle, and only 738.5 KB remains |
| The same with `strictExecutionOrder: true` | 779.9 KB | 253.1 | The wrappers cost 40 KB |
| `build.minify: 'terser'`, with and without 3 passes | 746.5 and 742.9 KB | 249.8 and 247.5 | Larger than the default minifier |
| Stub auth-js's `GoTrueAdminApi` (only `signOut` is called) | -0.7 KB | -1.1 | A sign-out stub must reuse auth-js's request and error classes, which sit under pnpm's private path; a copy would drift from the library |
| Stub zod's English error texts (`locales/en.js`) | -0.4 KB | 0 | Changes the text of every failed parse |
| `build.modulePreload.polyfill: false` | +0.1 KB | -0.2 | Nothing |

What else was checked and found clean: exact duplicate helpers were about 1.2 KB of source in all (the three above were removed), no unused export or dead CSS, no library at two versions, no dev, demo or story file in the production build apart from the loan sample below, no Hebrew text escaped in the JavaScript, and the global stylesheet has no rule that only stories or tests need.

Where the room is, for whoever builds next:
- **Home entry CSS, about 13 KB gzipped.** `29-loan-detail.css` (4.3 KB gzipped), `13-line-split.css` (3.3), `28-forecast.css` (2.7), `16-transaction.css` (3.4) and `48-invite.css` (2.4) are global but style mostly one on-demand screen each; the entry modules mention only 4 to 10 of their classes, and those are shared classes (`ui-btn`, `ui-band`, `ui-num`, `ui-field`). FLOW-974 left them global because their rules must keep their place in the cascade. A rule-level split, with the story style check, could move most of it to `lazy.css`; it is a UI-lane change (shared CSS files are hot spots) and was not done here. The smaller whole files that no later global file mentions (`30-prompt-card`, `43-counted-in`, `52-notifications`) are 0.4 KB gzipped together.
- **`dev/loan-detail-sample.ts`** (5.4 KB raw, about 1.7 KB gzipped) ships in production for `?preview=1` on the loans screens. It is a chunk of its own, only loaded in preview, so it counts against the total but not the entry. Dropping it from production changes what a reviewer sees in preview, which is the owner's call.
- **`screen-loaders.ts`** (a protected file for this task): its `import()` thunks and the build's preload table carry every chunk's file name, about 2.4 KB gzipped in the entry (the names' hashes do not compress). Fewer, larger lazy chunks shrink it and every chunk's gzip overhead (65 of the 196 chunks are under 1 KB gzipped); that needs a chunking change that keeps the chunk graph acyclic.
