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
