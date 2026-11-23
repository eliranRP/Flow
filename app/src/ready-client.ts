import { getSupabase } from "./lib/supabase";
import { preloadReadSchemas } from "./load-read-schemas";
import { waitForAccessToken } from "./wait-for-session";

/** The Supabase client once the session has an access token; a read that needs the signed-in user starts here. */
export async function readyClient() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  // FLOW-1273: every read starts here, so the schemas that parse its answer load beside it (one shared fetch, kept lazy).
  preloadReadSchemas();
  await waitForAccessToken(supabase);
  return supabase;
}
