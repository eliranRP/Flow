import { createClient } from "@supabase/supabase-js";
import { MERCURY_KEK_REF } from "../_shared/connectors/mercury/capabilities.ts";
import { mercuryAdapter } from "../_shared/connectors/mercury/adapter.ts";
import { redactMercury } from "../_shared/connectors/mercury/redact.ts";
import { isLegacyRow, legacyPatch, rpcWithSlot } from "../_shared/connectors/mercury/legacy.ts";
import { chooseSlot, keptChoices, readConnectionScope, storedLabels } from "../_shared/connectors/mercury/scope.ts";
import { decodeKek, sealApiKey } from "../_shared/envelope.ts";
import { empty, json } from "../_shared/http.ts";
import { parseImportFrom, saveImportFrom } from "../_shared/import-from.ts";
import { companyHint, ownedCompany } from "../_shared/owner.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

/**
 * Paste a Read Only Mercury token. The seal is envelope format 3 and binds
 * company|mercury. SUMIT connect is unchanged and still seals format 2.
 *
 * FLOW-938: a company may hold several Mercury connections (slots). A key that lists an account of a
 * connection replaces that connection's key; `slot` names the connection a replacement is for; any
 * other key is a new connection. A new connection, or a key that lists other accounts, waits for the
 * owner to choose its accounts and date (set_mercury_accounts) and syncs nothing until then. A new key
 * of the same organisation keeps the owner's choices (keptChoices).
 *
 * Until the FLOW-938 migration is pushed (CI deploys the functions first), the schema has no slot and
 * the RPC no p_slot: then the key replaces the one connection as before, every account syncs, and the
 * import date the app sends is saved as before (legacy.ts).
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

    const body = (await req.json()) as { apiKey?: unknown; slot?: unknown; importFrom?: unknown };
    apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (apiKey.length < 8) return json({ error: "api key is required" }, 400);
    const requested = typeof body.slot === "number" && Number.isInteger(body.slot) ? body.slot : null;
    const importFrom = parseImportFrom(body.importFrom);
    if (importFrom === false) return json({ error: "import date is invalid" }, 400);

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const companyId = await ownedCompany(admin, user.data.user.id, companyHint(req));
    if (!companyId) return json({ error: "no company" }, 400);

    const session = mercuryAdapter.open(apiKey);
    const validated = await mercuryAdapter.validate(session);
    if (!validated.ok) {
      const status = validated.class === "rate_limited" ? 429 : validated.class === "transient" ? 503 : 400;
      return json({ error: validated.code ?? validated.class }, status);
    }

    // Every column, so the schema before FLOW-938 reads too (legacy.ts).
    const previous = await admin
      .from("connector_connections")
      .select("*")
      .eq("company_id", companyId)
      .eq("provider", "mercury");
    if (previous.error) return json({ error: "could not store the connection" }, 500);
    const rows = (previous.data ?? []) as Record<string, unknown>[];
    let legacy = rows.some((row) => isLegacyRow(row));
    const existing = rows.map((row) => readConnectionScope(row));
    const accountIds = validated.accounts.map((account) => account.id);
    // The old schema holds one connection: any key replaces it, as before.
    const choice = legacy && existing[0]
      ? chooseSlot([existing[0]], accountIds, existing[0].slot)
      : chooseSlot(existing, accountIds, requested);
    if (choice.kind === "refused") {
      return json({ error: choice.code }, choice.code === "not_found" ? 404 : 409);
    }
    const slot = choice.slot;
    const target = existing.find((row) => row.slot === slot);
    const forSlot = <Q extends { eq(column: string, value: unknown): Q }>(query: Q): Q =>
      legacy ? query : query.eq("slot", slot);

    if (choice.kind === "replace" && choice.accountsChanged) {
      // A token for other accounts must not resume the old accounts' cursor. Of the owner's choices
      // the accounts it still lists stay (keptChoices); with none of them, the accounts are chosen
      // again. Cleared before the new key is stored, so no sync can pair it with the old cursor.
      const kept = target ? keptChoices(target, accountIds) : null;
      const patch = choice.reset || kept == null
        ? { sync_cursor: null, accounts_chosen_at: null, sync_account_ids: null, skip_account_ids: [], account_from: {} }
        : { sync_cursor: null, ...kept };
      const cleared = await forSlot(
        admin.from("connector_connections").update(legacyPatch(patch, legacy)).eq("company_id", companyId).eq("provider", "mercury"),
      );
      if (cleared.error) return json({ error: "could not store the connection" }, 500);
    }

    const kekVersion = Deno.env.get("MERCURY_KEK_VERSION") || "1";
    const sealed = await sealApiKey(apiKey, decodeKek(kekSecret), kekVersion, companyId, "3", "mercury");
    const replaced = await rpcWithSlot(
      (args) => admin.rpc("replace_connector_connection", args),
      {
        p_company: companyId,
        p_provider: "mercury",
        p_key_ciphertext: sealed.keyCiphertext,
        p_key_nonce: sealed.keyNonce,
        p_dek_ciphertext: sealed.dekCiphertext,
        p_dek_nonce: sealed.dekNonce,
        p_kek_version: sealed.kekVersion,
        p_envelope_version: sealed.envelopeVersion ?? "3",
        p_validated: true,
        p_settings: {},
      },
      slot,
      legacy,
    );
    legacy = replaced.legacy;
    if (replaced.result.error) return json({ error: "could not store the connection" }, 500);

    const labeled = await forSlot(
      admin
        .from("connector_connections")
        .update(legacyPatch({ account_labels: storedLabels(validated.accounts), org_label: validated.org ?? null }, legacy))
        .eq("company_id", companyId)
        .eq("provider", "mercury"),
    );
    if (labeled.error) return json({ error: "could not store the connection" }, 500);
    if (legacy) {
      // As before FLOW-938: every account syncs, from the date the app sent.
      const importSaved = await saveImportFrom(userClient, "mercury", importFrom);
      return json({ connected: true, slot: 1, accounts: validated.accounts.length, choose_accounts: false, import_from_saved: importSaved });
    }
    const chosen = choice.kind === "replace" && !choice.reset && target?.chosen === true;
    return json({ connected: true, slot, accounts: validated.accounts.length, choose_accounts: !chosen });
  } catch (error) {
    const message = error instanceof Error ? error.message : "connect failed";
    const scrubbed = apiKey ? message.replaceAll(apiKey, "[redacted]") : message;
    console.error("mercury-connect", String(redactMercury(scrubbed)).slice(0, 400));
    return json({ error: "connect_failed" }, 500);
  }
});
