/**
 * SUMIT document → ledger line. Same VAT rules as packages/shared/src/pnl.ts.
 * Kept inside the function bundle so a deploy does not need the monorepo.
 * Decision 0043. A parity test checks this against pnlFromDemo.
 */

export type DocKind = "inv" | "rec" | "invrec" | "cred" | "exp";
export type PnlRole = "project" | "shared" | "overhead";
export type VatStatus = "source" | "derived" | "assumed" | "unknown";

export interface SumitDoc {
  key: string;
  sumit_id: number;
  kind: DocKind;
  date: string;
  gross: number;
  wo: number;
  vat: number | null;
  bud: number | null;
  bud_name: string | null;
  orig: number | null;
  cust: number | null;
  cust_name: string | null;
  number: number | null;
  desc: string;
}

export interface LedgerLine {
  key: string;
  sumitId: number;
  kind: DocKind;
  projectKey: string | null;
  role: PnlRole | null;
  date: string;
  month: string;
  grossAgorot: bigint;
  netAgorot: bigint;
  vatAgorot: bigint;
  vatStatus: VatStatus;
  supplierName: string | null;
  customerName: string | null;
  description: string;
  originalSumitId: number | null;
  budgetSectionId: number | null;
}

function divHalfEven(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twice = remainder * 2n;
  if (twice < denominator) return quotient;
  if (twice > denominator) return quotient + 1n;
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

function shekelsToAgorot(shekels: number): bigint {
  const negative = shekels < 0;
  const text = Math.abs(shekels).toString();
  const body = text.includes("e") ? Math.abs(shekels).toFixed(12).replace(/0+$/, "").replace(/\.$/, "") : text;
  const [whole = "0", frac = ""] = body.split(".");
  const digits = (frac + "000").slice(0, 3);
  const kept = digits.slice(0, 2);
  const guard = Number(digits[2] ?? "0");
  const rest = frac.slice(3);
  let agorot = BigInt(whole) * 100n + BigInt(kept);
  const more = /[1-9]/.test(rest);
  const tie = guard === 5 && !more;
  const roundUp = guard > 5 || (guard === 5 && more) || (tie && agorot % 2n === 1n);
  if (roundUp) agorot += 1n;
  return negative ? -agorot : agorot;
}

export function netFromGross(grossAgorot: bigint, rateBp: number): bigint {
  if (rateBp === 0) return grossAgorot;
  const negative = grossAgorot < 0n;
  const abs = negative ? -grossAgorot : grossAgorot;
  const net = divHalfEven(abs * 10000n, BigInt(10000 + rateBp));
  return negative ? -net : net;
}

function expenseRole(description: string): PnlRole {
  if (description.startsWith("עלות משותפת")) return "shared";
  if (description.startsWith("תקורה")) return "overhead";
  return "project";
}

function linkedRateBp(
  invoice: SumitDoc | undefined,
  companyRateBp: number,
): number {
  if (!invoice || invoice.gross === 0) return companyRateBp;
  if (invoice.vat != null) return Math.round(invoice.vat * 100);
  const gross = shekelsToAgorot(invoice.gross);
  const net = shekelsToAgorot(invoice.wo);
  const absGross = gross < 0n ? -gross : gross;
  const absNet = net < 0n ? -net : net;
  if (absNet === 0n || absGross === absNet) return absGross === absNet ? 0 : companyRateBp;
  const bp = Number(divHalfEven((absGross - absNet) * 10000n, absNet));
  if (bp < 0 || bp > 10000) return companyRateBp;
  return bp;
}

export function deriveLine(
  doc: SumitDoc,
  projectKey: string | null,
  vatExempt: boolean,
  companyRateBp: number,
  bySumitId: Map<number, SumitDoc>,
): LedgerLine {
  const grossAgorot = shekelsToAgorot(doc.gross);
  const sourceNetAgorot = shekelsToAgorot(doc.wo);
  const month = doc.date.slice(0, 7);
  const base = {
    key: doc.key,
    sumitId: doc.sumit_id,
    kind: doc.kind,
    date: doc.date,
    month,
    grossAgorot,
    description: doc.desc,
    originalSumitId: doc.orig,
    budgetSectionId: doc.bud,
    supplierName: doc.kind === "exp" ? doc.cust_name : null,
    customerName: doc.kind === "exp" ? null : doc.cust_name,
  };

  if (doc.kind === "exp") {
    const hasSourceSplit = doc.vat != null && sourceNetAgorot !== grossAgorot;
    const rateBp = vatExempt ? 0 : companyRateBp;
    const netAgorot = hasSourceSplit ? sourceNetAgorot : netFromGross(grossAgorot, rateBp);
    const role = expenseRole(doc.desc);
    return {
      ...base,
      projectKey: role === "project" ? projectKey : null,
      role,
      netAgorot,
      vatAgorot: grossAgorot - netAgorot,
      vatStatus: hasSourceSplit ? "source" : vatExempt ? "derived" : "assumed",
    };
  }

  if (doc.kind === "rec") {
    const invoice = doc.orig == null ? undefined : bySumitId.get(doc.orig);
    const rateBp = linkedRateBp(invoice, companyRateBp);
    const netAgorot = netFromGross(grossAgorot, rateBp);
    return {
      ...base,
      projectKey,
      role: null,
      netAgorot,
      vatAgorot: grossAgorot - netAgorot,
      vatStatus: "derived",
    };
  }

  return {
    ...base,
    projectKey,
    role: null,
    netAgorot: sourceNetAgorot,
    vatAgorot: grossAgorot - sourceNetAgorot,
    vatStatus: "source",
  };
}

function first<T>(value: unknown): T | null {
  return Array.isArray(value) && value.length > 0 ? (value[0] as T) : null;
}

const KIND_BY_DEFINITION: Record<number, DocKind> = {
  7: "inv",
  11: "rec",
  8: "invrec",
  2: "cred",
  13: "exp",
};

/** One CRM listentities row. Unknown definition enums are skipped. */
export function mapCrmEntity(entity: Record<string, unknown>): SumitDoc | null {
  const definition = first<number>(entity.Accounting_DefinitionEnum);
  if (typeof definition !== "number") return null;
  const kind = KIND_BY_DEFINITION[definition];
  if (!kind) return null;
  const id = entity.ID;
  if (typeof id !== "number") return null;
  const gross = first<number>(entity.Accounting_DisplayCompanyValue);
  const wo = first<number>(entity.Accounting_DisplayCompanyValueWithoutVAT);
  const rawVat = first<number>(entity.Accounting_VATRate);
  const dateRaw = first<string>(entity.Accounting_Date);
  const budget = first<{ ID?: number; Name?: string }>(entity.BudgetManagement_BudgetItem);
  const original = first<{ ID?: number }>(entity.Accounting_OriginalDocument);
  const party = first<{ ID?: number; Name?: string }>(entity.Accounting_Customer);
  const desc = first<string>(entity.Accounting_Description) ?? "";
  const number = first<number>(entity.Accounting_Number);
  if (typeof gross !== "number" || typeof wo !== "number" || typeof dateRaw !== "string") return null;
  const missingExpenseSplit = kind === "exp" && (rawVat == null || wo === gross);
  return {
    key: String(id),
    sumit_id: id,
    kind,
    date: dateRaw.slice(0, 10),
    gross,
    wo,
    vat: missingExpenseSplit ? null : rawVat,
    bud: typeof budget?.ID === "number" ? budget.ID : null,
    bud_name: typeof budget?.Name === "string" ? budget.Name : null,
    orig: typeof original?.ID === "number" ? original.ID : null,
    cust: typeof party?.ID === "number" ? party.ID : null,
    cust_name: typeof party?.Name === "string" ? party.Name : null,
    number: typeof number === "number" ? number : null,
    desc,
  };
}

const CRM_LIST_FIELDS = [
  "Accounting_DefinitionEnum",
  "Accounting_DisplayCompanyValue",
  "Accounting_Date",
] as const;

/** Fields a CRM document row must carry. Empty means the sample still matches the mapper. */
export function sampleDrift(entities: Record<string, unknown>[]): string[] {
  const sample = entities.find((entity) => entity && typeof entity === "object");
  if (!sample) return [];
  const missing: string[] = [];
  if (typeof sample.ID !== "number") missing.push("ID");
  for (const key of CRM_LIST_FIELDS) {
    const value = sample[key];
    if (!Array.isArray(value) || value.length === 0) missing.push(key);
  }
  return missing;
}

/** Read-only SUMIT paths. Anything else throws before the request. */
export const SUMIT_ALLOWLIST = [
  "https://api.sumit.co.il/crm/data/listfolders/",
  "https://api.sumit.co.il/crm/data/listentities/",
  "https://api.sumit.co.il/accounting/documents/list/",
] as const;

export function assertSumitUrl(url: string): void {
  if (!(SUMIT_ALLOWLIST as readonly string[]).includes(url)) {
    throw new Error("SUMIT path is not allowlisted");
  }
}
