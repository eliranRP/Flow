/**
 * Storing a new Mercury key (FLOW-1163). A key for other accounts must not resume the old accounts'
 * cursor, so the cursor and (some of) the owner's account choice are reset with it. replace_connector_connection
 * does both in one statement (p_reset, p_kept), so a failure leaves the old connection whole.
 *
 * CI deploys the edge functions before the migration is pushed. While the database has no p_reset, the
 * call finds no such function (isMissingFunction) and the old two calls run instead, as before: clear
 * the cursor and the choice, then store the key. Pure: no network, no database.
 */
import { isMissingFunction, rpcWithSlot, type SchemaError } from "./legacy.ts";
import type { KeptChoices } from "./scope.ts";

/** Null: nothing is reset. `kept` null: the accounts are chosen again; else the choices the new key keeps. */
export interface KeyReset {
  kept: KeptChoices | null;
}

/**
 * Stores the key through `call` (the RPC). With a reset, one call does it all; where the RPC does not
 * take the reset yet, `clear` runs first and the plain call follows. `legacy` is as in rpcWithSlot.
 */
export async function replaceKey<R extends { error: SchemaError | null }>(
  call: (args: Record<string, unknown>) => PromiseLike<R>,
  clear: () => PromiseLike<{ error: SchemaError | null }>,
  args: Record<string, unknown>,
  slot: number,
  legacy: boolean | null,
  reset: KeyReset | null,
): Promise<{ result: R; legacy: boolean }> {
  if (reset != null && legacy !== true) {
    const resetArgs = { ...args, p_reset: true, ...(reset.kept ? { p_kept: reset.kept } : {}) };
    const first = await rpcWithSlot(call, resetArgs, slot, legacy);
    if (!isMissingFunction(first.result.error)) return first;
  }
  if (reset != null) {
    const cleared = await clear();
    if (cleared.error) {
      return { result: { error: cleared.error } as R, legacy: legacy === true };
    }
  }
  return await rpcWithSlot(call, args, slot, legacy);
}
