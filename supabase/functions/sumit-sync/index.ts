import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decodeKek, openApiKey, type Envelope } from "../_shared/envelope.ts";
import {
  FLOW_TEST_EXEMPT_SUPPLIERS,
  FLOW_TEST_SUMIT_COMPANY_ID,
  FLOW_TEST_SUPPLIER_CATEGORY,
  FLOW_TEST_WORKER_DAYS,
  allocateByWeights,
  shareBp,
} from "../_shared/flow-test.ts";
import { empty, json } from "../_shared/http.ts";
import { assertSumitUrl, deriveLine, mapCrmEntity, type LedgerLine, type SumitDoc } from "../_shared/ledger.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

const LIST_FOLDERS = "https://api.sumit.co.il/crm/schema/listfolders/";
const LIST_ENTITIES = "https://api.sumit.co.il/crm/data/listentities/";

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
    if (cron && cronSecret && cron === cronSecret) {
      const due = await admin
        .from("sumit_refresh_requests")
        .select("id, company_id")
        .is("claimed_at", null)
        .limit(20);
      if (due.error) return json({ error: "could not read the refresh queue" }, 500);
      const results = [];
      for (const row of due.data ?? []) {
        await admin.from("sumit_refresh_requests").update({ claimed_at: new Date().toISOString() }).eq("id", row.id);
        results.push(await syncCompany(admin, row.company_id as string, decodeKek(kekSecret), false));
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
    return json(result, result.skipped ? 200 : 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync failed";
    return json({ error: message.replace(/[A-Za-z0-9+/=]{16,}/g, "[redacted]") }, 500);
  }
});

async function syncCompany(
  admin: SupabaseClient,
  companyId: string,
  kek: Uint8Array,
  force: boolean,
): Promise<{ ok: boolean; documents: number; skipped?: boolean }> {
  const connection = await admin
    .from("sumit_connections")
    .select("sumit_company_id, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version, last_sync_at")
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
  };
  if (!envelope.keyCiphertext.startsWith("\\x")) {
    envelope.keyCiphertext = bytesPrefix(row.key_ciphertext);
    envelope.keyNonce = bytesPrefix(row.key_nonce);
    envelope.dekCiphertext = bytesPrefix(row.dek_ciphertext);
    envelope.dekNonce = bytesPrefix(row.dek_nonce);
  }
  const apiKey = await openApiKey(envelope, kek);
  const sumitCompanyId = Number(row.sumit_company_id);
  try {
    const documents = await listDocuments(sumitCompanyId, apiKey);
    await writeLedger(admin, companyId, sumitCompanyId, documents);
    await admin.rpc("sync_review_queue", { p_company_id: companyId });
    await admin
      .from("sumit_connections")
      .update({ last_sync_at: new Date().toISOString(), last_error: null })
      .eq("company_id", companyId);
    return { ok: true, documents: documents.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync failed";
    const safe = message.replaceAll(apiKey, "[redacted]").slice(0, 400);
    await admin.from("sumit_connections").update({ last_error: safe }).eq("company_id", companyId);
    throw new Error(safe);
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
    throw new Error(userMessage);
  }
  return record;
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
  const id = record.ID ?? record.FolderID ?? record.Id;
  if (label === name && typeof id === "number") return id;
  for (const value of Object.values(record)) {
    const found = findFolder(value, name);
    if (found != null) return found;
  }
  return null;
}

async function listDocuments(companyId: number, apiKey: string): Promise<SumitDoc[]> {
  const credentials = { CompanyID: companyId, APIKey: apiKey };
  const folders = await sumitCall(LIST_FOLDERS, credentials, {});
  const folderId = findFolder(folders, "מסמכים");
  if (folderId == null) throw new Error("SUMIT documents folder was not found");
  const docs: SumitDoc[] = [];
  let start = 0;
  for (let page = 0; page < 20; page += 1) {
    const payload = await sumitCall(LIST_ENTITIES, credentials, {
      Folder: folderId,
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
    }
    const hasNext = Boolean(
      data && typeof data === "object" && "HasNextPage" in data && (data as { HasNextPage?: boolean }).HasNextPage,
    );
    if (!hasNext || entities.length === 0) break;
    start += entities.length;
  }
  return docs;
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

async function writeLedger(
  admin: SupabaseClient,
  companyId: string,
  sumitCompanyId: number,
  docs: SumitDoc[],
): Promise<void> {
  const demo = sumitCompanyId === FLOW_TEST_SUMIT_COMPANY_ID;
  const byId = new Map(docs.map((doc) => [doc.sumit_id, doc]));
  const projectNames = new Map<number, string>();
  for (const doc of docs) {
    if (doc.bud != null && doc.bud_name) projectNames.set(doc.bud, doc.bud_name);
  }
  const projectIdBySection = new Map<number, string>();
  const projectIdByName = new Map<string, string>();
  for (const [section, name] of projectNames) {
    const saved = await admin
      .from("projects")
      .upsert(
        { company_id: companyId, name, sumit_budget_section_id: section, status: "active" },
        { onConflict: "company_id,name" },
      )
      .select("id")
      .single();
    if (saved.error || !saved.data) throw new Error("could not save a project");
    projectIdBySection.set(section, saved.data.id as string);
    projectIdByName.set(name, saved.data.id as string);
  }

  const categories = await admin.from("categories").select("id, name, kind").eq("company_id", companyId);
  if (categories.error) throw new Error("could not read categories");
  const categoryId = new Map<string, string>();
  for (const category of categories.data ?? []) {
    categoryId.set(`${category.kind}:${category.name}`, category.id as string);
  }

  const supplierId = new Map<number, string>();
  const customerId = new Map<number, string>();
  for (const doc of docs) {
    if (doc.cust == null || !doc.cust_name) continue;
    if (doc.kind === "exp") {
      if (supplierId.has(doc.cust)) continue;
      const exempt = demo && FLOW_TEST_EXEMPT_SUPPLIERS.includes(doc.cust_name);
      const saved = await admin
        .from("suppliers")
        .upsert(
          {
            company_id: companyId,
            name: doc.cust_name,
            vat_exempt: exempt,
            sumit_external_id: doc.cust,
          },
          { onConflict: "company_id,name" },
        )
        .select("id")
        .single();
      if (saved.error || !saved.data) throw new Error("could not save a supplier");
      supplierId.set(doc.cust, saved.data.id as string);
    } else if (!customerId.has(doc.cust)) {
      const saved = await admin
        .from("customers")
        .upsert(
          { company_id: companyId, name: doc.cust_name, sumit_external_id: doc.cust },
          { onConflict: "company_id,name" },
        )
        .select("id")
        .single();
      if (saved.error || !saved.data) throw new Error("could not save a customer");
      customerId.set(doc.cust, saved.data.id as string);
    }
  }

  const lines: LedgerLine[] = docs.map((doc) => {
    const projectKey = doc.bud == null ? null : String(doc.bud);
    const exempt = doc.cust_name != null && FLOW_TEST_EXEMPT_SUPPLIERS.includes(doc.cust_name);
    return deriveLine(doc, projectKey, exempt || false, 1800, byId);
  });

  const sharedIds: { id: string; month: string; net: bigint }[] = [];
  for (const line of lines) {
    const doc = byId.get(line.sumitId);
    const expense = line.kind === "exp";
    const categoryName =
      expense && doc?.cust_name ? (FLOW_TEST_SUPPLIER_CATEGORY[doc.cust_name] ?? null) : null;
    const category = categoryName
      ? (categoryId.get(`expense:${categoryName}`) ?? categoryId.get("expense:אחר") ?? null)
      : expense
        ? null
        : (categoryId.get("income:תקבול מלקוח") ?? null);
    const project =
      line.role === "project" && line.budgetSectionId != null
        ? (projectIdBySection.get(line.budgetSectionId) ?? null)
        : null;
    const saved = await admin
      .from("transactions")
      .upsert(
        {
          company_id: companyId,
          direction: expense ? "expense" : "income",
          doc_kind:
            line.kind === "inv"
              ? "invoice"
              : line.kind === "rec"
                ? "receipt"
                : line.kind === "invrec"
                  ? "invoice_receipt"
                  : line.kind === "cred"
                    ? "credit"
                    : "expense",
          pnl_role: line.role,
          amount_gross: Number(line.grossAgorot),
          amount_net: Number(line.netAgorot),
          vat_amount: Number(line.vatAgorot),
          vat_status: line.vatStatus,
          doc_date: line.date,
          cash_date: line.kind === "inv" || line.kind === "cred" ? null : line.date,
          source: "sumit",
          external_id: String(line.sumitId),
          idempotency_key: `sumit:${String(line.sumitId)}`,
          project_id: project,
          customer_id: !expense && doc?.cust != null ? (customerId.get(doc.cust) ?? null) : null,
          supplier_id: expense && doc?.cust != null ? (supplierId.get(doc.cust) ?? null) : null,
          category_id: category,
          description: line.description,
          linked_external_id: line.originalSumitId == null ? null : String(line.originalSumitId),
        },
        { onConflict: "company_id,idempotency_key" },
      )
      .select("id")
      .single();
    if (saved.error || !saved.data) throw new Error("could not save a document");
    const txnId = saved.data.id as string;
    if (line.role === "overhead") {
      await admin.from("overhead").upsert(
        { company_id: companyId, transaction_id: txnId },
        { onConflict: "transaction_id" },
      );
    }
    if (line.role === "project" && project) {
      await admin.from("allocations").upsert(
        {
          company_id: companyId,
          transaction_id: txnId,
          project_id: project,
          share_bp: 10000,
          amount_net: Number(line.netAgorot),
        },
        { onConflict: "transaction_id,project_id" },
      );
    }
    if (line.role === "shared") sharedIds.push({ id: txnId, month: line.month, net: line.netAgorot });
  }

  if (demo) {
    for (const shared of sharedIds) {
      const days = FLOW_TEST_WORKER_DAYS[shared.month];
      if (!days) continue;
      const names = Object.keys(days);
      const weights = names.map((name) => days[name] ?? 0);
      const shares = shareBp(weights);
      const amounts = allocateByWeights(shared.net, weights);
      const rows = names.flatMap((name, index) => {
        const project = projectIdByName.get(name);
        const share = shares[index];
        if (!project || share == null) return [];
        return [
          {
            company_id: companyId,
            transaction_id: shared.id,
            project_id: project,
            share_bp: share,
            amount_net: Number(amounts[index] ?? 0n),
          },
        ];
      });
      if (rows.length > 0) {
        await admin.from("allocations").upsert(rows, { onConflict: "transaction_id,project_id" });
      }
    }
    const workers = [...supplierId.entries()].find((entry) => {
      const name = docs.find((doc) => doc.cust === entry[0])?.cust_name;
      return name === 'כוח אדם מקצועי א.ר. בע"מ';
    });
    if (workers) {
      const rule = await admin
        .from("split_rules")
        .upsert(
          {
            company_id: companyId,
            supplier_id: workers[1],
            method: "worker_days",
            label: "עובדי שטח לפי ימי עבודה",
          },
          { onConflict: "company_id,label" },
        )
        .select("id")
        .single();
      if (rule.data) {
        for (const [month, days] of Object.entries(FLOW_TEST_WORKER_DAYS)) {
          const names = Object.keys(days);
          const shares = shareBp(names.map((name) => days[name] ?? 0));
          for (let index = 0; index < names.length; index += 1) {
            const name = names[index];
            const project = name ? projectIdByName.get(name) : undefined;
            const share = shares[index];
            if (!project || share == null) continue;
            await admin.from("split_rule_targets").upsert(
              {
                company_id: companyId,
                rule_id: rule.data.id,
                project_id: project,
                month: `${month}-01`,
                share_bp: share,
              },
              { onConflict: "rule_id,project_id,month" },
            );
          }
        }
      }
    }
  }
}
