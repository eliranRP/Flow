import { defineMachine } from "../../../../../packages/shared/src/machine.ts";

/**
 * One SUMIT pull of a documents window, across runs (FLOW-1163, decision 0266). A run lists at most
 * SUMIT_PAGE_CAP pages. A window with more pages used to fail every run with `sync_page_cap`; now each
 * run stores what it listed and records where to continue (`settings.pull`, pull_state.ts).
 * - `fresh`: no pull in progress. The next run lists from the first page.
 * - `resuming`: a run stored its pages and left a continuation. The next run continues there.
 * - `once` / `twice`: the last 1 or 2 runs in a row did not move the continuation (the list shifted
 *   under it, so the run started over and ended where the earlier one did).
 * - `stuck`: 3 runs in a row did not move it (the owner's rule for Mercury, FLOW-1162: stop after 3).
 *   The cron and an unforced run skip the connection and `sync_page_cap` shows, as it did before; the
 *   owner's own forced refresh still tries. A run that moves the continuation, or finishes, ends it.
 * - `complete`: a run listed the window to its end and leaves no pull. It stamps the sync. It sweeps only
 *   when the window took that one run; a window that took more never sweeps.
 * Events: `capped` (a run stopped at the page cap with the continuation moved on), `repeated` (it
 * stopped with the continuation where it was), `finished` (the window's last page was listed).
 */
export const sumitPull = defineMachine({
  name: "sumitPull",
  initial: "fresh",
  final: ["complete"],
  states: {
    fresh: { capped: "resuming", finished: "complete" },
    resuming: { capped: "resuming", repeated: "once", finished: "complete" },
    once: { capped: "resuming", repeated: "twice", finished: "complete" },
    twice: { capped: "resuming", repeated: "stuck", finished: "complete" },
    stuck: { capped: "resuming", finished: "complete" },
    complete: {},
  },
});

export type SumitPullState = keyof typeof sumitPull.states;
export type SumitPullEvent = "capped" | "repeated" | "finished";

/** Runs in a row that left the continuation where it was, per state a pull is stored in. */
export const PULL_REPEATS: Readonly<Record<"resuming" | "once" | "twice" | "stuck", number>> = {
  resuming: 0,
  once: 1,
  twice: 2,
  stuck: 3,
};
