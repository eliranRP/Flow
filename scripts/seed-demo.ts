/**
 * Load the Flow Test demo client for one owner.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SEED_OWNER_USER_ID=... pnpm seed:demo
 *
 * Idempotent on (company, source, external id). Does not print secrets.
 * Creates the company with is_demo = true, or updates one that is already demo.
 * Refuses to write into a real company. Does not call SUMIT.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  allocateByWeights,
  demoDataSchema,
  demoKindToDocKind,
  rateFractionToBp,
  shareBp,
  normalizeSumitDocument,
  type Database,
} from "@flow/shared";
import { loadLocalEnv } from "./env.ts";

loadLocalEnv();

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    console.error(
      "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SEED_OWNER_USER_ID. See .env.example.",
    );
    throw new Error(`missing ${name}`);
  }
  return value;
}

const url = requireEnv(
  "SUPABASE_URL",
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
);
const serviceKey = requireEnv(
  "SUPABASE_SERVICE_ROLE_KEY",
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const ownerId = requireEnv("SEED_OWNER_USER_ID", process.env.SEED_OWNER_USER_ID);

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "../packages/shared/fixtures/demo-data.json",
);
const demo = demoDataSchema.parse(JSON.parse(readFileSync(fixture, "utf8")));

const supabase = createClient<Database>(url, serviceKey, {
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

function num(value: bigint): number {
  return Number(value);
}

function specItem(spec: Record<string, unknown> | undefined): string {
  const item = spec?.item;
  return typeof item === "string" ? item : "";
}

async function main() {
  const { data: existing, error: existingError } = await supabase
    .from("companies")
    .select("id, is_demo")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing && !existing.is_demo) {
    throw new Error(
      "seed-demo will not write into a real company. The owner's company is not marked is_demo.",
    );
  }

  let companyId = existing?.id;
  if (!companyId) {
    const { data, error } = await supabase
      .from("companies")
      .insert({
        owner_id: ownerId,
        name: demo.company.name,
        tax_id: null,
        vat_rate_bp: rateFractionToBp(demo.company.vat_rate),
        is_demo: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    companyId = data.id;
  }

  const { data: categories, error: categoryError } = await supabase
    .from("categories")
    .select("id, name, kind")
    .eq("company_id", companyId);
  if (categoryError) throw categoryError;
  const categoryId = new Map<string, string>();
  for (const category of categories) {
    categoryId.set(`${category.kind}:${category.name}`, category.id);
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
    projectId.set(key, data.id);
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
    if (customer.sumit_id != null) customerId.set(customer.sumit_id, data.id);
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
          vat_exempt: !supplier.vat_able,
          sumit_external_id: supplier.sumit_id,
        },
        { onConflict: "company_id,name" },
      )
      .select("id")
      .single();
    if (error) throw error;
    supplierId.set(key, data.id);
  }

  let transactions = 0;
  const sharedTxns: { id: string; month: string; net: bigint }[] = [];

  for (const document of demo.documents) {
    const line = normalizeSumitDocument(document.sumit, demo);
    const expense = line.kind === "exp";
    const gross = line.grossAgorot;
    const net = line.netAgorot;
    const vat = gross - net;
    const item = specItem(document.spec);
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
          doc_kind: demoKindToDocKind[line.kind],
          pnl_role: line.role,
          amount_gross: num(gross),
          amount_net: num(net),
          vat_amount: num(vat),
          vat_status: line.vatStatus,
          doc_date: line.date,
          cash_date: line.kind === "inv" || line.kind === "cred" ? null : line.date,
          source: "sumit",
          external_id: String(line.sumitId),
          idempotency_key: `sumit:${String(line.sumitId)}`,
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
      sharedTxns.push({ id: data.id, month: line.month, net: line.netAgorot });
    }
  }

  for (const shared of sharedTxns) {
    const days = demo.shared_alloc_worker_days[shared.month];
    if (!days) continue;
    const keys = Object.keys(days);
    const weights = keys.map((key) => days[key] ?? 0);
    const shares = shareBp(weights);
    const amounts = allocateByWeights(shared.net, weights);
    const rows = keys.flatMap((key, index) => {
      const project = projectId.get(key);
      const share = shares[index];
      if (!project || share == null) return [];
      return [
        {
          company_id: companyId,
          transaction_id: shared.id,
          project_id: project,
          share_bp: share,
          amount_net: num(amounts[index] ?? 0n),
        },
      ];
    });
    if (rows.length === 0) continue;
    const { error } = await supabase.from("allocations").upsert(rows, {
      onConflict: "transaction_id,project_id",
    });
    if (error) throw error;
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
        const share = shares[index];
        if (!key || share == null) continue;
        const project = projectId.get(key);
        if (!project) continue;
        const { error } = await supabase.from("split_rule_targets").upsert(
          {
            company_id: companyId,
            rule_id: rule.id,
            project_id: project,
            month: `${month}-01`,
            share_bp: share,
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
