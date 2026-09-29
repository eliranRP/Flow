import { createClient } from "@supabase/supabase-js";
import { decodeKek, sealApiKey } from "../_shared/envelope.ts";
import { empty, json } from "../_shared/http.ts";
import { assertSumitUrl } from "../_shared/ledger.ts";
import { classifySumitStatus } from "../_shared/sumit-policy.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

const LIST_FOLDERS = "https://api.sumit.co.il/crm/schema/listfolders/";

/** One read-only listfolders call. A non-zero Status never reaches the ledger. */
async function validateSumitKey(companyId: number, apiKey: string): Promise<void> {
  assertSumitUrl(LIST_FOLDERS);
  const response = await fetch(LIST_FOLDERS, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ Credentials: { CompanyID: companyId, APIKey: apiKey } }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error("connect_failed");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("connect_failed");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("connect_failed");
  const record = parsed as Record<string, unknown>;
  if (record.Status !== 0) {
    const userMessage = typeof record.UserErrorMessage === "string" ? record.UserErrorMessage : "";
    console.error("sumit-connect rejected", userMessage.replace(/[A-Za-z0-9+/=]{16,}/g, "[redacted]").slice(0, 200));
    throw new Error(classifySumitStatus(userMessage));
  }
}

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

    await validateSumitKey(companyId, apiKey);
    const kekVersion = Deno.env.get("SUMIT_KEK_VERSION") || "1";
    const sealed = await sealApiKey(apiKey, decodeKek(kekSecret), kekVersion, company.data.id, "2");
    const saved = await admin.rpc("replace_sumit_connection", {
      p_company: company.data.id,
      p_sumit_company_id: companyId,
      p_key_ciphertext: sealed.keyCiphertext,
      p_key_nonce: sealed.keyNonce,
      p_dek_ciphertext: sealed.dekCiphertext,
      p_dek_nonce: sealed.dekNonce,
      p_kek_version: sealed.kekVersion,
      p_envelope_version: sealed.envelopeVersion,
      p_validated: true,
    });
    if (saved.error) return json({ error: "could not store the connection" }, 500);
    return json({ connected: true, sumit_company_id: companyId, sumit_reads: 1 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "connect failed";
    console.error("sumit-connect", message.replace(/[A-Za-z0-9+/=]{16,}/g, "[redacted]"));
    if (message === "sumit_auth" || message === "sumit_rejected") return json({ error: message }, 400);
    return json({ error: "connect_failed" }, 500);
  }
});
