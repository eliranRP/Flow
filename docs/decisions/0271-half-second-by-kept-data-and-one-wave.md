# Half a second by kept data, background reads and one wave per screen

**Date:** 2026-11-23
**Status:** Accepted (owner, 2026-11-23: "Yes, with a small hint" to showing a screen's last data at once, and "Yes, main screens" to reading the main screens in the background after Home). Items 1 and 2 of the decision are the owner's choices; items 3 and 4 are the perf steward's plan for meeting 0230, inside 0230's own rule that speed work never changes what a screen shows.
**Amends:** [0230](0230-screens-data-in-half-a-second.md)

## Context

[0230](0230-screens-data-in-half-a-second.md) asks every screen to show its data within 0.5 s on the FLOW-804 phone (CPU 4× slower, 4G). After a month of trims no screen meets it. The perf steward's split of an in-app visit on 2026-11-23, production `36cb136`, is below; the runs, the method and why its times are later than the same day's [daily report](../qa/perf/2026-11-23.md) are in [2026-11-23-split.md](../qa/perf/2026-11-23-split.md). It gives the median of 3 visits each. "Settled" is no skeleton and the page stopped changing, the stricter end of 0230's "screen ready"; the daily report's earlier times are the first figures drawn. "Main thread" is the CPU work in the visit window, an upper bound. "Network busy" is the union of the visit's request times.

| Screen | Settled | Main thread | Network busy | Request waves | Requests |
| --- | ---: | ---: | ---: | ---: | ---: |
| Projects | 0.83 s | 0.54 s | 0.63 s | 1 | 2 |
| Project page | 1.97 s | 0.92 s | 1.90 s | 3 | 28 |
| Loans | 1.11 s | 0.83 s | 0.91 s | 1 | 10 |
| Recurring | 0.74 s | 1.10 s | 0.42 s | 1 | 2 |
| Profit, month | 2.08 s | 1.00 s | 1.61 s | 2 | 20 |
| Profit, year | 1.92 s | 0.97 s | 1.33 s | 2 | 12 |
| Profit, by date | 2.06 s | 1.15 s | 1.71 s | 2 | 26 |
| Review | 1.65 s | 0.68 s | 1.42 s | 3 | 27 |
| Forecast | 0.85 s | 0.86 s | 0.54 s | 1 | 4 |

Cold Home shows its data at 3.2 s, and its first read leaves about 0.8 s after navigation start, before any network wait.

The database is not the limit: each read answers in 155 to 382 ms (median, 10 calls), and the slowest function takes about 140 ms in the database.

The time goes to three things:
1. **Round trips in waves.** A later read waits for an earlier one's answer through `enabled`, for first paint (`useAfterFirstPaint`), or for a component that mounts after data.
2. **Many reads per screen.** They share the 4G pipe.
3. **Browser work.** Parsing, the forecast and loan-schedule math (for example the 127 KB `company_next_month_inputs`), and drawing, all on a CPU 4× slower.

One round trip on this profile costs about 0.4 to 0.6 s before anything is drawn: Recurring's one read keeps the network busy 0.42 s and Projects' two reads 0.63 s, both in a single wave. So a screen that must fetch before it draws cannot reach 0.5 s, however fast its queries are.

## Decision

1. **Kept data.** The app keeps the main screens' reads on the device.
   - **What is kept:** an allowlist of query keys, for the signed-in user and the shown company. Entries older than 7 days are not used.
   - **Where:** IndexedDB, cleared on sign-out. Each restored entry is checked against its read schema, and one that fails is dropped.
   - **Opening a screen:** it draws the kept data at once and reads fresh data in the background. While the fresh read is in flight, a small hint says the figures are updating. When the fresh data lands, the screen updates in place.
2. **Background reads.** Once Home has settled and the phone is idle, the app reads the main screens' first-view data once per session: Projects, Loans, Recurring, Profit (month), Review's first page and Forecast. It skips this when the browser asks to save data (`navigator.connection.saveData`) or the connection is 2G.
3. **One wave per screen.** A screen's first-view reads all start when the screen is opened. Nothing in the first view waits for another read's answer, for first paint, or for a code chunk that loads after data. Reads for below the fold, a sheet or a later tap can still wait.
4. **Less browser work.** The perf steward profiles each screen's main thread on the phone and cuts the largest costs. Moving the forecast, loan-schedule and profit math into the database, and adding summary tables kept current on write, is a separate plan. It needs the owner's approval before any build (FLOW-1275).

How 0230 is measured changes. Home and every main screen (Projects, the project page, Loans, Recurring, Profit in month, year and by date, Review, Forecast) have three times, each from its own state:
- **Data shown** (the gate, held to 0.5 s): a repeat visit, with the screen's kept data on the device from a visit earlier in the run. Every first-view figure is drawn (kept or fresh) and no skeleton is left; a header alone does not count.
- **Fresh data shown:** the same visit, until every first-view read has answered, its answer is drawn, and the page has stopped changing. It is taken from the reads themselves (the last first-view response and the next quiet frame), not from the hint.
- **First visit:** an empty kept-data store and no background reads, as 0230 measured before.

The last two are reported beside the gate every day, with the same regression rule as 0230: either one more than 10% slower than the last report is a regression for the perf steward to fix. The one-wave and browser-work tasks drive them down, so kept data never hides a slow read.

## Alternatives rejected

- **Only faster reads and fewer of them:** one round trip plus drawing on the phone profile already costs more than 0.5 s.
- **Showing the kept data with no hint:** the owner chose a hint, so changing figures are not a surprise.
- **Never showing older data:** a screen that has to fetch first cannot get under about 0.6 to 0.8 s.
- **Reading screens only on touch:** a 100 to 200 ms head start is not enough on its own. It stays for the project page (`PrefetchProjects`).
- **Moving all the math to the server first:** that is the largest change, with the most risk to the figures, and kept data plus one wave come first.

## Consequences

- Figures can change about a second after a screen opens, under the hint. A kept entry is at most 7 days old, and only for the same user and company.
- Financial figures are stored on the device, as the project reads in localStorage already are (FLOW-804, `project-cache.ts`; FLOW-1267 replaces that cache). They are cleared on sign-out.
- **Cost:** about 20 more reads per session: the first-view reads of the six screens that Home's own reads do not already hold (the Requests column counts every request of a visit, waves and repeats included). The database answers each in about 140 ms or less, and the plan's monthly price does not change, so [0034](0034-cost-and-load-limits.md)'s $5 cap holds.
- **Tasks:**
  - the sweep script that reports the three times (FLOW-1276);
  - kept data (FLOW-1267) and the updating hint (FLOW-1268, a UI task with a design session);
  - background reads (FLOW-1269);
  - one wave on the project page (FLOW-1270), Profit (FLOW-1271) and Review (FLOW-1272);
  - code chunks loaded before data, not after (FLOW-1273);
  - main-thread profiling (FLOW-1274);
  - the server-side plan (FLOW-1275, plan first).
