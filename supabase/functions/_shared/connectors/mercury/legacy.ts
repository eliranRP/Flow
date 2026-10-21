/**
 * The schema before FLOW-938 (decision 0203). CI deploys the edge functions before cd-push.sh pushes
 * the migration, so for a while (and for as long as a failed push leaves it) mercury-sync and
 * mercury-connect run against the old schema: connector_connections has no slot, accounts_chosen_at,
 * sync_account_ids, skip_account_ids, account_from or org_label, and the RPCs take no p_slot. There
 * both functions keep the single-connection behaviour from before: one connection on slot 1 that
 * syncs every account its key lists. Pure: no network, no database.
 */

/** A PostgREST or Postgres error as supabase-js returns it. */
export interface SchemaError {
  code?: string | null;
  message?: string | null;
}

/** The connector_connections columns FLOW-938 adds. */
export const MERCURY_CONNECTION_COLUMNS = [
  "slot",
  "org_label",
  "accounts_chosen_at",
  "sync_account_ids",
  "skip_account_ids",
  "account_from",
] as const;

/** A function with these arguments is not there: PostgREST's schema cache, or Postgres itself. */
export function isMissingFunction(error: SchemaError | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883";
}

/** A connection row read with select("*") before the migration: it has no slot or accounts_chosen_at. */
export function isLegacyRow(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  return !("slot" in row) || !("accounts_chosen_at" in row);
}

/** The patch without the columns the old schema does not have. */
export function legacyPatch<T extends Record<string, unknown>>(patch: T, legacy: boolean): Partial<T> {
  if (!legacy) return patch;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!(MERCURY_CONNECTION_COLUMNS as readonly string[]).includes(key)) out[key] = value;
  }
  return out as Partial<T>;
}

/**
 * An RPC that takes p_slot since FLOW-938. `legacy` is what the rows showed: true, the old schema,
 * called without p_slot as before; false, the new schema, called with it; null, not known (no row to
 * read it from). Only then does a "no such function" answer to the call with p_slot mean the old
 * schema and the call is made again without it: on the new schema a call without p_slot would address
 * every connection of the provider, so a known new schema never retries.
 */
export async function rpcWithSlot<R extends { error: SchemaError | null }>(
  call: (args: Record<string, unknown>) => PromiseLike<R>,
  args: Record<string, unknown>,
  slot: number,
  legacy: boolean | null,
): Promise<{ result: R; legacy: boolean }> {
  if (legacy === true) return { result: await call(args), legacy: true };
  const first = await call({ ...args, p_slot: slot });
  if (legacy === false || !isMissingFunction(first.error)) return { result: first, legacy: false };
  return { result: await call(args), legacy: true };
}
