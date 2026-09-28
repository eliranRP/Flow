/**
 * Unit-test copy of the Flow Test derivation. The app entry does not import
 * this file. pnpm check:bundle fails if a production module reaches the JSON.
 */
import {
  allocateByWeights,
  dashboardSchema,
  shekelsToAgorot,
  type Basis,
  type CategoryRow,
  type Dashboard,
  type ReviewRow,
  type UnpaidRow,
} from "@flow/shared";
import { demoDataSchema, pnlFromDemo } from "@flow/shared/testing";
import raw from "../../../packages/shared/fixtures/demo-data.json";

const demo = demoDataSchema.parse(raw);
const full = pnlFromDemo(demo);

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

function inRange(date: string, from: string | null, to: string | null): boolean {
  if (!from || !to) return true;
  return date >= from && date <= to;
}

function num(value: bigint): number {
  return Number(value);
}

export function demoDashboard(from: string | null, to: string | null, basis: Basis): Dashboard {
  const projectKeys = Object.keys(demo.projects);
  const income = new Map<string, bigint>();
  const direct = new Map<string, bigint>();
  const sharedAlloc = new Map<string, bigint>();
  for (const key of projectKeys) {
    income.set(key, 0n);
    direct.set(key, 0n);
    sharedAlloc.set(key, 0n);
  }
  let shared = 0n;
  let overhead = 0n;
  const sharedByMonth = new Map<string, bigint>();

  for (const line of full.lines) {
    if (!inRange(line.date, from, to)) continue;
    if (line.kind === "exp") {
      if (line.role === "shared") {
        shared += line.netAgorot;
        sharedByMonth.set(line.month, (sharedByMonth.get(line.month) ?? 0n) + line.netAgorot);
      } else if (line.role === "overhead") {
        overhead += line.netAgorot;
      } else if (line.projectKey) {
        direct.set(line.projectKey, (direct.get(line.projectKey) ?? 0n) + line.netAgorot);
      }
      continue;
    }
    if (!line.projectKey) continue;
    const counts =
      basis === "cash"
        ? line.kind === "rec" || line.kind === "invrec"
        : line.kind === "inv" || line.kind === "cred" || line.kind === "invrec";
    if (!counts) continue;
    income.set(line.projectKey, (income.get(line.projectKey) ?? 0n) + line.netAgorot);
  }

  for (const [month, days] of Object.entries(demo.shared_alloc_worker_days)) {
    const pool = sharedByMonth.get(month);
    if (pool == null) continue;
    const keys = Object.keys(days);
    const parts = allocateByWeights(pool, keys.map((key) => days[key] ?? 0));
    keys.forEach((key, index) => {
      sharedAlloc.set(key, (sharedAlloc.get(key) ?? 0n) + (parts[index] ?? 0n));
    });
  }

  const projects = projectKeys.map((key) => {
    const project = demo.projects[key];
    const inv = income.get(key) ?? 0n;
    const dir = -(direct.get(key) ?? 0n);
    const alloc = -(sharedAlloc.get(key) ?? 0n);
    const finished = project?.state?.includes("הסתיים") === true;
    return {
      id: key,
      name: project?.name ?? key,
      status: finished ? ("finished" as const) : ("active" as const),
      state_label: project?.state ?? null,
      budget_agorot: null,
      sumit_budget_section_id: project?.budget_section_id ?? null,
      income_agorot: num(inv),
      direct_agorot: num(dir),
      shared_agorot: num(alloc),
      profit_before_shared_agorot: num(inv - dir),
      profit_agorot: num(inv - dir - alloc),
    };
  });

  const incomeTotal = [...income.values()].reduce((sum, value) => sum + value, 0n);
  const directTotal = -([...direct.values()].reduce((sum, value) => sum + value, 0n));
  const sharedTotal = -shared;
  const overheadTotal = -overhead;
  const expense = directTotal + sharedTotal + overheadTotal;

  return dashboardSchema.parse({
    company_id: "demo",
    name: demo.company.name,
    vat_registered: true,
    basis,
    from,
    to,
    income_agorot: num(incomeTotal),
    direct_agorot: num(directTotal),
    shared_agorot: num(sharedTotal),
    overhead_agorot: num(overheadTotal),
    expense_agorot: num(expense),
    net_profit_agorot: num(incomeTotal - expense),
    prev_income_agorot: null,
    prev_expense_agorot: null,
    prev_net_agorot: null,
    active_projects: projects.filter((project) => project.status === "active").length,
    review_count: 0,
    projects,
  });
}

export function demoUnpaid(): UnpaidRow[] {
  const byOriginal = new Map<number, typeof demo.documents>();
  for (const document of demo.documents) {
    const original = document.sumit.orig;
    if (original == null) continue;
    const list = byOriginal.get(original) ?? [];
    list.push(document);
    byOriginal.set(original, list);
  }
  const rows: UnpaidRow[] = [];
  for (const document of demo.documents) {
    const doc = document.sumit;
    if (doc.kind !== "inv") continue;
    let remaining = shekelsToAgorot(doc.gross);
    for (const other of byOriginal.get(doc.sumit_id) ?? []) {
      if (other.sumit.kind === "cred") remaining += shekelsToAgorot(other.sumit.gross);
      else if (other.sumit.kind === "rec") remaining -= shekelsToAgorot(other.sumit.gross);
    }
    if (remaining === 0n) continue;
    const project = doc.bud == null
      ? null
      : Object.values(demo.projects).find((item) => item.budget_section_id === doc.bud);
    const net = doc.gross === 0 ? 0n : (remaining * shekelsToAgorot(doc.wo)) / shekelsToAgorot(doc.gross);
    rows.push({
      id: doc.key,
      description: doc.desc,
      doc_date: doc.date,
      project_name: project?.name ?? null,
      customer_name: doc.cust_name,
      open_gross_agorot: remaining,
      open_net_agorot: net,
    });
  }
  return rows;
}

export function demoCategories(): CategoryRow[] {
  const names: [string, "expense" | "income"][] = [
    ["חומרים", "expense"],
    ["קבלני משנה", "expense"],
    ["עבודה", "expense"],
    ["ציוד והשכרה", "expense"],
    ["הובלה", "expense"],
    ["ביטוח", "expense"],
    ["אחר", "expense"],
    ["תקבול מלקוח", "income"],
    ["הכנסה אחרת", "income"],
  ];
  return names.map(([name, kind], index) => ({
    id: `cat-${String(index)}`,
    name,
    kind,
    hidden: false,
    is_default: true,
  }));
}

export function demoReview(): ReviewRow[] {
  return [];
}

export function demoProject(id: string) {
  const dash = demoDashboard(null, null, "invoiced");
  const row = dash.projects.find((project) => project.id === id);
  if (!row) return null;
  const categories = new Map<string, bigint>();
  const transactions: {
    id: string;
    description: string;
    doc_date: string;
    amount_net: number;
    direction: "income" | "expense";
    source: string;
    category: string | null;
  }[] = [];
  for (const document of demo.documents) {
    const line = full.lines.find((item) => item.key === document.sumit.key);
    if (!line || line.projectKey !== id) continue;
    const item = typeof document.spec?.item === "string" ? document.spec.item : "";
    const category = categoryByItem[item] ?? null;
    if (line.kind === "exp" && line.role === "project" && category) {
      categories.set(category, (categories.get(category) ?? 0n) - line.netAgorot);
    }
    transactions.push({
      id: line.key,
      description: line.description,
      doc_date: line.date,
      amount_net: num(line.netAgorot),
      direction: line.kind === "exp" ? "expense" : "income",
      source: "sumit",
      category,
    });
  }
  return {
    ...row,
    profit_agorot: row.profit_agorot,
    categories: [...categories.entries()].map(([name, amount]) => ({
      id: name,
      name,
      amount_agorot: num(amount),
    })),
    transactions,
  };
}

export function demoTransaction(id: string) {
  const document = demo.documents.find((item) => item.sumit.key === id);
  if (!document) return null;
  const line = full.lines.find((item) => item.key === id);
  if (!line) return null;
  const project = line.projectKey ? demo.projects[line.projectKey] : undefined;
  const item = typeof document.spec?.item === "string" ? document.spec.item : "";
  return {
    id,
    description: line.description,
    direction: line.kind === "exp" ? "expense" : "income",
    doc_kind: line.kind,
    doc_date: line.date,
    amount_gross: num(line.grossAgorot),
    amount_net: num(line.netAgorot),
    vat_amount: num(line.vatAgorot),
    vat_status: line.vatStatus,
    source: "sumit",
    project_id: line.projectKey,
    project_name: project?.name ?? null,
    category_id: categoryByItem[item] ?? null,
    category_name: categoryByItem[item] ?? null,
    supplier_name: line.supplierKey ? (demo.suppliers[line.supplierKey]?.name ?? null) : null,
    customer_name: document.sumit.cust_name,
    allocations: line.projectKey
      ? [{ project_id: line.projectKey, project_name: project?.name ?? line.projectKey, share_bp: 10000, amount_net: num(line.netAgorot) }]
      : [],
  };
}
