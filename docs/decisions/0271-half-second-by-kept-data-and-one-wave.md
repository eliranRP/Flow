# Half a second by kept data, background reads and one wave per screen

**Date:** 2026-11-23
**Status:** Accepted (owner, 2026-11-23: "Yes, with a small hint" to showing a screen's last data at once, and "Yes, main screens" to reading the main screens in the background after Home). Items 1 and 2 are the owner's choices (their mechanics, such as IndexedDB, the 7 days, the allowlist and the save-data skip, are the steward's design); items 3 and 4 are the perf steward's plan for meeting 0230, inside 0230's own rule that speed work never changes what a screen shows.
**Amends:** [0230](0230-screens-data-in-half-a-second.md)

## Context

[0230](0230-screens-data-in-half-a-second.md) asks every screen to show its data within 0.5 s on the FLOW-804 phone (CPU 4× slower, 4G). After a month of trims no screen meets it. The perf steward's split of an in-app visit on 2026-11-23, production `36cb136`, is below; the runs, the method and how its times compare with the same day's [daily report](../qa/perf/2026-11-23.md) are in [2026-11-23-split.md](../qa/perf/2026-11-23-split.md). Settled, main thread and network busy are medians of 3 visits each; waves and requests (and the split's KB) are from one run. "Settled" is 0230's "screen ready" (no skeleton or busy marker, and the page stopped changing); the daily report's "data shown" column (the first figures, or no skeleton) is earlier or about the same. "Main thread" is the CPU work in the visit window, an upper bound. "Network busy" is the union of the visit's request times.

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

Cold Home shows its data at a median of 3.25 s (5 loads on `36cb136`, the split's "Home" section; 3.49 s in the daily report on `dc189b8`), and its first read leaves about 0.8 s after navigation start, before any network wait.

The database is not the limit: each read's round trip from the measuring machine has a median of 155 to 382 ms (`pnpm latency`, 10 calls each; the split's "Round trips" section), and the slowest function takes about 140 ms in the database itself.

The time goes to three things:
1. **Round trips in waves.** A later read waits for an earlier one's answer through `enabled`, for first paint (`useAfterFirstPaint`), or for a component that mounts after data.
2. **Many reads per screen.** They share the 4G pipe.
3. **Browser work.** Parsing, the forecast and loan-schedule math (for example the 127 KB `company_next_month_inputs`), and drawing, all on a CPU 4× slower.

A wave of reads on this profile keeps the network busy about 0.4 to 0.65 s before anything is drawn: Recurring's one wave 0.42 s, and Projects' one wave of two reads 0.63 s (the split's network-busy column). So a screen that must fetch before it draws cannot reach 0.5 s, however fast its queries are.

## Decision

1. **Kept data.** The app keeps the main screens' reads on the device.
   - **What is kept:** an allowlist of query keys, for the signed-in user and the shown company. Entries older than 7 days are not used.
   - **Where:** IndexedDB, cleared on sign-out. Each restored entry is checked against its read schema, and one that fails is dropped.
   - **Opening a screen:** it draws the kept data at once and reads fresh data in the background. While the fresh read is in flight, a small hint says the figures are updating. When the fresh data lands, the screen updates in place.
2. **Background reads.** Once Home has settled and the phone is idle, the app reads the main screens' first-view data once per session: Projects, Loans, Recurring, Profit (month), Review's first page and Forecast. That list is the perf steward's reading of the owner's "main screens": the project page already reads on touch (`PrefetchProjects`), and Profit's year and by-date views are read when chosen. The owner can widen it. It skips this when the browser asks to save data (`navigator.connection.saveData`) or the connection is 2G.
3. **One wave per screen, within the owner's earlier orders.** A screen's first-view reads all start when the screen is opened: nothing in the first view waits for another read's answer or for a code chunk that loads after data. Two orders the owner chose stay: Home's forecast cards load after Home first appears (FLOW-1019, owner 2026-11-03), and Profit's next-month card reads after its figures are drawn (FLOW-1080, owner 2026-11-07, "Keep it", measured: figures at a median 964 ms against 1,428 ms). With kept data those cards draw at once anyway; changing either order needs the owner's go with a measurement. The project page's forecast card also waits for the page's own read today; that wait is the perf steward's earlier measured choice, not an owner order, and FLOW-1270 moves it to mount only if the page's first figure does not get later. Reads for below the fold, a sheet or a later tap can still wait.
4. **Less browser work.** The perf steward profiles each screen's main thread on the phone and cuts the largest costs. Moving the forecast, loan-schedule and profit math into the database, and adding summary tables kept current on write, is a separate plan. It needs the owner's approval before any build (FLOW-1275).

How 0230 is reported changes; its 0.5 s target and its regression rule stay as they are. Home and every main screen (Projects, the project page, Loans, Recurring, Profit in month, year and by date, Review, Forecast) have three times, each from its own state:
- **Data shown:** a repeat visit, with the screen's kept data on the device from a visit earlier in the run. Every first-view figure is drawn (kept or fresh) and no skeleton is left; a header alone does not count.
- **Fresh data shown:** the same visit, until every first-view read has answered, its answer is drawn, and the page has stopped changing. It is taken from the reads themselves (the last first-view response and the next quiet frame), not from the hint.
- **First visit:** an empty kept-data store and no background reads, as 0230 measured before.

Cold Home, 0230's third measure, keeps its 0.5 s target and reports the same three times: data shown when the app opens with Home's kept data on the device, fresh data shown when Home's reads have answered, and first visit with an empty store (as `load-report` and the steward's cold loads measure today). Its first read leaves about 0.8 s after navigation start today, so cold Home needs the start-up work (FLOW-1274 profiles it) as well as kept data.

All three are held to 0.5 s, and the daily report marks each one over it; 0230's rule applies to each (slower than 0.5 s, or more than 10% slower than the last report, is a regression for the perf steward). Data shown is the one kept data can bring under 0.5 s first; fresh data shown and first visit come down with the one-wave and browser-work tasks, so kept data never hides a slow read. No report has these times yet: the first FLOW-1276 sweep sets the baseline of all three.

## Alternatives rejected

- **Only faster reads and fewer of them:** one round trip plus drawing on the phone profile already costs more than 0.5 s.
- **Showing the kept data with no hint:** the owner chose a hint, so changing figures are not a surprise.
- **Never showing older data:** a screen that has to fetch first does not get under 0.5 s; the quickest one-wave screens settle at 0.74 s (Recurring) to 0.85 s (Forecast) in the split.
- **Reading screens only on touch:** a 100 to 200 ms head start is not enough on its own. It stays for the project page (`PrefetchProjects`).
- **Moving all the math to the server first:** that is the largest change, with the most risk to the figures, and kept data plus one wave come first.

## Consequences

- Figures can change about a second after a screen opens, under the hint. A kept entry is at most 7 days old, and only for the same user and company.
- Financial figures are stored on the device, as the project reads in localStorage already are (FLOW-804, `project-cache.ts`; FLOW-1267 replaces that cache). They are cleared on sign-out.
- **Cost:** the background reads are the first-view reads of six screens (Projects, Loans, Recurring, Profit in its default month view, Review's first page and Forecast; not Profit's year or by-date views), less those Home already holds. An estimate from the split, one run per screen of each whole visit after Home: about 65 requests and 111 KB per session, that is per app open (Projects 2, Loans 10, Recurring 2, Profit month 20, Review 27, Forecast 4 requests; 2 + 12 + 1 + 41 + 52 + 3 KB on the wire). Those visits also hold repeats and below-the-fold reads that the background reads skip, so the background reads are likely fewer. FLOW-1269 measures the exact count and size when it ships.
  - **Database time:** each read takes at most about 140 ms in the database.
  - **Price:** the pilot runs on Supabase Free ([0037](0037-supabase-pilot.md)), with an egress limit of 3 GB a month. 111 KB a session uses that limit up at roughly 27,000 sessions a month (decimal units), before today's own traffic. Crossing it means the move to Pro, $25 a month (about $27 once usage grows, 0037), which is over [0034](0034-cost-and-load-limits.md)'s $5 cap. The perf steward reports the project's monthly egress in the daily report once the background reads ship, and asks the owner before the background reads go on past half the limit.
- **Tasks:**
  - the sweep script that reports the three times (FLOW-1276);
  - kept data (FLOW-1267) and the updating hint (FLOW-1268, a UI task with a design session);
  - background reads (FLOW-1269);
  - one wave on the project page (FLOW-1270), Profit (FLOW-1271) and Review (FLOW-1272);
  - code chunks loaded before data, not after (FLOW-1273);
  - main-thread profiling (FLOW-1274);
  - the server-side plan (FLOW-1275, plan first).
