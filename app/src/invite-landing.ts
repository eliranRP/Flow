import type { SupabaseClient } from "@supabase/supabase-js";

/** The full-screen invitation (FLOW-601, FLOW-513 board states). */
export const INVITES_PATH = "/invites";

/**
 * Where sign-in lands: someone with no company yet sees their invites when there are any; someone
 * with a company sees them once, while an invite is still unseen (the screen marks it seen), and
 * later it waits in החלפת עסק. Else the path they were going to. A failed read changes nothing.
 */
export async function landingWithInvites(client: Pick<SupabaseClient, "rpc">, hasCompany: boolean, path: string): Promise<string> {
  try {
    const result = await client.rpc("my_invites");
    if (result.error != null || !Array.isArray(result.data)) return path;
    const rows = result.data as { seen_at?: string | null }[];
    if (hasCompany ? rows.some((row) => row.seen_at == null) : rows.length > 0) return INVITES_PATH;
  } catch {
    // Keep the usual landing.
  }
  return path;
}
