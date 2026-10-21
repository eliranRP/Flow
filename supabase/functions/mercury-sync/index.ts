import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../../packages/shared/src/database.types.ts";
import { planConnectorSync } from "../_shared/connectors/engine.ts";
import {
  MERCURY_KEK_REF,
  MERCURY_POSTED_LOOKBACK_DAYS,
  MERCURY_TRANSFER_SKIPS,
} from "../_shared/connectors/mercury/capabilities.ts";
import { mercuryAdapter } from "../_shared/connectors/mercury/adapter.ts";
import {
  MercuryRequestError,
  backoffUntil,
  mercuryTreasuryAccountCount,
  cardLabelsUpdate,
  listMercuryCardLabels,
} from "../_shared/connectors/mercury/client.ts";
import { addCalendarDays, jerusalemDate } from "../_shared/connectors/mercury/dates.ts";
import { redactMercury } from "../_shared/connectors/mercury/redact.ts";
import { treasuryVoidIds } from "../_shared/connectors/mercury/normalize.ts";
import { isLegacyRow, legacyPatch, rpcWithSlot } from "../_shared/connectors/mercury/legacy.ts";
import {
  readConnectionScope,
  runScope,
  storedLabels,
  withinAccountStart,
  type MercuryConnectionScope,
} from "../_shared/connectors/mercury/scope.ts";
import { constantTimeEqual } from "../_shared/constant-time.ts";
import { bytesPrefix, decodeKek, openApiKey, type Envelope } from "../_shared/envelope.ts";
import { empty, json } from "../_shared/http.ts";
import { companyHint, ownedCompany, resolveOwnerCompany } from "../_shared/owner.ts";
import { runWithClaim } from "../_shared/cron_claim.ts";
import { confirmStored, loadStored, storedExternalIds } from "./stored.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

type Admin = SupabaseClient<Database>;

const CLAIM_MS = 10 * 60 * 1000;
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
 *
 * FLOW-938: a company may hold several Mercury connections. A run claims all of them, then syncs each
 * connection whose accounts are chosen, one after another, each with its own key, cursor, failure and
 * stamp, scoped to the accounts the owner chose. The counts add up across connections.
 *
 * Until the FLOW-938 migration is pushed (CI deploys the functions first), the schema has no slot,
 * no chosen accounts and no p_slot: then the one connection syncs every account as before (legacy.ts).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return empty();
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const kekSecret = Deno.env.get(MERCURY_KEK_REF) ?? "";
  if (!url || !anon || !service || !kekSecret) return json({ error: "server is missing a secret" }, 500);
  const admin = createClient<Database>(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

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
          // claim_connector_refreshes took the connection claim; an early skip or throw
          // inside syncCompany returns before its own release (FLOW-510). note_connector_failure
          // and upsert_connector_lines clear the claim mid-run, and a manual run can take it
          // then, so only a claim stamped before this run started is released.
          const startedAt = new Date().toISOString();
          results.push(await runWithClaim(
            () => syncCompany(admin, row.company_id, decodeKek(kekSecret), false, true),
            () => admin.from("connector_connections").update({ sync_claimed_at: null })
              .eq("company_id", row.company_id).eq("provider", "mercury")
              .lte("sync_claimed_at", startedAt),
          ));
        } catch (error) {
          await admin.from("connector_refresh_requests").update({ claimed_at: null }).eq("id", row.id);
          logFailure("mercury-sync cron", error, "");
        }
      }
      return json({ ok: true, synced: results.length });
    }

    const header = req.headers.get("Authorization") ?? "";
    const userClient = createClient<Database>(url, anon, {
      global: { headers: { Authorization: header } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const owner = await resolveOwnerCompany(header, {
      getUserId: async () => {
        const user = await userClient.auth.getUser();
        return user.error ? null : user.data.user?.id ?? null;
      },
      ownedBy: (userId) => ownedCompany(admin, userId, companyHint(req)),
      readableCompanies: async () => {
        const rows = await userClient.from("companies").select("id, owner_id");
        return rows.error ? null : (rows.data ?? []) as Array<{ id: string; owner_id: string }>;
      },
    });
    if ("error" in owner) return json({ error: owner.error }, owner.error === "unauthorized" ? 401 : 400);
    const body = (await req.json().catch(() => ({}))) as { force?: boolean };
    const result = await syncCompany(admin, owner.companyId, decodeKek(kekSecret), body.force === true, false);
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

function logFailure(label: string, error: unknown, secret: string): void {
  const message = error instanceof Error ? error.message : "sync failed";
  const scrubbed = secret ? message.replaceAll(secret, "[redacted]") : message;
  console.error(label, String(redactMercury(scrubbed)).slice(0, 400));
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

type SyncResult = {
  ok: boolean;
  lines: number;
  skipped?: boolean;
  complete?: boolean;
  inserted?: number;
  updated?: number;
  removed?: number;
  newest_date?: string | null;
};

// Every column, so the schema before FLOW-938 reads too: a row without slot is that schema (legacy.ts).
type ConnectionRow = {
  slot: number;
  key_ciphertext: unknown;
  key_nonce: unknown;
  dek_ciphertext: unknown;
  dek_nonce: unknown;
  kek_version: unknown;
  envelope_version: unknown;
  sync_cursor: string | null;
  import_from: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  next_attempt_at: string | null;
  sync_claimed_at: string | null;
  settings: unknown;
  account_labels: unknown;
  accounts_chosen_at: string | null;
  sync_account_ids: string[] | null;
  account_from: unknown;
};

/** Every chosen connection of the company, one after another, under one claim. */
async function syncCompany(
  admin: Admin,
  companyId: string,
  kek: Uint8Array,
  force: boolean,
  alreadyClaimed: boolean,
): Promise<SyncResult> {
  const read = await admin
    .from("connector_connections")
    .select("*")
    .eq("company_id", companyId)
    .eq("provider", "mercury");
  if (read.error || (read.data ?? []).length === 0) throw new Error("Mercury is not connected");
  const legacy = (read.data ?? []).some((row) => isLegacyRow(row));
  const scopes = (read.data ?? []).map((row) => readConnectionScope(row as Record<string, unknown>));
  const rows = (read.data ?? [])
    .map((row, index) => ({ ...(row as unknown as ConnectionRow), slot: scopes[index]!.slot }))
    .sort((left, right) => left.slot - right.slot);
  // A connection waits for its accounts (set_mercury_accounts) before anything syncs. Asked by hand
  // (the app, sync_bank) that is not connected yet; the drain just passes.
  const chosen = rows.filter((row) => scopes.find((scope) => scope.slot === row.slot)?.chosen === true);
  if (chosen.length === 0) {
    if (alreadyClaimed) return { ok: true, lines: 0, skipped: true };
    throw new Error("Mercury is not connected");
  }

  const minGap = force ? FORCE_GAP_MS : QUIET_GAP_MS;
  const due = chosen.filter((row) => {
    if (row.last_error === "auth") return false;
    if (typeof row.next_attempt_at === "string" && Date.parse(row.next_attempt_at) > Date.now()) return false;
    const last = row.last_sync_at ? Date.parse(row.last_sync_at) : 0;
    return !(last && Date.now() - last < minGap);
  });
  if (due.length === 0) {
    // As one connection did: a rejected key first, then a hold, else nothing is due yet.
    if (chosen.every((row) => row.last_error === "auth")) throw new Error("auth");
    const held = chosen
      .map((row) => row.next_attempt_at)
      .filter((at): at is string => typeof at === "string" && Date.parse(at) > Date.now())
      .sort();
    if (held[0] && chosen.every((row) => row.last_error === "auth" || (row.next_attempt_at != null && Date.parse(row.next_attempt_at) > Date.now()))) {
      throw new SyncHold(held[0]);
    }
    return { ok: true, lines: 0, skipped: true };
  }
  if (!alreadyClaimed && rows.some((row) => {
    const claimedAt = typeof row.sync_claimed_at === "string" ? Date.parse(row.sync_claimed_at) : Number.NaN;
    return !Number.isNaN(claimedAt) && Date.now() - claimedAt < CLAIM_MS;
  })) {
    return { ok: true, lines: 0, skipped: true };
  }
  // The stamp this run claims with: the release below clears only this stamp (or, for a cron run,
  // stamps from before it started), so a run that outlives CLAIM_MS never clears a newer run's claim.
  const claimStamp = new Date().toISOString();
  if (!alreadyClaimed) {
    const cutoff = new Date(Date.now() - CLAIM_MS).toISOString();
    const claim = await admin
      .from("connector_connections")
      .update({ sync_claimed_at: claimStamp })
      .eq("company_id", companyId)
      .eq("provider", "mercury")
      .or(`sync_claimed_at.is.null,sync_claimed_at.lt.${cutoff}`)
      .select("company_id");
    if (claim.error) throw new Error("rejected");
    if (claim.data == null || claim.data.length === 0) return { ok: true, lines: 0, skipped: true };
  }
  // Release the claim on every exit, including throws that skip note_connector_failure, so Settings
  // does not show syncing until the 10-minute cutoff.
  try {
    // Lines with no account (from before FLOW-304) belong to the first chosen connection.
    const firstSlot = chosen[0]?.slot ?? 1;
    const results: SyncResult[] = [];
    let firstError: unknown = null;
    for (const row of due) {
      try {
        results.push(await syncConnection(admin, companyId, kek, row, scopes, row.slot === firstSlot, legacy));
      } catch (error) {
        firstError ??= error;
      }
    }
    const ran = results.filter((result) => result.skipped !== true);
    if (ran.length === 0) {
      if (firstError != null) throw firstError;
      return { ok: true, lines: 0, skipped: true };
    }
    return {
      ok: true,
      lines: ran.reduce((sum, result) => sum + result.lines, 0),
      // The app counts new lines only after a run that read everything (FLOW-509).
      complete: firstError == null && ran.every((result) => result.complete === true),
      inserted: ran.reduce((sum, result) => sum + (result.inserted ?? 0), 0),
      updated: ran.reduce((sum, result) => sum + (result.updated ?? 0), 0),
      removed: ran.reduce((sum, result) => sum + (result.removed ?? 0), 0),
      newest_date: await newestDate(admin, companyId),
    };
  } finally {
    const release = admin
      .from("connector_connections")
      .update({ sync_claimed_at: null })
      .eq("company_id", companyId)
      .eq("provider", "mercury");
    await (alreadyClaimed ? release.lte("sync_claimed_at", claimStamp) : release.eq("sync_claimed_at", claimStamp));
  }
}

async function newestDate(admin: Admin, companyId: string): Promise<string | null> {
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
    return !newest.error && newest.data?.doc_date ? String(newest.data.doc_date) : null;
  } catch {
    return null;
  }
}

/** One connection's run: its key, its cursor, the accounts the owner chose and each account's start. */
async function syncConnection(
  admin: Admin,
  companyId: string,
  kek: Uint8Array,
  row: ConnectionRow,
  scopes: readonly MercuryConnectionScope[],
  withoutAccount: boolean,
  legacy: boolean,
): Promise<SyncResult> {
  const slot = row.slot;
  const scope = scopes.find((candidate) => candidate.slot === slot) ?? readConnectionScope(row);
  const accounts = runScope(scope, scopes);
  let noted = false;
  const noteOnce = async (code: string) => {
    noted = true;
    await noteFailure(admin, companyId, slot, code, legacy);
  };
  const updateRow = (patch: Database["public"]["Tables"]["connector_connections"]["Update"]) => {
    const query = admin.from("connector_connections").update(legacyPatch(patch, legacy))
      .eq("company_id", companyId).eq("provider", "mercury");
    return legacy ? query : query.eq("slot", slot);
  };

  const envelope: Envelope = {
    keyCiphertext: bytesPrefix(row.key_ciphertext as string),
    keyNonce: bytesPrefix(row.key_nonce as string),
    dekCiphertext: bytesPrefix(row.dek_ciphertext as string),
    dekNonce: bytesPrefix(row.dek_nonce as string),
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
    // The old schema has one connection: every stored line is its, as before.
    const loaded = await loadStored(
      admin,
      companyId,
      missing,
      windowStart,
      legacy ? null : { accountIds: scope.accountIds, withoutAccount },
    );
    const plan = await planConnectorSync({
      port: mercuryAdapter,
      session,
      cursor: typeof row.sync_cursor === "string" ? row.sync_cursor : null,
      importFrom: typeof row.import_from === "string" ? row.import_from : null,
      lookbackDays: MERCURY_POSTED_LOOKBACK_DAYS,
      // A transfer to an account no one syncs is money out, hinted to transfers like an own account
      // that is not connected (decision 0086).
      ownCounterpartyIds: legacy ? ownCounterpartyIds : [...new Set([...ownCounterpartyIds, ...accounts.outside])],
      // The old schema chose no accounts: every account the key lists syncs, as before.
      accountScope: legacy ? undefined : { synced: accounts.synced, own: accounts.own },
      vatRateBp: 0,
      exemptSupplierNames: [],
      exemptSupplierIds: [],
      stored: loaded.stored,
      now: () => now,
      confirmLine: (line) => confirmStored(session, line, now),
      resolveRemovedIds: (rawLines) =>
        treasuryVoidIds(rawLines, loaded.treasury, mercuryTreasuryAccountCount(session)),
      // An account newly synced (the answer yes, the edit list, set_bank_accounts) turns a transfer
      // imported earlier as money out into a skipped one; its stored copy is voided.
      voidStoredSkips: {
        reasons: MERCURY_TRANSFER_SKIPS,
        storedIds: (ids) => storedExternalIds(admin, companyId, ids),
      },
    });
    if (!plan.ok) {
      await noteOnce(plan.code);
      throw new Error(plan.code);
    }
    const lines = withinAccountStart(plan.lines, scope.accountFrom);
    // The skip records and recheck stamps commit with the lines (FLOW-509).
    const { result: saved } = await rpcWithSlot(
      (args) => admin.rpc("upsert_connector_lines", args as Database["public"]["Functions"]["upsert_connector_lines"]["Args"]),
      {
        p_company: companyId,
        p_provider: "mercury",
        p_lines: {
          lines,
          removed_ids: plan.removedIds,
          complete: plan.complete,
          skips: plan.skips.map((skip) => ({ external_id: skip.externalId, reason: skip.reason })),
          checked: plan.rechecked.map((item) => ({ external_id: item.externalId, checked_at: item.checkedAt })),
        } as unknown as Json,
        // Both cursors are nullable text.
        p_next_cursor: plan.nextCursor,
        p_expected_prev_cursor: row.sync_cursor,
      },
      slot,
      legacy,
    );
    if (saved.error) {
      if ((saved.error.message ?? "").includes("sync_cursor_conflict")) {
        await updateRow({ last_error: "sync_cursor_conflict" });
        throw new Error("sync_cursor_conflict");
      }
      await noteOnce("rejected");
      throw new Error("rejected");
    }
    const pendingMissing: Record<string, string> = {};
    for (const item of plan.pendingMissing) pendingMissing[item.externalId] = item.missingSince;
    // The card nicknames are extra (FLOW-707): when Mercury doesn't list them, the stored ones stay.
    const cardLabels = await listMercuryCardLabels(session);
    const labeled = await updateRow({
      account_labels: storedLabels(plan.accounts) as unknown as NonNullable<Json>,
      ...(plan.org ? { org_label: plan.org } : {}),
      ...cardLabelsUpdate(cardLabels),
      settings: { ...settings, own_counterparty_ids: ownCounterpartyIds, pending_missing: pendingMissing },
    });
    if (labeled.error) {
      await noteOnce("rejected");
      throw new Error("rejected");
    }
    if (plan.complete) {
      const { result: stamped } = await rpcWithSlot(
        (args) => admin.rpc("stamp_connector_sync", args as Database["public"]["Functions"]["stamp_connector_sync"]["Args"]),
        { p_company: companyId, p_provider: "mercury" },
        slot,
        legacy,
      );
      if (stamped.error) {
        await noteOnce("rejected");
        throw new Error("rejected");
      }
    }
    if (plan.rateLimited) {
      // A recheck hit Mercury's rate limit. The lines are saved; hold the next run.
      const backoff = await updateRow({ next_attempt_at: backoffUntil(plan.rateLimited.retryAfter, new Date()) });
      // Fail closed: if the hold cannot be written, note_connector_failure still holds 15 minutes.
      if (backoff.error) await noteOnce("rate_limited");
    }
    const counts = saved.data as { inserted?: number; updated?: number; removed?: number } | null;
    return {
      ok: true,
      lines: lines.length,
      complete: plan.complete,
      inserted: counts?.inserted ?? 0,
      updated: counts?.updated ?? 0,
      removed: counts?.removed ?? 0,
    };
  } catch (error) {
    logFailure("mercury sync failed", error, apiKey);
    const message = error instanceof Error ? error.message : "";
    const specific = error instanceof MercuryRequestError ? error.code : message;
    const kept = specific === "sync_cursor_conflict" || specific === "auth" || specific === "rejected" ||
      specific === "rate_limited" || specific === "transient" || specific === "sync_page_cap";
    if (kept) {
      if (!noted && error instanceof MercuryRequestError && error.message !== specific) {
        await noteFailure(admin, companyId, slot, specific, legacy);
      }
      throw new Error(specific);
    }
    if (noted) throw error instanceof Error ? error : new Error("sync failed");
    await noteFailure(admin, companyId, slot, "transient", legacy);
    throw new Error("transient");
  }
}

async function noteFailure(admin: Admin, companyId: string, slot: number, code: string, legacy: boolean): Promise<void> {
  const { result: noted } = await rpcWithSlot(
    (args) => admin.rpc("note_connector_failure", args as Database["public"]["Functions"]["note_connector_failure"]["Args"]),
    { p_company: companyId, p_provider: "mercury", p_code: code },
    slot,
    legacy,
  );
  if (noted.error) {
    const query = admin
      .from("connector_connections")
      .update({ last_error: code })
      .eq("company_id", companyId)
      .eq("provider", "mercury");
    await (legacy ? query : query.eq("slot", slot));
  }
}
