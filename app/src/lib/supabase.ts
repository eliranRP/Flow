import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@flow/shared";

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

export const supabase: SupabaseClient<Database> | null =
  url.length > 0 && anonKey.length > 0
    ? createClient<Database>(url, anonKey, {
        auth: {
          flowType: "pkce",
          detectSessionInUrl: true,
          persistSession: true,
        },
      })
    : null;

export function getSupabase(): SupabaseClient<Database> | null {
  return supabase;
}
