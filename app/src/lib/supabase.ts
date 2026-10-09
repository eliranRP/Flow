import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@flow/shared";
import { withCompanyHeader } from "./company-header";
/** True for an absolute URL with a host. No zod here: this file is on Home's first load (FLOW-804). */
function isUrl(value: string): boolean {
  try {
    return new URL(value).hostname.length > 0;
  } catch {
    return false;
  }
}

/** A bad URL returns null. Module load must not throw and blank the app. */
export function readSupabaseEnv(input: { url: unknown; anonKey: unknown }): { url: string; anonKey: string } | null {
  const url = typeof input.url === "string" ? input.url.trim() : "";
  const anonKey = typeof input.anonKey === "string" ? input.anonKey.trim() : "";
  if (url !== "" && !isUrl(url)) return null;
  return { url, anonKey };
}

const env = readSupabaseEnv({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

const url = env?.url ?? "";
const anonKey = env?.anonKey ?? "";

export const supabase: SupabaseClient<Database> | null =
  url.length > 0 && anonKey.length > 0
    ? createClient<Database>(url, anonKey, {
        auth: {
          flowType: "pkce",
          detectSessionInUrl: true,
          persistSession: true,
        },
        // FLOW-601: every API call names the company the app shows (x-flow-company).
        global: { fetch: withCompanyHeader() },
      })
    : null;

export function getSupabase(): SupabaseClient<Database> | null {
  return supabase;
}
