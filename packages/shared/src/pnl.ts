import { z } from "zod";
import {
  allocateByWeights,
  divHalfEven,
  netFromGrossAgorot,
  rateFractionToBp,
  shekelsToAgorot,
  vatFromGrossAndNet,
} from "./money.ts";
import {
  demoDocKindSchema,
  type DemoDocKind,
  type PnlRole,
  type VatStatus,
} from "./schemas.ts";

export const demoSumitDocSchema = z.object({
  key: z.string(),
  sumit_id: z.number(),
  kind: demoDocKindSchema,
  date: z.string(),
  gross: z.number(),
  wo: z.number(),
  vat: z.number().nullable(),
  bud: z.number().nullable(),
  orig: z.number().nullable(),
  cust: z.number().nullable(),
  cust_name: z.string().nullable(),
  number: z.number().nullable(),
  desc: z.string(),
});

export const demoDataSchema = z.object({
  company: z
    .object({
      name: z.string(),
      company_id: z.number(),
      vat_rate: z.number(),
    })
    .loose(),
  projects: z.record(
    z.string(),
    z
      .object({
        name: z.string(),
        state: z.string().optional(),
        budget_section_id: z.number(),
        customers: z.array(z.string()).optional(),
      })
      .loose(),
  ),
  customers: z.record(
    z.string(),
    z
      .object({
        name: z.string(),
        company_number: z.string().nullable(),
        sumit_id: z.number().nullable(),
      })
      .loose(),
  ),
  suppliers: z.record(
    z.string(),
    z
      .object({
        name: z.string(),
        company_number: z.string().nullable(),
        vat_able: z.boolean(),
        sumit_id: z.number().nullable(),
      })
      .loose(),
  ),
  shared_alloc_worker_days: z.record(z.string(), z.record(z.string(), z.number())),
  documents: z.array(
    z
      .object({
        spec: z.record(z.string(), z.unknown()).optional(),
        sumit: demoSumitDocSchema,
      })
      .loose(),
  ),
});

export type DemoSumitDoc = z.infer<typeof demoSumitDocSchema>;
export type DemoData = z.infer<typeof demoDataSchema>;

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

/** Rule A totals in agorot. Round with wholeShekels / formatIls for display. */
export interface ProjectPnl {
  key: string;
  name: string;
  invoicedIncome: bigint;
  cashIncome: bigint;
  directCosts: bigint;
  sharedAlloc: bigint;
  grossProfitInvoiced: bigint;
  grossProfitCash: bigint;
  profitAfterAllocInvoiced: bigint;
  profitAfterAllocCash: bigint;
  openReceivableGross: bigint;
}

export interface CompanyPnl {
  invoicedIncome: bigint;
  cashIncome: bigint;
  direct: bigint;
  shared: bigint;
  overhead: bigint;
  netProfitInvoiced: bigint;
  netProfitCash: bigint;
  openReceivablesGross: bigint;
}

export interface DemoPnl {
  projects: Record<string, ProjectPnl>;
  company: CompanyPnl;
  monthlyExpensesNet: Record<string, bigint>;
  lines: NormalizedLine[];
}

interface DemoIndex {
  projects: Map<number, string>;
  suppliers: Map<number, { key: string; vatExempt: boolean }>;
  bySumitId: Map<number, DemoSumitDoc>;
  companyRateBp: number;
}

export function expenseRole(description: string): PnlRole {
  if (description.startsWith("עלות משותפת")) return "shared";
  if (description.startsWith("תקורה")) return "overhead";
  return "project";
}

function buildIndex(demo: DemoData): DemoIndex {
  const projects = new Map<number, string>();
  for (const [key, project] of Object.entries(demo.projects)) {
    projects.set(project.budget_section_id, key);
  }
  const suppliers = new Map<number, { key: string; vatExempt: boolean }>();
  for (const [key, supplier] of Object.entries(demo.suppliers)) {
    if (supplier.sumit_id != null) {
      suppliers.set(supplier.sumit_id, { key, vatExempt: !supplier.vat_able });
    }
  }
  const bySumitId = new Map<number, DemoSumitDoc>();
  for (const document of demo.documents) {
    bySumitId.set(document.sumit.sumit_id, document.sumit);
  }
  return {
    projects,
    suppliers,
    bySumitId,
    companyRateBp: rateFractionToBp(demo.company.vat_rate),
  };
}

function linkedRateBp(invoice: DemoSumitDoc | undefined, companyRateBp: number): number {
  if (!invoice || invoice.gross === 0) return companyRateBp;
  const gross = shekelsToAgorot(invoice.gross);
  const net = shekelsToAgorot(invoice.wo);
  const absGross = gross < 0n ? -gross : gross;
  const absNet = net < 0n ? -net : net;
  if (absNet === 0n || absGross === absNet) return companyRateBp;
  const bp = Number(divHalfEven((absGross - absNet) * 10000n, absNet));
  if (bp < 0 || bp > 10000) return companyRateBp;
  return bp;
}

/**
 * Turn one SUMIT document into the ledger line Flow stores.
 * Signs from the source are kept: a cost or a credit stays negative.
 * Income documents that carry WithoutVAT keep it (`source`).
 * A receipt has no VAT of its own. Its cash net uses the linked invoice's
 * VAT rate (`doc.orig`), or the company rate when there is no split.
 * An expense with no VAT split assumes the company rate (`assumed`), unless
 * the supplier is VAT-exempt (`derived`, net = gross). Decision 0043.
 */
export function normalizeSumitDocument(
  doc: DemoSumitDoc,
  demo: DemoData,
  index: DemoIndex = buildIndex(demo),
): NormalizedLine {
  const grossAgorot = shekelsToAgorot(doc.gross);
  const sourceNetAgorot = shekelsToAgorot(doc.wo);
  const month = doc.date.slice(0, 7);
  const projectKey = doc.bud == null ? null : (index.projects.get(doc.bud) ?? null);

  if (doc.kind === "exp") {
    const supplier = doc.cust == null ? undefined : index.suppliers.get(doc.cust);
    const vatExempt = supplier?.vatExempt === true;
    const hasSourceSplit = doc.vat != null && sourceNetAgorot !== grossAgorot;
    const rateBp = vatExempt ? 0 : index.companyRateBp;
    const netAgorot = hasSourceSplit ? sourceNetAgorot : netFromGrossAgorot(grossAgorot, rateBp);
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
    const invoice = doc.orig == null ? undefined : index.bySumitId.get(doc.orig);
    const rateBp = linkedRateBp(invoice, index.companyRateBp);
    const netAgorot = netFromGrossAgorot(grossAgorot, rateBp);
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

function add(map: Map<string, bigint>, key: string, amount: bigint) {
  map.set(key, (map.get(key) ?? 0n) + amount);
}

/** Rule A P&L for the demo client. Totals are agorot, signs kept from the source. */
export function pnlFromDemo(demo: DemoData): DemoPnl {
  const index = buildIndex(demo);
  const lines = demo.documents.map((document) =>
    normalizeSumitDocument(document.sumit, demo, index),
  );
  const projectKeys = Object.keys(demo.projects);
  const projectKeySet = new Set(projectKeys);

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
    if (line.kind === "exp") {
      add(monthly, line.month, line.netAgorot);
      if (line.role === "shared") {
        shared += line.netAgorot;
        add(sharedByMonth, line.month, line.netAgorot);
      } else if (line.role === "overhead") {
        overhead += line.netAgorot;
      } else if (line.projectKey != null) {
        add(direct, line.projectKey, line.netAgorot);
      }
      continue;
    }

    if (line.projectKey == null) continue;
    if (line.kind === "inv" || line.kind === "cred" || line.kind === "invrec") {
      add(invoiced, line.projectKey, line.netAgorot);
    }
    if (line.kind === "rec" || line.kind === "invrec") {
      add(cash, line.projectKey, line.netAgorot);
    }
  }

  const sharedAlloc = new Map<string, bigint>();
  for (const key of projectKeys) sharedAlloc.set(key, 0n);
  let allocated = 0n;

  for (const [month, daysByProject] of Object.entries(demo.shared_alloc_worker_days)) {
    for (const key of Object.keys(daysByProject)) {
      if (!projectKeySet.has(key)) {
        throw new Error(`worker-day key ${key} is not a project`);
      }
    }
    const pool = sharedByMonth.get(month) ?? 0n;
    const keys = Object.keys(daysByProject);
    const weights = keys.map((key) => daysByProject[key] ?? 0);
    const parts = allocateByWeights(pool, weights);
    keys.forEach((key, partIndex) => {
      const part = parts[partIndex] ?? 0n;
      add(sharedAlloc, key, part);
      allocated += part;
    });
  }

  if (allocated !== shared) {
    throw new Error(
      `shared allocations ${allocated.toString()} do not sum to shared costs ${shared.toString()}`,
    );
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
    const dir = -(direct.get(key) ?? 0n);
    const alloc = -(sharedAlloc.get(key) ?? 0n);
    const open = openByProject.get(key) ?? 0n;
    invoicedIncome += inv;
    cashIncome += cashAmt;
    directCosts += dir;
    openReceivablesGross += open;
    const project = demo.projects[key];
    projects[key] = {
      key,
      name: project?.name ?? key,
      invoicedIncome: inv,
      cashIncome: cashAmt,
      directCosts: dir,
      sharedAlloc: alloc,
      grossProfitInvoiced: inv - dir,
      grossProfitCash: cashAmt - dir,
      profitAfterAllocInvoiced: inv - dir - alloc,
      profitAfterAllocCash: cashAmt - dir - alloc,
      openReceivableGross: open,
    };
  }

  const sharedCosts = -shared;
  const overheadCosts = -overhead;
  const monthlyExpensesNet: Record<string, bigint> = {};
  for (const [month, amount] of [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    monthlyExpensesNet[month] = -amount;
  }

  return {
    projects,
    company: {
      invoicedIncome,
      cashIncome,
      direct: directCosts,
      shared: sharedCosts,
      overhead: overheadCosts,
      netProfitInvoiced: invoicedIncome - directCosts - sharedCosts - overheadCosts,
      netProfitCash: cashIncome - directCosts - sharedCosts - overheadCosts,
      openReceivablesGross,
    },
    monthlyExpensesNet,
    lines,
  };
}

function openReceivables(lines: NormalizedLine[]): Map<string, bigint> {
  const byOriginal = new Map<number, NormalizedLine[]>();
  for (const line of lines) {
    if (line.originalSumitId == null) continue;
    const list = byOriginal.get(line.originalSumitId) ?? [];
    list.push(line);
    byOriginal.set(line.originalSumitId, list);
  }

  const open = new Map<string, bigint>();
  for (const line of lines) {
    if (line.kind !== "inv" || line.projectKey == null) continue;
    let remaining = line.grossAgorot;
    for (const other of byOriginal.get(line.sumitId) ?? []) {
      if (other.kind === "cred") remaining += other.grossAgorot;
      else if (other.kind === "rec") remaining -= other.grossAgorot;
    }
    if (remaining !== 0n) add(open, line.projectKey, remaining);
  }
  return open;
}
