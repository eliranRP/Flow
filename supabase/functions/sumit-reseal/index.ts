import { createClient } from "@supabase/supabase-js";
import { constantTimeEqual } from "../_shared/constant-time.ts";
import { decodeKek, envelopeFromRow, openApiKey, sealApiKey } from "../_shared/envelope.ts";
import { empty, json } from "../_shared/http.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return empty();
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const kekSecret = Deno.env.get("SUMIT_KEK") ?? "";
  if (!url || !service || !kekSecret) return json({ error: "server is missing a secret" }, 500);

  const cron = req.headers.get("x-flow-cron");
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const header = req.headers.get("Authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const cronOk = Boolean(cron && cronSecret && constantTimeEqual(cron, cronSecret));
  const serviceOk = Boolean(bearer && constantTimeEqual(bearer, service));
  if (!cronOk && !serviceOk) return json({ error: "unauthorized" }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const listed = await admin
    .from("sumit_connections")
    .select("company_id, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version, envelope_version");
  if (listed.error) return json({ error: "could not read connections" }, 500);

  const kek = decodeKek(kekSecret);
  let resealed = 0;
  for (const row of listed.data ?? []) {
    if (resolvedFormat(row.envelope_version, row.kek_version) !== "1") continue;
    const envelope = envelopeFromRow(row);
    let plain = "";
    try {
      plain = await openApiKey(envelope, kek);
      const sealed = await sealApiKey(plain, kek, String(row.kek_version), String(row.company_id), "3", "sumit");
      const updated = await admin
        .from("sumit_connections")
        .update({
          key_ciphertext: sealed.keyCiphertext,
          key_nonce: sealed.keyNonce,
          dek_ciphertext: sealed.dekCiphertext,
          dek_nonce: sealed.dekNonce,
          envelope_version: "3",
        })
        .eq("company_id", row.company_id)
        .eq("key_ciphertext", row.key_ciphertext)
        .eq("dek_ciphertext", row.dek_ciphertext)
        .select("company_id");
      if (updated.error || updated.data == null || updated.data.length !== 1) {
        return json({ error: "reseal_incomplete" }, 500);
      }
      resealed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "reseal failed";
      const safe = plain === "" ? message : message.replaceAll(plain, "[redacted]");
      console.error("sumit-reseal", safe.replace(/[A-Za-z0-9+/=]{16,}/g, "[redacted]").slice(0, 200));
      return json({ error: "reseal_failed" }, 500);
    } finally {
      plain = "";
    }
  }
  return json({ ok: true, resealed });
});

function resolvedFormat(envelopeVersion: unknown, kekVersion: unknown): string {
  if (envelopeVersion != null) return String(envelopeVersion);
  return String(kekVersion) === "2" ? "2" : "1";
}
