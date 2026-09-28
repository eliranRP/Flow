import { createClient } from "@supabase/supabase-js";
import { decodeKek, sealApiKey } from "../_shared/envelope.ts";
import { empty, json } from "../_shared/http.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return empty();
  if (req.method !== "POST") return json({ error: "method" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const kekSecret = Deno.env.get("SUMIT_KEK") ?? "";
    if (!url || !anon || !service || !kekSecret) return json({ error: "server is missing a secret" }, 500);

    const header = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: header } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const user = await userClient.auth.getUser();
    if (user.error || !user.data.user) return json({ error: "unauthorized" }, 401);

    const body = (await req.json()) as { companyId?: unknown; apiKey?: unknown };
    const companyId = typeof body.companyId === "number" ? body.companyId : Number(body.companyId);
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!Number.isInteger(companyId) || companyId <= 0 || apiKey.length < 8) {
      return json({ error: "company id and api key are required" }, 400);
    }

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const company = await admin.from("companies").select("id").eq("owner_id", user.data.user.id).maybeSingle();
    if (company.error || !company.data) return json({ error: "no company" }, 400);

    const sealed = await sealApiKey(apiKey, decodeKek(kekSecret), "1");
    const saved = await admin.from("sumit_connections").upsert(
      {
        company_id: company.data.id,
        sumit_company_id: companyId,
        key_ciphertext: sealed.keyCiphertext,
        key_nonce: sealed.keyNonce,
        dek_ciphertext: sealed.dekCiphertext,
        dek_nonce: sealed.dekNonce,
        kek_version: sealed.kekVersion,
        last_error: null,
      },
      { onConflict: "company_id" },
    );
    if (saved.error) return json({ error: "could not store the connection" }, 500);
    return json({ connected: true, sumit_company_id: companyId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "connect failed";
    console.error("sumit-connect", message.replace(/[A-Za-z0-9+/=]{16,}/g, "[redacted]"));
    return json({ error: "connect_failed" }, 500);
  }
});
