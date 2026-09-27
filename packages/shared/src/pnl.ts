import {
  agorotToShekels,
  allocateByWeights,
  netFromGrossAgorot,
  shekelsToAgorot,
  vatFromGrossAndNet,
} from "./money.ts";
import type { VatStatus } from "./schemas.ts";

export type DemoDocKind = "inv" | "rec" | "invrec" | "cred" | "exp";
export type PnlRole = "project" | "shared" | "overhead";

export interface DemoSumitDoc {
  key: string;
  sumit_id: number;
  kind: DemoDocKind;
  date: string;
  gross: number;
  wo: number;
  vat: number | null;
  bud: number | null;
  orig: number | null;
  cust: number | null;
  cust_name: string | null;
  number: number | null;
  desc: string;
}

export interface DemoData {
  company: { name: string; company_id: number; vat_rate: number };
  projects: Record<
    string,
    { name: string; state?: string; budget_section_id: number; customers?: string[] }
  >;
  customers: Record<string, { name: string; company_number: string | null; sumit_id: number | null }>;
  suppliers: Record<
    string,
    { name: string; company_number: string | null; vat_able: boolean; sumit_id: number | null }
  >;
  shared_alloc_worker_days: Record<string, Record<string, number>>;
  documents: Array<{ spec?: { key?: string; sup?: string; item?: string }; sumit: DemoSumitDoc }>;
}

export interface NormalizedLine {
  key: string;
  sumitId: number;
  kind: DemoDocKind;
  projectKey: string | null;
  role: PnlRole | null;
  date: string;
  month: string;
  grossAgorot: bigint;
  netAgorot: bigint;
  vatAgorot: bigint;
  vatStatus: VatStatus;
  supplierKey: string | null;
  description: string;
  originalSumitId: number | null;
}

export interface ProjectPnl {
  key: string;
  name: string;
  invoicedIncome: number;
  cashIncome: number;
  directCosts: number;
  sharedAlloc: number;
  grossProfitInvoiced: number;
  grossProfitCash: number;
  profitAfterAllocInvoiced: number;
  profitAfterAllocCash: number;
  openReceivableGross: number;
}

export interface CompanyPnl {
  invoicedIncome: number;
  cashIncome: number;
  direct: number;
  shared: number;
  overhead: number;
  netProfitInvoiced: number;
  netProfitCash: number;
  openReceivablesGross: number;
}

export interface DemoPnl {
  projects: Record<string, ProjectPnl>;
  company: CompanyPnl;
  monthlyExpensesNet: Record<string, number>;
  lines: NormalizedLine[];
}

export function expenseRole(description: string): PnlRole {
  if (description.startsWith("עלות משותפת")) return "shared";
  if (description.startsWith("תקורה")) return "overhead";
  return "project";
}

function supplierBySumitId(demo: DemoData): Map<number, { key: string; vatExempt: boolean }> {
  const map = new Map<number, { key: string; vatExempt: boolean }>();
  for (const [key, supplier] of Object.entries(demo.suppliers)) {
    if (supplier.sumit_id != null) {
      map.set(supplier.sumit_id, { key, vatExempt: supplier.vat_able === false });
    }
  }
  return map;
}

function projectKeyByBudget(demo: DemoData): Map<number, string> {
  const map = new Map<number, string>();
  for (const [key, project] of Object.entries(demo.projects)) {
    map.set(project.budget_section_id, key);
  }
  return map;
}

/**
 * Turn one SUMIT document into the ledger line Flow stores.
 * Income documents that carry WithoutVAT keep it (`source`).
 * A receipt has no VAT of its own; its cash net is gross / 1.18 (`derived`).
 * An expense with no VAT split assumes 18% (`assumed`), unless the supplier
 * is VAT-exempt, in which case net = gross (`derived`). Decision 0043.
 */
export function normalizeSumitDocument(
  doc: DemoSumitDoc,
  demo: DemoData,
): NormalizedLine {
  const projects = projectKeyByBudget(demo);
  const suppliers = supplierBySumitId(demo);
  const grossAgorot = shekelsToAgorot(doc.gross);
  const sourceNetAgorot = shekelsToAgorot(doc.wo);
  const month = doc.date.slice(0, 7);
  const projectKey = doc.bud == null ? null : (projects.get(doc.bud) ?? null);

  if (doc.kind === "exp") {
    const supplier = doc.cust == null ? undefined : suppliers.get(doc.cust);
    const vatExempt = supplier?.vatExempt === true;
    const hasSourceSplit = doc.vat != null && sourceNetAgorot !== grossAgorot;
    const netAgorot = hasSourceSplit
      ? sourceNetAgorot
      : netFromGrossAgorot(grossAgorot, vatExempt);
    const vatStatus: VatStatus = hasSourceSplit ? "source" : vatExempt ? "derived" : "assumed";
    const role = expenseRole(doc.desc);
    if (role === "project" && projectKey == null) {
      throw new Error(`Project expense ${doc.key} has no budget section`);
    }
    return {
      key: doc.key,
      sumitId: doc.sumit_id,
      kind: doc.kind,
      projectKey: role === "project" ? projectKey : null,
      role,
      date: doc.date,
      month,
      grossAgorot,
      netAgorot,
      vatAgorot: vatFromGrossAndNet(grossAgorot, netAgorot),
      vatStatus,
      supplierKey: supplier?.key ?? null,
      description: doc.desc,
      originalSumitId: doc.orig,
    };
  }

  if (projectKey == null) {
    throw new Error(`Income document ${doc.key} has no project`);
  }

  if (doc.kind === "rec") {
    const netAgorot = netFromGrossAgorot(grossAgorot, false);
    return {
      key: doc.key,
      sumitId: doc.sumit_id,
      kind: doc.kind,
      projectKey,
      role: null,
      date: doc.date,
      month,
      grossAgorot,
      netAgorot,
      vatAgorot: vatFromGrossAndNet(grossAgorot, netAgorot),
      vatStatus: "derived",
      supplierKey: null,
      description: doc.desc,
      originalSumitId: doc.orig,
    };
  }

  return {
    key: doc.key,
    sumitId: doc.sumit_id,
    kind: doc.kind,
    projectKey,
    role: null,
    date: doc.date,
    month,
    grossAgorot,
    netAgorot: sourceNetAgorot,
    vatAgorot: vatFromGrossAndNet(grossAgorot, sourceNetAgorot),
    vatStatus: "source",
    supplierKey: null,
    description: doc.desc,
    originalSumitId: doc.orig,
  };
}

function shekel(agorot: bigint): number {
  const shekels = agorotToShekels(agorot);
  if (!Number.isInteger(shekels)) {
    throw new Error(`Expected whole shekels, got ${shekels} from ${agorot} agorot`);
  }
  return shekels;
}

/** Rule A P&L for the demo client, in whole shekels. */
export function pnlFromDemo(demo: DemoData): DemoPnl {
  const lines = demo.documents.map((document) => normalizeSumitDocument(document.sumit, demo));
  const projectKeys = Object.keys(demo.projects);

  const invoiced = new Map<string, bigint>();
  const cash = new Map<string, bigint>();
  const direct = new Map<string, bigint>();
  const sharedByMonth = new Map<string, bigint>();
  let shared = 0n;
  let overhead = 0n;
  const monthly = new Map<string, bigint>();

  for (const key of projectKeys) {
    invoiced.set(key, 0n);
    cash.set(key, 0n);
    direct.set(key, 0n);
  }

  for (const line of lines) {
    if (line.kind === "inv" || line.kind === "cred" || line.kind === "invrec") {
      const key = line.projectKey;
      if (key == null) continue;
      invoiced.set(key, (invoiced.get(key) ?? 0n) + line.netAgorot);
    }
    if (line.kind === "rec" || line.kind === "invrec") {
      const key = line.projectKey;
      if (key == null) continue;
      const amount = line.netAgorot < 0n ? -line.netAgorot : line.netAgorot;
      cash.set(key, (cash.get(key) ?? 0n) + amount);
    }
    if (line.kind === "exp") {
      const magnitude = line.netAgorot < 0n ? -line.netAgorot : line.netAgorot;
      monthly.set(line.month, (monthly.get(line.month) ?? 0n) + magnitude);
      if (line.role === "shared") {
        shared += magnitude;
        sharedByMonth.set(line.month, (sharedByMonth.get(line.month) ?? 0n) + magnitude);
      } else if (line.role === "overhead") {
        overhead += magnitude;
      } else if (line.projectKey != null) {
        direct.set(line.projectKey, (direct.get(line.projectKey) ?? 0n) + magnitude);
      }
    }
  }

  const sharedAlloc = new Map<string, bigint>();
  for (const key of projectKeys) sharedAlloc.set(key, 0n);

  for (const [month, daysByProject] of Object.entries(demo.shared_alloc_worker_days)) {
    const pool = sharedByMonth.get(month) ?? 0n;
    const keys = Object.keys(daysByProject);
    const weights = keys.map((key) => daysByProject[key] ?? 0);
    const parts = allocateByWeights(pool, weights);
    keys.forEach((key, index) => {
      sharedAlloc.set(key, (sharedAlloc.get(key) ?? 0n) + (parts[index] ?? 0n));
    });
  }

  const openByProject = openReceivables(lines);

  const projects: Record<string, ProjectPnl> = {};
  let invoicedIncome = 0n;
  let cashIncome = 0n;
  let directCosts = 0n;
  let openReceivablesGross = 0n;

  for (const key of projectKeys) {
    const inv = invoiced.get(key) ?? 0n;
    const cashAmt = cash.get(key) ?? 0n;
    const dir = direct.get(key) ?? 0n;
    const alloc = sharedAlloc.get(key) ?? 0n;
    const open = openByProject.get(key) ?? 0n;
    invoicedIncome += inv;
    cashIncome += cashAmt;
    directCosts += dir;
    openReceivablesGross += open;
    const invoicedShekel = shekel(inv);
    const cashShekel = shekel(cashAmt);
    const directShekel = shekel(dir);
    const allocShekel = shekel(alloc);
    projects[key] = {
      key,
      name: demo.projects[key]?.name ?? key,
      invoicedIncome: invoicedShekel,
      cashIncome: cashShekel,
      directCosts: directShekel,
      sharedAlloc: allocShekel,
      grossProfitInvoiced: invoicedShekel - directShekel,
      grossProfitCash: cashShekel - directShekel,
      profitAfterAllocInvoiced: invoicedShekel - directShekel - allocShekel,
      profitAfterAllocCash: cashShekel - directShekel - allocShekel,
      openReceivableGross: shekel(open),
    };
  }

  const monthlyExpensesNet: Record<string, number> = {};
  for (const [month, amount] of [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    monthlyExpensesNet[month] = shekel(amount);
  }

  const invoicedShekel = shekel(invoicedIncome);
  const cashShekel = shekel(cashIncome);
  const directShekel = shekel(directCosts);
  const sharedShekel = shekel(shared);
  const overheadShekel = shekel(overhead);

  return {
    projects,
    company: {
      invoicedIncome: invoicedShekel,
      cashIncome: cashShekel,
      direct: directShekel,
      shared: sharedShekel,
      overhead: overheadShekel,
      netProfitInvoiced: invoicedShekel - directShekel - sharedShekel - overheadShekel,
      netProfitCash: cashShekel - directShekel - sharedShekel - overheadShekel,
      openReceivablesGross: shekel(openReceivablesGross),
    },
    monthlyExpensesNet,
    lines,
  };
}

function openReceivables(lines: NormalizedLine[]): Map<string, bigint> {
  const open = new Map<string, bigint>();
  for (const line of lines) {
    if (line.kind !== "inv" || line.projectKey == null) continue;
    let remaining = line.grossAgorot < 0n ? -line.grossAgorot : line.grossAgorot;
    for (const other of lines) {
      if (other.originalSumitId !== line.sumitId) continue;
      if (other.kind !== "cred" && other.kind !== "rec") continue;
      const paid = other.grossAgorot < 0n ? -other.grossAgorot : other.grossAgorot;
      remaining -= paid;
    }
    if (remaining !== 0n) {
      open.set(line.projectKey, (open.get(line.projectKey) ?? 0n) + remaining);
    }
  }
  return open;
}
