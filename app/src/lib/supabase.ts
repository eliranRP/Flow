import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@flow/shared";
import { z } from "zod";

const envSchema = z.object({
  url: z.union([z.url(), z.literal("")]),
  anonKey: z.string(),
});

/** A bad URL returns null. Module load must not throw and blank the app. */
export function readSupabaseEnv(input: { url: unknown; anonKey: unknown }): { url: string; anonKey: string } | null {
  const parsed = envSchema.safeParse({
    url: typeof input.url === "string" ? input.url.trim() : "",
    anonKey: typeof input.anonKey === "string" ? input.anonKey.trim() : "",
  });
  if (!parsed.success) return null;
  return parsed.data;
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
      })
    : null;

export function getSupabase(): SupabaseClient<Database> | null {
  return supabase;
}
