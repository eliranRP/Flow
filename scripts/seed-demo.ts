/**
 * Load the Flow Test demo client for one owner.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SEED_OWNER_USER_ID=... pnpm seed:demo
 *
 * Idempotent on (company, source, external id). Does not print secrets.
 * Does not call SUMIT. The documents are the committed fixture.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  allocateByWeights,
  normalizeSumitDocument,
  shareBp,
  type DemoData,
} from "@flow/shared";
import { loadLocalEnv } from "./env.ts";

loadLocalEnv();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ownerId = process.env.SEED_OWNER_USER_ID;

if (!url || !serviceKey || !ownerId) {
  console.error(
    "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SEED_OWNER_USER_ID. See .env.example.",
  );
  process.exit(1);
}

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "../packages/shared/fixtures/demo-data.json",
);
const demo = JSON.parse(readFileSync(fixture, "utf8")) as DemoData;

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const categoryByItem: Record<string, string> = {
  "חומרי בניין": "חומרים",
  אינסטלציה: "קבלני משנה",
  חשמל: "קבלני משנה",
  "קבלני משנה": "קבלני משנה",
  אלומיניום: "חומרים",
  "השכרת ציוד ומנופים": "ציוד והשכרה",
  "עץ ופרגולות": "חומרים",
  "כוח אדם - עובדי שטח": "עבודה",
  "הנהלת חשבונות": "אחר",
  ביטוח: "ביטוח",
  "רכב - ליסינג": "אחר",
  דלק: "הובלה",
  "טלפון ותקשורת": "אחר",
};

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function num(value: bigint): number {
  return Number(value);
}

const docKind = {
  inv: "invoice",
  rec: "receipt",
  invrec: "invoice_receipt",
  cred: "credit",
  exp: "expense",
} as const;

async function main() {
  const { data: existing, error: existingError } = await supabase
    .from("companies")
    .select("id")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (existingError) throw existingError;

  let companyId = existing?.id as string | undefined;
  if (!companyId) {
    const { data, error } = await supabase
      .from("companies")
      .insert({
        owner_id: ownerId,
        name: demo.company.name,
        tax_id: null,
        vat_rate_bp: 1800,
      })
      .select("id")
      .single();
    if (error) throw error;
    companyId = data.id as string;
  }

  const { data: categories, error: categoryError } = await supabase
    .from("categories")
    .select("id, name, kind")
    .eq("company_id", companyId);
  if (categoryError) throw categoryError;
  const categoryId = new Map<string, string>();
  for (const category of categories ?? []) {
    categoryId.set(`${category.kind}:${category.name}`, category.id as string);
  }

  const projectId = new Map<string, string>();
  for (const [key, project] of Object.entries(demo.projects)) {
    const status = project.state?.includes("הסתיים") ? "finished" : "active";
    const { data, error } = await supabase
      .from("projects")
      .upsert(
        {
          company_id: companyId,
          name: project.name,
          status,
          state_label: project.state ?? null,
          sumit_budget_section_id: project.budget_section_id,
        },
        { onConflict: "company_id,name" },
      )
      .select("id")
      .single();
    if (error) throw error;
    projectId.set(key, data.id as string);
  }

  const customerId = new Map<number, string>();
  for (const customer of Object.values(demo.customers)) {
    const { data, error } = await supabase
      .from("customers")
      .upsert(
        {
          company_id: companyId,
          name: customer.name,
          company_number: customer.company_number,
          sumit_external_id: customer.sumit_id,
        },
        { onConflict: "company_id,name" },
      )
      .select("id")
      .single();
    if (error) throw error;
    if (customer.sumit_id != null) customerId.set(customer.sumit_id, data.id as string);
  }

  const supplierId = new Map<string, string>();
  for (const [key, supplier] of Object.entries(demo.suppliers)) {
    const { data, error } = await supabase
      .from("suppliers")
      .upsert(
        {
          company_id: companyId,
          name: supplier.name,
          company_number: supplier.company_number,
          vat_exempt: supplier.vat_able === false,
          sumit_external_id: supplier.sumit_id,
        },
        { onConflict: "company_id,name" },
      )
      .select("id")
      .single();
    if (error) throw error;
    supplierId.set(key, data.id as string);
  }

  let transactions = 0;
  const sharedTxnByMonth = new Map<string, { id: string; net: bigint }>();

  for (const document of demo.documents) {
    const line = normalizeSumitDocument(document.sumit, demo);
    const expense = line.kind === "exp";
    const gross = expense ? abs(line.grossAgorot) : line.grossAgorot;
    const net = expense ? abs(line.netAgorot) : line.netAgorot;
    const vat = gross - net;
    const item = document.spec && "item" in document.spec ? String(document.spec.item ?? "") : "";
    const categoryName = categoryByItem[item];
    const category =
      categoryName == null
        ? null
        : (categoryId.get(`${expense ? "expense" : "income"}:${categoryName}`) ?? null);
    const project = line.projectKey ? (projectId.get(line.projectKey) ?? null) : null;
    const supplier = line.supplierKey != null ? (supplierId.get(line.supplierKey) ?? null) : null;
    const customer =
      !expense && document.sumit.cust != null
        ? (customerId.get(document.sumit.cust) ?? null)
        : null;

    const { data, error } = await supabase
      .from("transactions")
      .upsert(
        {
          company_id: companyId,
          direction: expense ? "expense" : "income",
          doc_kind: docKind[line.kind],
          pnl_role: line.role,
          amount_gross: num(gross),
          amount_net: num(net),
          vat_amount: num(vat),
          vat_status: line.vatStatus,
          doc_date: line.date,
          cash_date: line.kind === "inv" || line.kind === "cred" ? null : line.date,
          source: "sumit",
          external_id: String(line.sumitId),
          idempotency_key: `sumit:${line.sumitId}`,
          project_id: project,
          customer_id: customer,
          supplier_id: supplier,
          category_id: category,
          description: line.description,
          linked_external_id: line.originalSumitId == null ? null : String(line.originalSumitId),
        },
        { onConflict: "company_id,idempotency_key" },
      )
      .select("id")
      .single();
    if (error) throw error;
    transactions += 1;

    if (line.role === "overhead") {
      const { error: overheadError } = await supabase.from("overhead").upsert(
        { company_id: companyId, transaction_id: data.id },
        { onConflict: "transaction_id" },
      );
      if (overheadError) throw overheadError;
    }

    if (line.role === "project" && project) {
      const { error: allocationError } = await supabase.from("allocations").upsert(
        {
          company_id: companyId,
          transaction_id: data.id,
          project_id: project,
          share_bp: 10000,
          amount_net: num(net),
        },
        { onConflict: "transaction_id,project_id" },
      );
      if (allocationError) throw allocationError;
    }

    if (line.role === "shared") {
      sharedTxnByMonth.set(line.month, { id: data.id as string, net: abs(line.netAgorot) });
    }
  }

  for (const [month, days] of Object.entries(demo.shared_alloc_worker_days)) {
    const shared = sharedTxnByMonth.get(month);
    if (!shared) continue;
    const keys = Object.keys(days);
    const weights = keys.map((key) => days[key] ?? 0);
    const shares = shareBp(weights);
    const amounts = allocateByWeights(shared.net, weights);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (!key) continue;
      const project = projectId.get(key);
      if (!project) continue;
      const { error } = await supabase.from("allocations").upsert(
        {
          company_id: companyId,
          transaction_id: shared.id,
          project_id: project,
          share_bp: shares[index],
          amount_net: num(amounts[index] ?? 0n),
        },
        { onConflict: "transaction_id,project_id" },
      );
      if (error) throw error;
    }
  }

  const workers = supplierId.get("workers");
  if (workers) {
    const label = "עובדי שטח לפי ימי עבודה";
    const { data: rule, error: ruleError } = await supabase
      .from("split_rules")
      .upsert(
        {
          company_id: companyId,
          supplier_id: workers,
          method: "worker_days",
          label,
        },
        { onConflict: "company_id,label" },
      )
      .select("id")
      .single();
    if (ruleError) throw ruleError;
    for (const [month, days] of Object.entries(demo.shared_alloc_worker_days)) {
      const keys = Object.keys(days);
      const shares = shareBp(keys.map((key) => days[key] ?? 0));
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (!key) continue;
        const project = projectId.get(key);
        if (!project) continue;
        const { error } = await supabase.from("split_rule_targets").upsert(
          {
            company_id: companyId,
            rule_id: rule.id,
            project_id: project,
            month: `${month}-01`,
            share_bp: shares[index],
          },
          { onConflict: "rule_id,project_id,month" },
        );
        if (error) throw error;
      }
    }
  }

  console.log(
    JSON.stringify({
      companyId,
      projects: projectId.size,
      transactions,
      documents: demo.documents.length,
    }),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "seed failed";
  console.error(message);
  process.exit(1);
});
