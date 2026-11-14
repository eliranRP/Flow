import { getSupabase } from "./lib/supabase";
import { waitForAccessToken } from "./wait-for-session";

/** The Supabase client once the session has an access token; a read that needs the signed-in user starts here. */
export async function readyClient() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  await waitForAccessToken(supabase);
  return supabase;
}
