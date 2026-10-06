import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CONNECTOR_RECHECK_LIMIT, planConnectorSync, type ConfirmResult, type StoredLine } from "../_shared/connectors/engine.ts";
import { MERCURY_KEK_REF, MERCURY_POSTED_LOOKBACK_DAYS } from "../_shared/connectors/mercury/capabilities.ts";
import { mercuryAdapter } from "../_shared/connectors/mercury/adapter.ts";
import {
  MercuryRequestError,
  getMercuryTransaction,
  recheckMissingPending,
} from "../_shared/connectors/mercury/client.ts";
import { addCalendarDays, jerusalemDate } from "../_shared/connectors/mercury/dates.ts";
import { redactMercury } from "../_shared/connectors/mercury/redact.ts";
import { treasuryVoidIds, type TreasuryStoredLine } from "../_shared/connectors/mercury/normalize.ts";
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
 * Mercury sync. The cron header drains Mercury refresh requests only.
 * The connector drain posts this function for Mercury and sumit-sync for SUMIT.
 * sumit-sync is not called from here and is not changed.
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
      const due = await admin.rpc("claim_connector_refreshes", { p_limit: 20, p_provider: "mercury" });
      if (due.error) return json({ error: "could not read the refresh queue" }, 500);
      const results = [];
      for (const row of (due.data ?? []) as Array<{ id: number; company_id: string; provider: string }>) {
        if (row.provider !== "mercury") continue;
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
): Promise<{ ok: boolean; lines: number; skipped?: boolean; inserted?: number; updated?: number; removed?: number; newest_date?: string | null }> {
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
  if (!alreadyClaimed) {
    const cutoff = new Date(Date.now() - CLAIM_MS).toISOString();
    const claim = await admin
      .from("connector_connections")
      .update({ sync_claimed_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("provider", "mercury")
      .or(`sync_claimed_at.is.null,sync_claimed_at.lt.${cutoff}`)
      .select("company_id");
    if (claim.error) throw new Error("rejected");
    if (claim.data == null || claim.data.length === 0) return { ok: true, lines: 0, skipped: true };
  }
  let noted = false;
  const noteOnce = async (code: string) => {
    noted = true;
    await noteFailure(admin, companyId, code);
  };

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
    const now = new Date();
    const windowStart = addCalendarDays(jerusalemDate(now.toISOString()), -MERCURY_POSTED_LOOKBACK_DAYS);
    const loaded = await loadStored(admin, companyId, missing, windowStart);
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
      stored: loaded.stored,
      now: () => now,
      confirmLine: (line) => confirmStored(session, line, now),
      resolveRemovedIds: (rawLines) => treasuryVoidIds(rawLines, loaded.treasury),
    });
    if (!plan.ok) {
      await noteOnce(plan.code);
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
      await noteOnce("rejected");
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
        await noteOnce("rejected");
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
      await noteOnce("rejected");
      throw new Error("rejected");
    }
    if (plan.rechecked.length > 0) await stampChecked(admin, companyId, plan.rechecked);
    if (plan.complete) {
      const stamped = await admin.rpc("stamp_connector_sync", { p_company: companyId, p_provider: "mercury" });
      if (stamped.error) {
        await noteOnce("rejected");
        throw new Error("rejected");
      }
    }
    const counts = saved.data as { inserted?: number; updated?: number; removed?: number } | null;
    let newestDate: string | null = null;
    try {
      const newest = await admin
        .from("transactions")
        .select("doc_date")
        .eq("company_id", companyId)
        .eq("source", "mercury")
        .is("removed_at", null)
        .order("doc_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!newest.error && newest.data?.doc_date) {
        newestDate = String(newest.data.doc_date);
      }
    } catch {
      newestDate = null;
    }
    return {
      ok: true,
      lines: plan.lines.length,
      inserted: counts?.inserted ?? 0,
      updated: counts?.updated ?? 0,
      removed: counts?.removed ?? 0,
      newest_date: newestDate,
    };
  } catch (error) {
    logFailure("mercury sync failed", error, apiKey);
    const message = error instanceof Error ? error.message : "";
    const specific = error instanceof MercuryRequestError ? error.code : message;
    const kept = specific === "sync_cursor_conflict" || specific === "auth" || specific === "rejected" ||
      specific === "rate_limited" || specific === "transient" || specific === "sync_page_cap";
    if (kept) {
      if (!noted && error instanceof MercuryRequestError && error.message !== specific) {
        await noteFailure(admin, companyId, specific);
      }
      throw new Error(specific);
    }
    if (noted) throw error instanceof Error ? error : new Error("sync failed");
    await noteFailure(admin, companyId, "transient");
    throw new Error("transient");
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

const STORED_PAGE = 1000;
const STORED_COLUMNS = "external_id, line_status, doc_date, amount_original, source_account_id, provider_meta";

interface StoredRow {
  external_id: string;
  line_status: string;
  doc_date: string;
  amount_original: number | null;
  source_account_id: string | null;
  provider_meta: unknown;
}

function checkedAtOf(meta: unknown): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const value = (meta as { checked_at?: unknown }).checked_at;
  return typeof value === "string" && value.length > 0 && value.length <= 40 ? value : null;
}

function kindOf(meta: unknown): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const value = (meta as { kind?: unknown }).kind;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function baseStored(admin: SupabaseClient, companyId: string) {
  return admin
    .from("transactions")
    .select(STORED_COLUMNS)
    .eq("company_id", companyId)
    .eq("source", "mercury")
    .is("removed_at", null);
}

type StoredFilter = ReturnType<typeof baseStored>;

async function readPages(
  admin: SupabaseClient,
  companyId: string,
  apply: (query: StoredFilter) => StoredFilter,
): Promise<StoredRow[]> {
  const rows: StoredRow[] = [];
  for (let from = 0; from < STORED_PAGE * 20; from += STORED_PAGE) {
    const page = await apply(baseStored(admin, companyId))
      .order("external_id", { ascending: true })
      .range(from, from + STORED_PAGE - 1);
    if (page.error) throw new Error("could not read stored lines");
    const batch = (page.data ?? []) as StoredRow[];
    rows.push(...batch);
    if (batch.length < STORED_PAGE) return rows;
  }
  throw new Error("could not read stored lines");
}

async function loadStored(
  admin: SupabaseClient,
  companyId: string,
  missing: Record<string, string>,
  windowStart: string,
): Promise<{ stored: StoredLine[]; treasury: TreasuryStoredLine[] }> {
  const pending = await readPages(admin, companyId, (query) => query.eq("line_status", "pending"));
  const unchecked = await admin
    .from("transactions")
    .select(STORED_COLUMNS)
    .eq("company_id", companyId)
    .eq("source", "mercury")
    .eq("line_status", "posted")
    .is("removed_at", null)
    .lt("doc_date", windowStart)
    .filter("provider_meta->>checked_at", "is", null)
    .order("doc_date", { ascending: true })
    .limit(CONNECTOR_RECHECK_LIMIT);
  if (unchecked.error) throw new Error("could not read stored lines");
  const oldRows = (unchecked.data ?? []) as StoredRow[];
  if (oldRows.length < CONNECTOR_RECHECK_LIMIT) {
    const checked = await admin
      .from("transactions")
      .select(STORED_COLUMNS)
      .eq("company_id", companyId)
      .eq("source", "mercury")
      .eq("line_status", "posted")
      .is("removed_at", null)
      .lt("doc_date", windowStart)
      .not("provider_meta->>checked_at", "is", null)
      .order("provider_meta->>checked_at", { ascending: true })
      .limit(CONNECTOR_RECHECK_LIMIT - oldRows.length);
    if (checked.error) throw new Error("could not read stored lines");
    oldRows.push(...(checked.data ?? []) as StoredRow[]);
  }
  const treasury = await readPages(admin, companyId, (query) =>
    query.eq("line_status", "posted").or(
      "provider_meta->>kind.eq.interestPosted,provider_meta->>kind.eq.dividendPosted,provider_meta->>kind.eq.mercuryFeePosted",
    )
  );

  const stored: StoredLine[] = [];
  const seen = new Set<string>();
  for (const row of [...pending, ...oldRows]) {
    if (row.line_status !== "pending" && row.line_status !== "posted") continue;
    if (typeof row.external_id !== "string" || typeof row.doc_date !== "string" || seen.has(row.external_id)) continue;
    seen.add(row.external_id);
    stored.push({
      externalId: row.external_id,
      lineStatus: row.line_status,
      docDate: row.doc_date,
      missingSince: missing[row.external_id] ?? null,
      checkedAt: checkedAtOf(row.provider_meta),
    });
  }
  const yields: TreasuryStoredLine[] = [];
  for (const row of treasury) {
    const kind = kindOf(row.provider_meta);
    if (!kind || typeof row.external_id !== "string" || typeof row.amount_original !== "number") continue;
    if (yields.some((item) => item.externalId === row.external_id)) continue;
    yields.push({
      externalId: row.external_id,
      kind,
      amountCents: Math.abs(row.amount_original),
      accountId: typeof row.source_account_id === "string" ? row.source_account_id : null,
      docDate: row.doc_date,
    });
  }
  return { stored, treasury: yields };
}

async function stampChecked(
  admin: SupabaseClient,
  companyId: string,
  rechecked: { externalId: string; checkedAt: string }[],
): Promise<void> {
  for (const item of rechecked) {
    const current = await admin
      .from("transactions")
      .select("provider_meta")
      .eq("company_id", companyId)
      .eq("source", "mercury")
      .eq("external_id", item.externalId)
      .maybeSingle();
    if (current.error) throw new Error("rejected");
    const meta = isRecord(current.data?.provider_meta) ? current.data.provider_meta : {};
    const saved = await admin
      .from("transactions")
      .update({ provider_meta: { ...meta, checked_at: item.checkedAt } })
      .eq("company_id", companyId)
      .eq("source", "mercury")
      .eq("external_id", item.externalId);
    if (saved.error) throw new Error("rejected");
  }
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
