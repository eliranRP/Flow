import { createClient } from "@supabase/supabase-js";
import { empty, json } from "../_shared/http.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

// Off unless SUMIT_HOOK_ENABLED is exactly "true". A SUMIT trigger is a write
// on their side, so Flow does not register one. Decision 0053.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return empty();
  if (Deno.env.get("SUMIT_HOOK_ENABLED") !== "true") return json({ error: "not found" }, 404);
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !service) return json({ error: "server is missing a secret" }, 500);
  const token = req.headers.get("x-flow-hook") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: "not found" }, 404);
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const connection = await admin.from("sumit_connections").select("company_id").eq("hook_token", token).maybeSingle();
  if (connection.error || !connection.data) return json({ error: "not found" }, 404);
  await req.text().catch(() => "");
  await admin.from("sumit_refresh_requests").insert({
    company_id: connection.data.company_id,
    purpose: "app_open",
  });
  return json({ ok: true });
});
