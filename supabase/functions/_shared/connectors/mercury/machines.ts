import { defineMachine } from "../../../../../packages/shared/src/machine.ts";

/**
 * The phases of one Mercury fetch, in the order they run (decision 0266): the posted window,
 * the pending list, the treasury ledgers, then done. A page cap stores the phase it stopped in
 * (`MercuryCursorPhase`), and the next run starts there and runs every later phase.
 */
export const mercuryFetchPhases = defineMachine({
  name: "mercuryFetchPhases",
  initial: "window",
  final: ["done"],
  states: {
    window: { listed: "pending" },
    pending: { listed: "treasury" },
    treasury: { listed: "done" },
    done: {},
  },
});

export type MercuryFetchPhase = keyof typeof mercuryFetchPhases.states;

/** The phases a run resumed at `phase` runs, that one first. */
export function mercuryPhasesFrom(phase: Exclude<MercuryFetchPhase, "done">): Exclude<MercuryFetchPhase, "done">[] {
  const phases: Exclude<MercuryFetchPhase, "done">[] = [];
  for (let at: MercuryFetchPhase = phase; at !== "done"; at = mercuryFetchPhases.next(at, "listed")) phases.push(at);
  return phases;
}

/**
 * One connection's runs in a row that failed on a repeated page token (FLOW-1162; the owner,
 * 2026-11-11: stop after 3). Such a run is `repeated`; a run that ends any other way is `other`.
 * In `stopped` the cron and an unforced run skip the connection, so the sync stops retrying; the
 * owner's forced refresh still runs it (a failed run writes no line), and a reconnect replaces the
 * settings that hold the step. mercury-sync keeps the step as `settings.repeated_page_runs`
 * (sync_settings.ts).
 */
export const mercuryRepeatedPage = defineMachine({
  name: "mercuryRepeatedPage",
  initial: "clear",
  states: {
    clear: { repeated: "once" },
    once: { repeated: "twice", other: "clear" },
    twice: { repeated: "stopped", other: "clear" },
    stopped: { other: "clear" },
  },
});

export type MercuryRepeatedPage = keyof typeof mercuryRepeatedPage.states;

/**
 * The steps mercury-sync commits a plan in, one after the other (not one transaction):
 * - `lines`: the lines, voids, skips, recheck stamps and the cursor (`upsert_connector_lines`).
 * - `labels`: the account and card labels and the pending lines' missing clocks.
 * - `stamp`: the sync's time (`stamp_connector_sync`), only after a complete fetch.
 * A failed step throws, so a later step never runs before an earlier one is written.
 */
export const mercuryCommit = defineMachine({
  name: "mercuryCommit",
  initial: "lines",
  final: ["done"],
  states: {
    lines: { saved: "labels" },
    labels: { labeled: "stamp", partial: "done" },
    stamp: { stamped: "done" },
    done: {},
  },
});
