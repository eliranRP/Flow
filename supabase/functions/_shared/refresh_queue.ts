import { defineMachine } from "../../../packages/shared/src/machine.ts";
import { isMissingFunction, type SchemaError } from "./connectors/mercury/legacy.ts";

/**
 * A connector refresh request (connector_refresh_requests, FLOW-1163, decision 0266). The SQL side
 * is in 20261109222332_refresh_request_lifecycle.sql; this is the same table.
 * - `claim`: the drain takes a queued request (claim_connector_refreshes for Mercury, sumit-sync's
 *   own update for SUMIT).
 * - `requeue`: the run threw, or another run held the connection. A retry can change both.
 * - `finish`: the run synced, or skipped for a reason a retry cannot change (synced within the quiet
 *   gap, so that sync answers the request; or no accounts chosen yet). The row is deleted.
 * - `lapse`: the run died without settling; the next claim deletes a request claimed longer than
 *   the claim window.
 */
export const refreshRequest = defineMachine({
  name: "refreshRequest",
  initial: "queued",
  final: ["finished"],
  states: {
    queued: { claim: "claimed" },
    claimed: { requeue: "queued", finish: "finished", lapse: "finished" },
    finished: {},
  },
});

export type RefreshSettle = "requeue" | "finish";

/** How a drained run ends its request: `threw`, or the run's answer. */
export function refreshSettle(run: "threw" | { skipped?: boolean; busy?: boolean }): RefreshSettle {
  if (run === "threw" || run.busy === true) return "requeue";
  return "finish";
}

/**
 * Settles a claimed request: settle_connector_refresh, which merges a requeue into a request queued
 * meanwhile. Before that function is pushed (CI deploys the functions first), `fallback` does the
 * same on the table: a requeue clears claimed_at as the drains did before, a finish deletes the row.
 * Never throws: an unsettled request lapses at the claim window.
 */
export async function settleRefresh(
  rpc: (args: { p_id: number; p_requeue: boolean }) => PromiseLike<{ error: SchemaError | null }>,
  fallback: Record<RefreshSettle, () => PromiseLike<unknown>>,
  id: number,
  move: RefreshSettle,
): Promise<"settled" | "fallback" | "failed"> {
  try {
    const settled = await rpc({ p_id: id, p_requeue: move === "requeue" });
    if (!settled.error) return "settled";
    if (!isMissingFunction(settled.error)) return "failed";
    await fallback[move]();
    return "fallback";
  } catch {
    return "failed";
  }
}
