import { getSupabase } from "./lib/supabase";
import { preloadReadSchemas } from "./load-read-schemas";
import { signalled } from "./signalled";
import { waitForAccessToken } from "./wait-for-session";

/** What React Query hands a queryFn; the part a read passes on to readyClient. */
export type Ctx = { signal: AbortSignal };

/**
 * The Supabase client once the session has an access token; a read that needs the signed-in user starts here.
 * FLOW-1348: a queryFn passes its context, and every `rpc` of the client it gets stops when the query is cancelled
 * (so a read nobody waits for leaves the read queue, read-cap.ts). A table read chains `signalled` itself.
 */
export async function readyClient(q?: Ctx) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  // FLOW-1273: every read starts here, so the schemas that parse its answer load beside it (one shared fetch, kept lazy).
  preloadReadSchemas();
  await waitForAccessToken(supabase);
  if (q == null) return supabase;
  const rpc = (...args: Parameters<typeof supabase.rpc>) => signalled(supabase.rpc(...args), q.signal);
  return Object.create(supabase, { rpc: { value: rpc } }) as typeof supabase;
}
