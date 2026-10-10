import type { SupabaseClient } from "@supabase/supabase-js";

/** The full-screen list of open invites (FLOW-601, mockup invite-3). */
export const INVITES_PATH = "/invites";

/**
 * Where sign-in lands someone with no company yet: their open invites when there are any,
 * else the path they were going to (the first setup step). A failed read changes nothing:
 * the invites still wait in the חברה sheet once they have a company.
 */
export async function landingWithInvites(client: Pick<SupabaseClient, "rpc">, hasCompany: boolean, path: string): Promise<string> {
  if (hasCompany) return path;
  try {
    const result = await client.rpc("my_invites");
    if (result.error == null && Array.isArray(result.data) && result.data.length > 0) return INVITES_PATH;
  } catch {
    // Keep the usual landing.
  }
  return path;
}
