import { createClient } from "@supabase/supabase-js";
import { MERCURY_KEK_REF } from "../_shared/connectors/mercury/capabilities.ts";
import { mercuryAdapter } from "../_shared/connectors/mercury/adapter.ts";
import { redactMercury } from "../_shared/connectors/mercury/redact.ts";
import { decodeKek, sealApiKey } from "../_shared/envelope.ts";
import { empty, json } from "../_shared/http.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

/**
 * Paste a Read Only Mercury token. The seal is envelope format 3 and binds
 * company|mercury. SUMIT connect is unchanged and still seals format 2.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return empty();
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let apiKey = "";
  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const kekSecret = Deno.env.get(MERCURY_KEK_REF) ?? "";
    if (!url || !anon || !service || !kekSecret) return json({ error: "server is missing a secret" }, 500);

    const header = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: header } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const user = await userClient.auth.getUser();
    if (user.error || !user.data.user) return json({ error: "unauthorized" }, 401);

    const body = (await req.json()) as { apiKey?: unknown };
    apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (apiKey.length < 8) return json({ error: "api key is required" }, 400);

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const company = await admin.from("companies").select("id").eq("owner_id", user.data.user.id).maybeSingle();
    if (company.error || !company.data) return json({ error: "no company" }, 400);

    const session = mercuryAdapter.open(apiKey);
    const validated = await mercuryAdapter.validate(session);
    if (!validated.ok) {
      const status = validated.class === "rate_limited" ? 429 : validated.class === "transient" ? 503 : 400;
      return json({ error: validated.code ?? validated.class }, status);
    }

    const kekVersion = Deno.env.get("MERCURY_KEK_VERSION") || "1";
    const sealed = await sealApiKey(apiKey, decodeKek(kekSecret), kekVersion, company.data.id, "3", "mercury");
    const saved = await admin.rpc("replace_connector_connection", {
      p_company: company.data.id,
      p_provider: "mercury",
      p_key_ciphertext: sealed.keyCiphertext,
      p_key_nonce: sealed.keyNonce,
      p_dek_ciphertext: sealed.dekCiphertext,
      p_dek_nonce: sealed.dekNonce,
      p_kek_version: sealed.kekVersion,
      p_envelope_version: sealed.envelopeVersion ?? "3",
      p_validated: true,
      p_settings: {},
    });
    if (saved.error) return json({ error: "could not store the connection" }, 500);

    const labeled = await admin
      .from("connector_connections")
      .update({ account_labels: validated.accounts })
      .eq("company_id", company.data.id)
      .eq("provider", "mercury");
    if (labeled.error) return json({ error: "could not store the connection" }, 500);
    return json({ connected: true, accounts: validated.accounts.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "connect failed";
    const scrubbed = apiKey ? message.replaceAll(apiKey, "[redacted]") : message;
    console.error("mercury-connect", String(redactMercury(scrubbed)).slice(0, 400));
    return json({ error: "connect_failed" }, 500);
  }
});
