// FLOW-1168: a push claim that can be given back. push_claim_targets moves a user's new-lines mark
// (or stamps the weekly day) before the push goes out, and claim_push_test spends one of the five
// test pushes an hour. A claim no device took is given back, so the next run sends it:
// - new and weekly: given back when no device of the user accepted the push and at least one try
//   failed in a way a later try can pass (a timeout, a network error, 408, 429, 5xx, or the run's
//   time ran out before it was tried). A user one device accepted it from keeps the claim, so a
//   push is never sent twice to a user who got it; a user whose every device refused it or is gone
//   keeps it too, so nothing retries without end. A run killed before it gives claims back leaves
//   them spent (at most once, as before).
// - test: given back whenever no device accepted the test push.

import { defineMachine } from "../../../packages/shared/src/machine.ts";
import type { PushOutcome } from "./webpush.ts";

export const pushClaim = defineMachine({
  name: "pushClaim",
  initial: "claimed",
  final: ["delivered", "released", "spent"],
  states: {
    claimed: { sent: "delivered", failed: "failing", done: "spent" },
    failing: { sent: "delivered", done: "released" },
    delivered: {},
    released: {},
    spent: {},
  },
});

export type PushClaimState = keyof typeof pushClaim.states;

/** The claim event a device's outcome is: gone and refused say nothing a retry could change. */
export function claimEvent(outcome: PushOutcome): "sent" | "failed" | null {
  if (outcome === "sent") return "sent";
  if (outcome === "failed") return "failed";
  return null;
}

/** Each user's claim, moved by the outcomes of their devices' sends, then ended. */
export class PushClaims {
  readonly #states = new Map<string, PushClaimState>();

  constructor(users: Iterable<string>) {
    for (const user of users) this.#states.set(user, pushClaim.initial);
  }

  note(user: string, outcome: PushOutcome): void {
    const event = claimEvent(outcome);
    const state = this.#states.get(user);
    if (event && state !== undefined) this.#states.set(user, pushClaim.next(state, event));
  }

  /** Ends every claim: the users whose claim is given back, and the rest. */
  end(): { released: string[]; kept: string[] } {
    const released: string[] = [];
    const kept: string[] = [];
    for (const [user, from] of this.#states) {
      const to = pushClaim.next(from, "done");
      this.#states.set(user, to);
      (to === "released" ? released : kept).push(user);
    }
    return { released: released.sort(), kept: kept.sort() };
  }

  state(user: string): PushClaimState | undefined {
    return this.#states.get(user);
  }
}
