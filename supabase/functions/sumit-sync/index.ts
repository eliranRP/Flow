import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../packages/shared/src/database.types.ts";
import { constantTimeEqual } from "../_shared/constant-time.ts";
import { decodeKek, envelopeFromRow, openApiKey } from "../_shared/envelope.ts";
import { empty, json } from "../_shared/http.ts";
import { assertSumitUrl, deriveLine, documentUrls, invoicesMissingLinks, type SumitDoc } from "../_shared/ledger.ts";
import { isMissingFunction } from "../_shared/connectors/mercury/legacy.ts";
import { SUMIT_PAGE_CAP, SUMIT_PAGE_SIZE } from "../_shared/connectors/sumit/pull.ts";
import { pullSkips } from "../_shared/connectors/sumit/pull_state.ts";
import { pullRun, type StorePlan, type WriteResult } from "../_shared/connectors/sumit/run.ts";
import { companyHint, ownedCompany } from "../_shared/owner.ts";
import { classifySumitStatus } from "../_shared/sumit-policy.ts";
import { refreshSettle, settleRefresh, type RefreshSettle } from "../_shared/refresh_queue.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

const LIST_FOLDERS = "https://api.sumit.co.il/crm/schema/listfolders/";
const LIST_ENTITIES = "https://api.sumit.co.il/crm/data/listentities/";
const LIST_DOCUMENTS = "https://api.sumit.co.il/accounting/documents/list/";
const CLAIM_MS = 10 * 60 * 1000;

class SyncHold extends Error {
  readonly retryAt: string;
  constructor(retryAt: string) {
    super("sumit_rejected");
    this.retryAt = retryAt;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return empty();
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const kekSecret = Deno.env.get("SUMIT_KEK") ?? "";
  if (!url || !anon || !service || !kekSecret) return json({ error: "server is missing a secret" }, 500);
  const admin = createClient<Database>(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const cron = req.headers.get("x-flow-cron");
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
    if (cron && cronSecret && constantTimeEqual(cron, cronSecret)) {
      const due = await admin.rpc("list_due_refresh_requests", { p_limit: 20 });
      if (due.error) return json({ error: "could not read the refresh queue" }, 500);
      const results = [];
      // `forced` is missing until the FLOW-1163 migration is pushed: then every request is unforced.
      for (const row of (due.data ?? []) as Array<{ id: number; company_id: string; forced?: boolean }>) {
        const claim = await admin
          .from("sumit_refresh_requests")
          .update({ claimed_at: new Date().toISOString() })
          .eq("id", row.id)
          .is("claimed_at", null)
          .select("id");
        if (claim.error || claim.data == null || claim.data.length === 0) continue;
        // The request's moves (refresh_queue.ts): a run that threw, or found a manual run holding
        // the connection, goes back to the queue; one that synced, or skipped inside the quiet gap,
        // finishes it.
        const settle = (move: RefreshSettle) => settleRefresh(
          (args) => admin.rpc("settle_connector_refresh", args),
          {
            requeue: () => admin.from("sumit_refresh_requests").update({ claimed_at: null }).eq("id", row.id),
            finish: () => admin.from("sumit_refresh_requests").delete().eq("id", row.id),
          },
          row.id,
          move,
        );
        try {
          // The cron path claims the connection too, so it never overlaps a manual run (FLOW-510).
          const synced = await syncCompany(admin, row.company_id, decodeKek(kekSecret), row.forced === true, true, true);
          const move = refreshSettle(synced);
          await settle(move);
          if (move === "requeue") continue;
          results.push(synced);
        } catch (error) {
          await settle(refreshSettle("threw"));
          const message = error instanceof Error ? error.message : "sync failed";
          if (message !== "sumit_rejected" && message !== "sumit_auth") {
            const code = message === "sync_page_cap" || message === "sync_schema_drift" ? message : "sync_failed";
            await noteSyncFailure(admin, row.company_id, code);
          }
          console.error("sumit-sync cron", message.replace(/[A-Za-z0-9+/=]{16,}/g, "[redacted]"));
        }
      }
      return json({ ok: true, synced: results.length });
    }

    const header = req.headers.get("Authorization") ?? "";
    const userClient = createClient<Database>(url, anon, {
      global: { headers: { Authorization: header } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const user = await userClient.auth.getUser();
    if (user.error || !user.data.user) return json({ error: "unauthorized" }, 401);
    const companyId = await ownedCompany(admin, user.data.user.id, companyHint(req));
    if (!companyId) return json({ error: "no company" }, 400);
    const body = (await req.json().catch(() => ({}))) as { force?: boolean };
    const result = await syncCompany(admin, companyId, decodeKek(kekSecret), body.force === true, true, false);
    return json(result);
  } catch (error) {
    if (error instanceof SyncHold) {
      return json({ error: "sumit_rejected", retry_at: error.retryAt }, 429);
    }
    const message = error instanceof Error ? error.message : "sync failed";
    console.error("sumit-sync", message.replace(/[A-Za-z0-9+/=]{16,}/g, "[redacted]"));
    const known = message === "sync_failed" || message === "sync_page_cap" || message === "sync_schema_drift" || message === "sumit_rejected" || message === "sumit_auth" || message === "SUMIT is not connected" || message === "unauthorized" || message === "no company";
    const code = known ? message : "sync_failed";
    return json({ error: code }, message === "sumit_rejected" ? 429 : 500);
  }
});

async function syncCompany(
  admin: SupabaseClient<Database>,
  companyId: string,
  kek: Uint8Array,
  force: boolean,
  claim: boolean,
  drained: boolean,
): Promise<{ ok: boolean; documents: number; skipped?: boolean; busy?: boolean; partial?: boolean; sumit_reads: number }> {
  const connection = await admin
    .from("sumit_connections")
    .select("sumit_company_id, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version, envelope_version, last_sync_at, last_error, next_attempt_at")
    .eq("company_id", companyId)
    .maybeSingle();
  if (connection.error || !connection.data) throw new Error("SUMIT is not connected");
  const row = connection.data;
  if (row.last_error === "sumit_auth") throw new Error("sumit_auth");
  if (typeof row.next_attempt_at === "string" && Date.parse(row.next_attempt_at) > Date.now()) {
    throw new SyncHold(row.next_attempt_at);
  }
  // FLOW-1163: a pull that stopped moving 3 runs in a row waits for the owner's own refresh.
  if (pullSkips(await readSettings(admin, companyId), Number(row.sumit_company_id), { force, drained })) {
    return { ok: true, documents: 0, skipped: true, sumit_reads: 0 };
  }
  const last = row.last_sync_at ? Date.parse(row.last_sync_at as string) : 0;
  const minGap = force ? 60_000 : 6 * 60 * 60 * 1000;
  if (last && Date.now() - last < minGap) return { ok: true, documents: 0, skipped: true, sumit_reads: 0 };
  // Both paths claim the connection like mercury-sync does. Settings reads the claim as
  // `syncing`, so the busy row survives a reload, and a second tap or a cron run is skipped.
  // The stamp this run claims with: the release below clears only this stamp, so a run that
  // outlives CLAIM_MS never clears a newer run's claim.
  const claimStamp = new Date().toISOString();
  if (claim) {
    const cutoff = new Date(Date.now() - CLAIM_MS).toISOString();
    const claimed = await admin
      .from("connector_connections")
      .update({ sync_claimed_at: claimStamp })
      .eq("company_id", companyId)
      .eq("provider", "sumit")
      .or(`sync_claimed_at.is.null,sync_claimed_at.lt.${cutoff}`)
      .select("company_id");
    if (claimed.error) throw new Error("sync_failed");
    if (claimed.data == null || claimed.data.length === 0) {
      return { ok: true, documents: 0, skipped: true, busy: true, sumit_reads: 0 };
    }
  }
  try {
    return await runSync(admin, companyId, kek, row);
  } finally {
    if (claim) {
      await admin
        .from("connector_connections")
        .update({ sync_claimed_at: null })
        .eq("company_id", companyId)
        .eq("provider", "sumit")
        .eq("sync_claimed_at", claimStamp);
    }
  }
}

async function runSync(
  admin: SupabaseClient<Database>,
  companyId: string,
  kek: Uint8Array,
  row: Record<string, unknown>,
): Promise<{ ok: boolean; documents: number; partial?: boolean; sumit_reads: number }> {
  const envelope = envelopeFromRow(row);
  const sumitCompanyId = Number(row.sumit_company_id);
  let apiKey = "";
  try {
    apiKey = await openApiKey(envelope, kek, companyId, "sumit");
    const company = await admin.from("companies").select("vat_rate_bp").eq("id", companyId).single();
    if (company.error || !company.data) throw new Error("could not read the company");
    const rate = Number(company.data.vat_rate_bp);
    const credentials = { CompanyID: sumitCompanyId, APIKey: apiKey };
    const folder = await documentsFolder(credentials);
    // FLOW-1163: the claim is held, so this read is the pull's current state.
    const ran = await pullRun({
      settings: await readSettings(admin, companyId),
      sumitCompanyId,
      companyRateBp: rate,
      now: new Date().toISOString(),
      fetchPage: (start) =>
        sumitCall(LIST_ENTITIES, credentials, {
          Folder: folder,
          IncludeInheritedFolders: true,
          LoadProperties: true,
          Paging: { StartIndex: start, PageSize: SUMIT_PAGE_SIZE },
        }),
      write: async (plan) => {
        const missing = invoicesMissingLinks(plan.batch, await linkedInvoices(admin, companyId));
        const links = missing.from == null
          ? { urls: new Map<number, string>(), reads: 0 }
          : await listDocumentUrls(sumitCompanyId, apiKey, missing.from);
        const saved = await writeLedger(admin, companyId, plan, links.urls, rate);
        return saved ? { saved: true, reads: links.reads } : { saved: false, reason: "missing", reads: links.reads };
      },
    });
    const reads = ran.reads + 1;
    if (!ran.finished) {
      // A partial run stores its pages and the continuation (one write), never sweeps, and does not
      // stamp: the connection reads as it did, not as an error, until a run lists the window to its end.
      // Three runs in a row that left the continuation where it was end in sync_page_cap, as before.
      if (ran.stuck) throw new Error("sync_page_cap");
      return { ok: true, documents: ran.documents, partial: true, sumit_reads: reads };
    }
    const stamped = await admin.rpc("stamp_sumit_sync", { p_company: companyId });
    if (stamped.error) throw new Error("could not stamp the sync");
    return { ok: true, documents: ran.documents, sumit_reads: reads };
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync failed";
    const safe = apiKey === "" ? message : message.replaceAll(apiKey, "[redacted]");
    console.error("sumit sync failed", safe.replace(/[A-Za-z0-9+/=]{16,}/g, "[redacted]").slice(0, 400));
    const code = message === "sync_page_cap" || message === "sync_schema_drift"
      ? message
      : message === "sumit_rejected" || message === "sumit_auth"
        ? message
        : "sync_failed";
    if (code === "sumit_rejected" || code === "sumit_auth") {
      const noted = await admin.rpc("note_sumit_rejection", { p_company: companyId, p_code: code });
      if (noted.error) throw new Error("sync_failed");
    } else {
      await noteSyncFailure(admin, companyId, code);
    }
    throw new Error(code);
  }
}

/** The connection's settings (FLOW-1163: where the pull's continuation is kept); `{}` when unreadable. */
async function readSettings(admin: SupabaseClient<Database>, companyId: string): Promise<Record<string, unknown>> {
  const read = await admin
    .from("connector_connections")
    .select("settings")
    .eq("company_id", companyId)
    .eq("provider", "sumit")
    .maybeSingle();
  const settings = read.error || !read.data ? null : read.data.settings;
  return settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {};
}

/**
 * Wait 15 minutes after sync_failed, sync_page_cap or sync_schema_drift so a stuck page cannot
 * fill the drain.
 */
async function noteSyncFailure(admin: SupabaseClient<Database>, companyId: string, code: string): Promise<void> {
  const noted = await admin.rpc("note_sync_failure", { p_company: companyId, p_code: code });
  if (noted.error) {
    await admin.from("sumit_connections").update({ last_error: code }).eq("company_id", companyId);
  }
}

async function sumitCall(
  url: string,
  credentials: { CompanyID: number; APIKey: string },
  extra: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assertSumitUrl(url);
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ Credentials: credentials, ...extra }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`SUMIT HTTP ${response.status}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("SUMIT returned a non-JSON body");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("SUMIT returned an empty body");
  const record = parsed as Record<string, unknown>;
  if (record.Status !== 0) {
    const userMessage = typeof record.UserErrorMessage === "string" ? record.UserErrorMessage : "";
    console.error("sumit rejected", userMessage.replace(/[A-Za-z0-9+/=]{16,}/g, "[redacted]").slice(0, 200));
    throw new Error(classifySumitStatus(userMessage));
  }
  return record;
}

function folderId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

function findFolder(node: unknown, name: string): number | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFolder(item, name);
      if (found != null) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  const label = record.Name ?? record.FolderName;
  const id = folderId(record.ID ?? record.FolderID ?? record.Id);
  if (label === name && id != null) return id;
  for (const value of Object.values(record)) {
    const found = findFolder(value, name);
    if (found != null) return found;
  }
  return null;
}

async function documentsFolder(credentials: { CompanyID: number; APIKey: string }): Promise<number> {
  const folders = await sumitCall(LIST_FOLDERS, credentials, {});
  const folder = findFolder(folders, "מסמכים");
  if (folder == null) throw new Error("SUMIT documents folder was not found");
  return folder;
}

/** FLOW-335. The SUMIT invoices that already have a stored link, by external id. */
async function linkedInvoices(admin: SupabaseClient<Database>, companyId: string): Promise<Set<string>> {
  const linked = await admin
    .from("transactions")
    .select("external_id")
    .eq("company_id", companyId)
    .eq("doc_kind", "invoice")
    .is("removed_at", null)
    .not("provider_meta->>document_url", "is", null);
  if (linked.error) return new Set();
  return new Set((linked.data ?? []).map((row) => String(row.external_id)));
}

/**
 * FLOW-335. The download links of the tax invoices (type 0) dated from `from`, for the Unpaid
 * list. The sync calls it only while an open invoice has no link, since every call counts
 * against the customer's SUMIT quota. A failure here only loses the links: the sync goes on,
 * and a document keeps the link it had.
 */
async function listDocumentUrls(
  companyId: number,
  apiKey: string,
  from: string,
): Promise<{ urls: Map<number, string>; reads: number }> {
  const credentials = { CompanyID: companyId, APIKey: apiKey };
  const urls = new Map<number, string>();
  let reads = 0;
  let start = 0;
  try {
    for (let page = 0; page < SUMIT_PAGE_CAP; page += 1) {
      reads += 1;
      const payload = await sumitCall(LIST_DOCUMENTS, credentials, {
        DocumentTypes: [0],
        DateFrom: `${from}T00:00:00`,
        Paging: { StartIndex: start, PageSize: 1000 },
      });
      const data = payload.Data;
      for (const [id, url] of documentUrls(data)) urls.set(id, url);
      const documents = data && typeof data === "object" ? (data as Record<string, unknown>).Documents : null;
      const count = Array.isArray(documents) ? documents.length : 0;
      const hasNext = Boolean(
        data && typeof data === "object" && "HasNextPage" in data && (data as { HasNextPage?: boolean }).HasNextPage,
      );
      if (!hasNext || count === 0) return { urls, reads };
      start += count;
    }
    console.error("sumit document links stopped at the page cap");
  } catch (error) {
    const message = error instanceof Error ? error.message : "list failed";
    console.error("sumit document links skipped", message.replace(/[A-Za-z0-9+/=]{16,}/g, "[redacted]").slice(0, 200));
  }
  return { urls, reads };
}

function docKind(kind: SumitDoc["kind"]): string {
  if (kind === "inv") return "invoice";
  if (kind === "rec") return "receipt";
  if (kind === "invrec") return "invoice_receipt";
  if (kind === "cred") return "credit";
  return "expense";
}

/**
 * Stores the plan's documents. Returns false when the plan needs `upsert_sumit_window` and the database
 * does not have it yet (FLOW-1163: edge functions deploy before the migration): the run then fails with
 * sync_page_cap as before, and nothing was written. A plain run keeps calling `upsert_sumit_documents`.
 */
async function writeLedger(
  admin: SupabaseClient<Database>,
  companyId: string,
  plan: StorePlan,
  urls: Map<number, string>,
  rate: number,
): Promise<boolean> {
  const docs = plan.batch;
  const suppliers = await admin.from("suppliers").select("name, vat_exempt").eq("company_id", companyId);
  if (suppliers.error) throw new Error("could not read suppliers");
  const exempt = new Map<string, boolean>();
  for (const row of suppliers.data ?? []) {
    exempt.set(String(row.name), row.vat_exempt === true);
  }

    const payload = docs.map((doc) => {
    const line = deriveLine(
      doc,
      doc.bud == null ? null : String(doc.bud),
      doc.cust_name != null && exempt.get(doc.cust_name) === true,
      rate,
      plan.lookup,
    );
    const expense = line.kind === "exp";
    return {
      idempotency_key: `sumit:${String(line.sumitId)}`,
      external_id: String(line.sumitId),
      direction: expense ? "expense" : "income",
      doc_kind: docKind(line.kind),
      pnl_role: line.role,
      amount_gross: line.grossAgorot.toString(),
      amount_net: line.netAgorot.toString(),
      vat_amount: line.vatAgorot.toString(),
      vat_status: line.vatStatus,
      doc_date: line.date,
      cash_date: line.kind === "inv" || line.kind === "cred" ? null : line.date,
      description: line.description,
      linked_external_id: line.originalSumitId == null ? null : String(line.originalSumitId),
      budget_section_id: line.budgetSectionId,
      budget_section_name: doc.bud_name,
      party_name: doc.cust_name,
      party_kind: doc.cust_name == null ? null : expense ? "supplier" : "customer",
      party_external_id: doc.cust,
      document_url: urls.get(doc.sumit_id) ?? null,
    };
  });

  if (plan.path === "plain") {
    const saved = await admin.rpc("upsert_sumit_documents", { p_company: companyId, p_docs: payload });
    if (saved.error) throw new Error("could not save the documents");
    return true;
  }
  // The documents, the sweep (only when `complete`: a window listed whole in one run) and the
  // continuation are one transaction.
  const saved = await (admin as unknown as WindowRpc).rpc("upsert_sumit_window", {
    p_company: companyId,
    p_docs: payload,
    p_complete: plan.complete,
    p_pull: plan.pull,
  });
  if (isMissingFunction(saved.error)) return false;
  if (saved.error) throw new Error("could not save the documents");
  return true;
}

/** upsert_sumit_window is not in the generated types until the migration is applied and they are regenerated. */
interface WindowRpc {
  rpc(
    name: "upsert_sumit_window",
    args: { p_company: string; p_docs: unknown[]; p_complete: boolean; p_pull: unknown },
  ): PromiseLike<{ error: { code?: string | null; message?: string | null } | null }>;
}
