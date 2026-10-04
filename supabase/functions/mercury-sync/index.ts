import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { planConnectorSync, type ConfirmResult, type StoredLine } from "../_shared/connectors/engine.ts";
import { MERCURY_KEK_REF, MERCURY_POSTED_LOOKBACK_DAYS } from "../_shared/connectors/mercury/capabilities.ts";
import { mercuryAdapter } from "../_shared/connectors/mercury/adapter.ts";
import {
  getMercuryTransaction,
  recheckMissingPending,
} from "../_shared/connectors/mercury/client.ts";
import { redactMercury } from "../_shared/connectors/mercury/redact.ts";
import { isVoidMercuryStatus } from "../_shared/connectors/mercury/rules.ts";
import { decodeKek, openApiKey, type Envelope } from "../_shared/envelope.ts";
import { empty, json } from "../_shared/http.ts";
import type { ConnectorSession } from "../_shared/connectors/types.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

const te = new TextEncoder();
const CLAIM_MS = 15 * 60 * 1000;
const FORCE_GAP_MS = 60 * 1000;
const QUIET_GAP_MS = 6 * 60 * 60 * 1000;

class SyncHold extends Error {
  readonly retryAt: string;
  constructor(retryAt: string) {
    super("rate_limited");
    this.retryAt = retryAt;
  }
}

/**
 * Mercury sync. The cron header drains mercury refresh requests only.
 * sumit-sync is not called and is not changed. The connector drain URL
 * still posts sumit-sync; a Mercury row syncs from this function.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return empty();
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const kekSecret = Deno.env.get(MERCURY_KEK_REF) ?? "";
  if (!url || !anon || !service || !kekSecret) return json({ error: "server is missing a secret" }, 500);
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const cron = req.headers.get("x-flow-cron");
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
    if (cron && cronSecret && constantTimeEqual(cron, cronSecret)) {
      const due = await admin
        .from("connector_refresh_requests")
        .select("id, company_id, provider")
        .eq("provider", "mercury")
        .is("claimed_at", null)
        .order("requested_at", { ascending: true })
        .limit(20);
      if (due.error) return json({ error: "could not read the refresh queue" }, 500);
      const results = [];
      for (const row of (due.data ?? []) as Array<{ id: number; company_id: string; provider: string }>) {
        const claim = await admin
          .from("connector_refresh_requests")
          .update({ claimed_at: new Date().toISOString() })
          .eq("id", row.id)
          .is("claimed_at", null)
          .select("id");
        if (claim.error || claim.data == null || claim.data.length === 0) continue;
        const held = await admin
          .from("connector_connections")
          .select("sync_claimed_at, last_error, next_attempt_at")
          .eq("company_id", row.company_id)
          .eq("provider", "mercury")
          .maybeSingle();
        const heldRow = held.data;
        const claimedAt = heldRow && typeof heldRow.sync_claimed_at === "string" ? Date.parse(heldRow.sync_claimed_at) : 0;
        const waiting = heldRow && typeof heldRow.next_attempt_at === "string" && Date.parse(heldRow.next_attempt_at) > Date.now();
        if (held.error || !heldRow || heldRow.last_error === "auth" || waiting || (claimedAt && Date.now() - claimedAt < CLAIM_MS)) {
          await admin.from("connector_refresh_requests").update({ claimed_at: null }).eq("id", row.id);
          continue;
        }
        const stamped = await admin
          .from("connector_connections")
          .update({ sync_claimed_at: new Date().toISOString() })
          .eq("company_id", row.company_id)
          .eq("provider", "mercury")
          .select("company_id");
        if (stamped.error || stamped.data == null || stamped.data.length === 0) {
          await admin.from("connector_refresh_requests").update({ claimed_at: null }).eq("id", row.id);
          continue;
        }
        try {
          results.push(await syncCompany(admin, row.company_id, decodeKek(kekSecret), false, true));
        } catch (error) {
          await admin.from("connector_refresh_requests").update({ claimed_at: null }).eq("id", row.id);
          logFailure("mercury-sync cron", error, "");
        }
      }
      return json({ ok: true, synced: results.length });
    }

    const header = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: header } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const user = await userClient.auth.getUser();
    if (user.error || !user.data.user) return json({ error: "unauthorized" }, 401);
    const company = await admin.from("companies").select("id").eq("owner_id", user.data.user.id).maybeSingle();
    if (company.error || !company.data) return json({ error: "no company" }, 400);
    const body = (await req.json().catch(() => ({}))) as { force?: boolean };
    const result = await syncCompany(admin, company.data.id, decodeKek(kekSecret), body.force === true, false);
    return json(result);
  } catch (error) {
    if (error instanceof SyncHold) return json({ error: "rate_limited", retry_at: error.retryAt }, 429);
    const message = error instanceof Error ? error.message : "sync failed";
    logFailure("mercury-sync", error, "");
    const known = message === "auth" || message === "rejected" || message === "rate_limited" ||
      message === "transient" || message === "sync_page_cap" || message === "sync_cursor_conflict" ||
      message === "Mercury is not connected";
    return json({ error: known ? message : "sync_failed" }, message === "rate_limited" ? 429 : 500);
  }
});

function constantTimeEqual(left: string, right: string): boolean {
  const a = te.encode(left);
  const b = te.encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

function logFailure(label: string, error: unknown, secret: string): void {
  const message = error instanceof Error ? error.message : "sync failed";
  const scrubbed = secret ? message.replaceAll(secret, "[redacted]") : message;
  console.error(label, String(redactMercury(scrubbed)).slice(0, 400));
}

function bytesPrefix(value: unknown): string {
  if (typeof value === "string") {
    if (value.startsWith("\\x")) return value;
    if (/^[0-9a-fA-F]+$/.test(value)) return `\\x${value}`;
  }
  return String(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 128);
}

function pendingMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, stamp] of Object.entries(value)) {
    if (typeof stamp === "string" && key.length > 0 && key.length <= 128) out[key] = stamp;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function syncCompany(
  admin: SupabaseClient,
  companyId: string,
  kek: Uint8Array,
  force: boolean,
  alreadyClaimed: boolean,
): Promise<{ ok: boolean; lines: number; skipped?: boolean }> {
  const connection = await admin
    .from("connector_connections")
    .select("key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version, envelope_version, sync_cursor, import_from, last_sync_at, last_error, next_attempt_at, sync_claimed_at, settings")
    .eq("company_id", companyId)
    .eq("provider", "mercury")
    .maybeSingle();
  if (connection.error || !connection.data) throw new Error("Mercury is not connected");
  const row = connection.data;
  if (row.last_error === "auth") throw new Error("auth");
  if (typeof row.next_attempt_at === "string" && Date.parse(row.next_attempt_at) > Date.now()) {
    throw new SyncHold(row.next_attempt_at);
  }
  if (!alreadyClaimed && typeof row.sync_claimed_at === "string") {
    const claimedAt = Date.parse(row.sync_claimed_at);
    if (!Number.isNaN(claimedAt) && Date.now() - claimedAt < CLAIM_MS) {
      return { ok: true, lines: 0, skipped: true };
    }
  }
  const last = row.last_sync_at ? Date.parse(row.last_sync_at as string) : 0;
  const minGap = force ? FORCE_GAP_MS : QUIET_GAP_MS;
  if (last && Date.now() - last < minGap) return { ok: true, lines: 0, skipped: true };

  const envelope: Envelope = {
    keyCiphertext: bytesPrefix(row.key_ciphertext),
    keyNonce: bytesPrefix(row.key_nonce),
    dekCiphertext: bytesPrefix(row.dek_ciphertext),
    dekNonce: bytesPrefix(row.dek_nonce),
    kekVersion: String(row.kek_version),
    ...(row.envelope_version == null ? {} : { envelopeVersion: String(row.envelope_version) }),
  };
  const settings = isRecord(row.settings) ? row.settings : {};
  const ownCounterpartyIds = stringList(settings.own_counterparty_ids);
  const missing = pendingMap(settings.pending_missing);
  let apiKey = "";
  try {
    apiKey = await openApiKey(envelope, kek, companyId, "mercury");
    const session = mercuryAdapter.open(apiKey);
    const stored = await loadStored(admin, companyId, missing);
    const now = new Date();
    const plan = await planConnectorSync({
      port: mercuryAdapter,
      session,
      cursor: typeof row.sync_cursor === "string" ? row.sync_cursor : null,
      importFrom: typeof row.import_from === "string" ? row.import_from : null,
      lookbackDays: MERCURY_POSTED_LOOKBACK_DAYS,
      ownCounterpartyIds,
      vatRateBp: 0,
      exemptSupplierNames: [],
      exemptSupplierIds: [],
      stored,
      now: () => now,
      confirmLine: (line) => confirmStored(session, line, now),
    });
    if (!plan.ok) {
      await noteFailure(admin, companyId, plan.code);
      throw new Error(plan.code);
    }
    const saved = await admin.rpc("upsert_connector_lines", {
      p_company: companyId,
      p_provider: "mercury",
      p_lines: {
        lines: plan.lines,
        removed_ids: plan.removedIds,
        complete: plan.complete,
      },
      p_next_cursor: plan.nextCursor,
      p_expected_prev_cursor: row.sync_cursor,
    });
    if (saved.error) {
      if ((saved.error.message ?? "").includes("sync_cursor_conflict")) {
        await admin
          .from("connector_connections")
          .update({ last_error: "sync_cursor_conflict" })
          .eq("company_id", companyId)
          .eq("provider", "mercury");
        throw new Error("sync_cursor_conflict");
      }
      await noteFailure(admin, companyId, "rejected");
      throw new Error("rejected");
    }
    if (plan.complete) {
      await admin.from("connector_skips").delete().eq("company_id", companyId).eq("provider", "mercury");
    }
    if (plan.skips.length > 0) {
      const inserted = await admin.from("connector_skips").insert(plan.skips.map((skip) => ({
        company_id: companyId,
        provider: "mercury",
        external_id: skip.externalId,
        reason: skip.reason,
      })));
      if (inserted.error) {
        await noteFailure(admin, companyId, "rejected");
        throw new Error("rejected");
      }
    }
    const pendingMissing: Record<string, string> = {};
    for (const item of plan.pendingMissing) pendingMissing[item.externalId] = item.missingSince;
    const labeled = await admin
      .from("connector_connections")
      .update({
        account_labels: plan.accounts,
        settings: { ...settings, own_counterparty_ids: ownCounterpartyIds, pending_missing: pendingMissing },
      })
      .eq("company_id", companyId)
      .eq("provider", "mercury");
    if (labeled.error) {
      await noteFailure(admin, companyId, "rejected");
      throw new Error("rejected");
    }
    return { ok: true, lines: plan.lines.length };
  } catch (error) {
    logFailure("mercury sync failed", error, apiKey);
    if (error instanceof Error && (
      error.message === "sync_cursor_conflict" ||
      error.message === "auth" ||
      error.message === "rejected" ||
      error.message === "rate_limited" ||
      error.message === "transient" ||
      error.message === "sync_page_cap"
    )) {
      throw error;
    }
    const code = "transient";
    await noteFailure(admin, companyId, code);
    throw new Error(code);
  }
}

async function noteFailure(admin: SupabaseClient, companyId: string, code: string): Promise<void> {
  const noted = await admin.rpc("note_connector_failure", {
    p_company: companyId,
    p_provider: "mercury",
    p_code: code,
  });
  if (noted.error) {
    await admin
      .from("connector_connections")
      .update({ last_error: code })
      .eq("company_id", companyId)
      .eq("provider", "mercury");
  }
}

async function loadStored(
  admin: SupabaseClient,
  companyId: string,
  missing: Record<string, string>,
): Promise<StoredLine[]> {
  const rows = await admin
    .from("transactions")
    .select("external_id, line_status, doc_date")
    .eq("company_id", companyId)
    .eq("source", "mercury")
    .in("line_status", ["pending", "posted"])
    .is("removed_at", null);
  if (rows.error || !rows.data) return [];
  const stored: StoredLine[] = [];
  for (const row of rows.data as Array<{ external_id: string; line_status: string; doc_date: string }>) {
    if (row.line_status !== "pending" && row.line_status !== "posted") continue;
    if (typeof row.external_id !== "string" || typeof row.doc_date !== "string") continue;
    stored.push({
      externalId: row.external_id,
      lineStatus: row.line_status,
      docDate: row.doc_date,
      missingSince: missing[row.external_id] ?? null,
    });
  }
  return stored;
}

async function confirmStored(session: ConnectorSession, line: StoredLine, now: Date): Promise<ConfirmResult> {
  if (line.lineStatus === "pending") {
    const since = line.missingSince ?? now.toISOString();
    const result = await recheckMissingPending(session, line.externalId, since, now);
    if (result.action === "keep") return { action: "keep", missingSince: since };
    if (result.action === "void") return { action: "void" };
    return { action: "update", raw: result.raw };
  }
  const raw = await getMercuryTransaction(session, line.externalId);
  if (raw == null) return { action: "keep", missingSince: line.missingSince ?? now.toISOString() };
  const status = isRecord(raw) && typeof raw.status === "string" ? raw.status : "";
  if (isVoidMercuryStatus(status)) return { action: "void" };
  return { action: "update", raw };
}
