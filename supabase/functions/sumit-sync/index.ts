import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decodeKek, openApiKey, type Envelope } from "../_shared/envelope.ts";
import { empty, json } from "../_shared/http.ts";
import { assertSumitUrl, deriveLine, mapCrmEntity, type SumitDoc } from "../_shared/ledger.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

const LIST_FOLDERS = "https://api.sumit.co.il/crm/schema/listfolders/";
const LIST_ENTITIES = "https://api.sumit.co.il/crm/data/listentities/";
const PAGE_CAP = 20;
const BACKOFF_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];
const te = new TextEncoder();

function backoffDelay(attempts: number): number {
  const index = Math.min(BACKOFF_MS.length, Math.max(1, attempts)) - 1;
  return BACKOFF_MS[index] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 24 * 60 * 60_000;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return empty();
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const kekSecret = Deno.env.get("SUMIT_KEK") ?? "";
  if (!url || !anon || !service || !kekSecret) return json({ error: "server is missing a secret" }, 500);
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const cron = req.headers.get("x-flow-cron");
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
    if (cron && cronSecret && constantTimeEqual(cron, cronSecret)) {
      const due = await admin
        .from("sumit_refresh_requests")
        .select("id, company_id")
        .is("claimed_at", null)
        .limit(20);
      if (due.error) return json({ error: "could not read the refresh queue" }, 500);
      const companyIds = [...new Set((due.data ?? []).map((row) => row.company_id as string))];
      const waiting = companyIds.length === 0
        ? { data: [] as Array<{ company_id: string; next_attempt_at: string | null }>, error: null }
        : await admin.from("sumit_connections").select("company_id, next_attempt_at").in("company_id", companyIds);
      if (waiting.error) return json({ error: "could not read the refresh queue" }, 500);
      const blocked = new Set(
        (waiting.data ?? [])
          .filter((row) => row.next_attempt_at != null && Date.parse(row.next_attempt_at) > Date.now())
          .map((row) => row.company_id),
      );
      const results = [];
      for (const row of due.data ?? []) {
        if (blocked.has(row.company_id as string)) continue;
        const claim = await admin
          .from("sumit_refresh_requests")
          .update({ claimed_at: new Date().toISOString() })
          .eq("id", row.id)
          .is("claimed_at", null)
          .select("id");
        if (claim.error || claim.data == null || claim.data.length === 0) continue;
        try {
          results.push(await syncCompany(admin, row.company_id as string, decodeKek(kekSecret), false));
        } catch (error) {
          await admin.from("sumit_refresh_requests").update({ claimed_at: null }).eq("id", row.id);
          const message = error instanceof Error ? error.message : "sync failed";
          if (message !== "sumit_rejected") {
            const code = message === "sync_page_cap" ? "sync_page_cap" : "sync_failed";
            await admin.from("sumit_connections").update({ last_error: code }).eq("company_id", row.company_id);
          }
          console.error("sumit-sync cron", message.replace(/[A-Za-z0-9+/=]{16,}/g, "[redacted]"));
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
    const result = await syncCompany(admin, company.data.id, decodeKek(kekSecret), body.force === true);
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync failed";
    console.error("sumit-sync", message.replace(/[A-Za-z0-9+/=]{16,}/g, "[redacted]"));
    const known = message === "sync_failed" || message === "sync_page_cap" || message === "sumit_rejected" || message === "SUMIT is not connected" || message === "unauthorized" || message === "no company";
    const code = known ? message : "sync_failed";
    return json({ error: code }, 500);
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

async function syncCompany(
  admin: SupabaseClient,
  companyId: string,
  kek: Uint8Array,
  force: boolean,
): Promise<{ ok: boolean; documents: number; skipped?: boolean }> {
  const connection = await admin
    .from("sumit_connections")
    .select("sumit_company_id, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version, envelope_version, last_sync_at")
    .eq("company_id", companyId)
    .maybeSingle();
  if (connection.error || !connection.data) throw new Error("SUMIT is not connected");
  const row = connection.data;
  const last = row.last_sync_at ? Date.parse(row.last_sync_at as string) : 0;
  const minGap = force ? 60_000 : 6 * 60 * 60 * 1000;
  if (last && Date.now() - last < minGap) return { ok: true, documents: 0, skipped: true };

  const envelope: Envelope = {
    keyCiphertext: String(row.key_ciphertext),
    keyNonce: String(row.key_nonce),
    dekCiphertext: String(row.dek_ciphertext),
    dekNonce: String(row.dek_nonce),
    kekVersion: String(row.kek_version),
    ...(row.envelope_version == null ? {} : { envelopeVersion: String(row.envelope_version) }),
  };
  if (!envelope.keyCiphertext.startsWith("\\x")) {
    envelope.keyCiphertext = bytesPrefix(row.key_ciphertext);
    envelope.keyNonce = bytesPrefix(row.key_nonce);
    envelope.dekCiphertext = bytesPrefix(row.dek_ciphertext);
    envelope.dekNonce = bytesPrefix(row.dek_nonce);
  }
  const sumitCompanyId = Number(row.sumit_company_id);
  let apiKey = "";
  try {
    apiKey = await openApiKey(envelope, kek, companyId);
    const documents = await listDocuments(sumitCompanyId, apiKey);
    await writeLedger(admin, companyId, documents);
    const stamped = await admin.rpc("stamp_sumit_sync", { p_company: companyId });
    if (stamped.error) throw new Error("could not stamp the sync");
    return { ok: true, documents: documents.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync failed";
    const safe = apiKey === "" ? message : message.replaceAll(apiKey, "[redacted]");
    console.error("sumit sync failed", safe.replace(/[A-Za-z0-9+/=]{16,}/g, "[redacted]").slice(0, 400));
    const code = message === "sync_page_cap" ? "sync_page_cap" : message === "sumit_rejected" ? "sumit_rejected" : "sync_failed";
    if (code === "sumit_rejected") {
      const current = await admin.from("sumit_connections").select("reject_attempts").eq("company_id", companyId).maybeSingle();
      const attempts = Number(current.data?.reject_attempts ?? 0) + 1;
      await admin.from("sumit_connections").update({
        last_error: "sumit_rejected",
        reject_attempts: attempts,
        next_attempt_at: new Date(Date.now() + backoffDelay(attempts)).toISOString(),
      }).eq("company_id", companyId);
    } else {
      await admin.from("sumit_connections").update({ last_error: code }).eq("company_id", companyId);
    }
    throw new Error(code);
  }
}

function bytesPrefix(value: unknown): string {
  if (typeof value === "string") {
    if (value.startsWith("\\x")) return value;
    if (/^[0-9a-fA-F]+$/.test(value)) return `\\x${value}`;
  }
  return String(value);
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
    const userMessage = typeof record.UserErrorMessage === "string" ? record.UserErrorMessage : "SUMIT rejected the call";
    console.error("sumit rejected", userMessage.replace(/[A-Za-z0-9+/=]{16,}/g, "[redacted]").slice(0, 200));
    throw new Error("sumit_rejected");
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

async function listDocuments(companyId: number, apiKey: string): Promise<SumitDoc[]> {
  const credentials = { CompanyID: companyId, APIKey: apiKey };
  const folders = await sumitCall(LIST_FOLDERS, credentials, {});
  const folder = findFolder(folders, "מסמכים");
  if (folder == null) throw new Error("SUMIT documents folder was not found");
  const docs: SumitDoc[] = [];
  let dropped = 0;
  let start = 0;
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const payload = await sumitCall(LIST_ENTITIES, credentials, {
      Folder: folder,
      IncludeInheritedFolders: true,
      LoadProperties: true,
      Paging: { StartIndex: start, PageSize: 1000 },
    });
    const data = payload.Data;
    const entities = extractEntities(data);
    for (const entity of entities) {
      if (!entity || typeof entity !== "object") continue;
      const mapped = mapCrmEntity(entity as Record<string, unknown>);
      if (mapped) docs.push(mapped);
      else dropped += 1;
    }
    const hasNext = Boolean(
      data && typeof data === "object" && "HasNextPage" in data && (data as { HasNextPage?: boolean }).HasNextPage,
    );
    if (!hasNext || entities.length === 0) {
      if (dropped > 0) console.error("sumit-sync dropped entities", dropped);
      return docs;
    }
    start += entities.length;
  }
  if (dropped > 0) console.error("sumit-sync dropped entities", dropped);
  throw new Error("sync_page_cap");
}

function extractEntities(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  for (const key of ["Entities", "Data", "List"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function docKind(kind: SumitDoc["kind"]): string {
  if (kind === "inv") return "invoice";
  if (kind === "rec") return "receipt";
  if (kind === "invrec") return "invoice_receipt";
  if (kind === "cred") return "credit";
  return "expense";
}

async function writeLedger(admin: SupabaseClient, companyId: string, docs: SumitDoc[]): Promise<void> {
  const company = await admin.from("companies").select("vat_rate_bp").eq("id", companyId).single();
  if (company.error || !company.data) throw new Error("could not read the company");
  const rate = Number(company.data.vat_rate_bp);
  const suppliers = await admin.from("suppliers").select("name, vat_exempt").eq("company_id", companyId);
  if (suppliers.error) throw new Error("could not read suppliers");
  const exempt = new Map<string, boolean>();
  for (const row of suppliers.data ?? []) {
    exempt.set(String(row.name), row.vat_exempt === true);
  }

  const byId = new Map(docs.map((doc) => [doc.sumit_id, doc]));
  const payload = docs.map((doc) => {
    const line = deriveLine(
      doc,
      doc.bud == null ? null : String(doc.bud),
      doc.cust_name != null && exempt.get(doc.cust_name) === true,
      rate,
      byId,
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
    };
  });

  const saved = await admin.rpc("upsert_sumit_documents", { p_company: companyId, p_docs: payload });
  if (saved.error) throw new Error("could not save the documents");
}
