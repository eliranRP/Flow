import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@flow/shared";
import { z } from "zod";

const env = z
  .object({
    url: z.union([z.url(), z.literal("")]),
    anonKey: z.string(),
  })
  .parse({
    url: typeof import.meta.env.VITE_SUPABASE_URL === "string" ? import.meta.env.VITE_SUPABASE_URL.trim() : "",
    anonKey: typeof import.meta.env.VITE_SUPABASE_ANON_KEY === "string" ? import.meta.env.VITE_SUPABASE_ANON_KEY.trim() : "",
  });

const url = env.url;
const anonKey = env.anonKey;

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
