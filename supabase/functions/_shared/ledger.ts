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

/**
 * SUMIT descriptions use a prefix convention. Decision 0063.
 * "עלות משותפת" is a shared cost. "תקורה" is overhead. Anything else is a project cost.
 */
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
    const explicitZero = doc.vat === 0;
    const hasSourceSplit = doc.vat != null && sourceNetAgorot !== grossAgorot;
    const exempt = vatExempt || explicitZero;
    const rateBp = exempt ? 0 : companyRateBp;
    const netAgorot = hasSourceSplit ? sourceNetAgorot : netFromGross(grossAgorot, rateBp);
    const role = expenseRole(doc.desc);
    return {
      ...base,
      projectKey: role === "project" ? projectKey : null,
      role,
      netAgorot,
      vatAgorot: grossAgorot - netAgorot,
      vatStatus: hasSourceSplit || explicitZero ? "source" : vatExempt ? "derived" : "assumed",
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
  const missingExpenseSplit = kind === "exp" && (rawVat == null || (wo === gross && rawVat !== 0));
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

/**
 * FLOW-510. The SUMIT field that broke when a CRM row cannot be mapped, else null. A row of a
 * kind the sync does not read (a quote, an order) is skipped by design and is not drift. A row
 * with no definition enum at all is drift: SUMIT may have renamed the field.
 */
export function crmEntityDrift(entity: Record<string, unknown>): string | null {
  const definition = first<number>(entity.Accounting_DefinitionEnum);
  if (typeof definition !== "number") return "Accounting_DefinitionEnum";
  if (!KIND_BY_DEFINITION[definition]) return null;
  if (typeof entity.ID !== "number") return "ID";
  if (typeof first<number>(entity.Accounting_DisplayCompanyValue) !== "number") return "Accounting_DisplayCompanyValue";
  if (typeof first<number>(entity.Accounting_DisplayCompanyValueWithoutVAT) !== "number") {
    return "Accounting_DisplayCompanyValueWithoutVAT";
  }
  if (typeof first<string>(entity.Accounting_Date) !== "string") return "Accounting_Date";
  return null;
}

/** FLOW-510. The rows one sync mapped, and the rows it could not map by the field that broke. */
export interface CrmTally {
  mapped: number;
  broken: Record<string, number>;
}

/**
 * FLOW-510. More than 1 in 20 of the rows the sync should read could not be mapped. The sync then
 * stops before it writes, so the full sweep cannot void documents SUMIT still has: the last good
 * ledger stays, and the connection shows sync_schema_drift.
 */
export function isSchemaDrift(tally: CrmTally): boolean {
  const broken = Object.values(tally.broken).reduce((sum, count) => sum + count, 0);
  return broken > 0 && broken * 20 > tally.mapped + broken;
}

/** FLOW-510. A CRM row's definition enum as a string for the skipped-kinds log, else "other". */
export function definitionOf(entity: Record<string, unknown>): string {
  const definition = first<number>(entity.Accounting_DefinitionEnum);
  return typeof definition === "number" ? String(definition) : "other";
}

/**
 * FLOW-510. A page whose Data field is gone, or whose Data object has none of the row-list keys
 * the sync reads. A null Data or a null or empty row list is an empty company, not drift.
 */
export function pageShapeDrift(payload: Record<string, unknown>): boolean {
  if (!("Data" in payload)) return true;
  const data = payload.Data;
  if (data == null || Array.isArray(data) || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  return !["Entities", "Data", "List"].some((key) => key in record);
}

/** Read-only SUMIT paths. Anything else throws before the request. */
export const SUMIT_ALLOWLIST = [
  "https://api.sumit.co.il/crm/schema/listfolders/",
  "https://api.sumit.co.il/crm/data/listentities/",
  "https://api.sumit.co.il/accounting/documents/list/",
] as const;

/** A SUMIT document link the app may open: SUMIT's own download page, nothing else. */
export const SUMIT_DOCUMENT_URL = /^https:\/\/pay\.sumit\.co\.il\/[^\s"'<>\\]+$/;

/**
 * FLOW-335. DocumentID to DocumentDownloadURL from one `accounting/documents/list` page. The
 * DocumentID is the CRM entity ID the sync keys documents by. Links on another host are dropped.
 */
export function documentUrls(data: unknown): Map<number, string> {
  const urls = new Map<number, string>();
  const documents = data && typeof data === "object" ? (data as Record<string, unknown>).Documents : null;
  if (!Array.isArray(documents)) return urls;
  for (const item of documents) {
    if (!item || typeof item !== "object") continue;
    const doc = item as Record<string, unknown>;
    const id = doc.DocumentID;
    const url = doc.DocumentDownloadURL;
    if (typeof id !== "number" || !Number.isSafeInteger(id)) continue;
    if (typeof url !== "string" || url.length > 500 || !SUMIT_DOCUMENT_URL.test(url)) continue;
    urls.set(id, url);
  }
  return urls;
}

/**
 * FLOW-335. The open SUMIT invoices (amount left after linked receipts and credit notes, as
 * list_unpaid counts it) that have no stored link yet, and the earliest of their dates. The sync
 * reads `documents/list` only for these, so a sync with nothing new to link costs no extra call.
 */
export function invoicesMissingLinks(docs: SumitDoc[], linked: ReadonlySet<string>): { ids: number[]; from: string | null } {
  const open = new Map<number, number>();
  for (const doc of docs) if (doc.kind === "inv") open.set(doc.sumit_id, doc.gross);
  for (const doc of docs) {
    if (doc.orig == null || !open.has(doc.orig)) continue;
    if (doc.kind === "cred") open.set(doc.orig, (open.get(doc.orig) ?? 0) + doc.gross);
    if (doc.kind === "rec") open.set(doc.orig, (open.get(doc.orig) ?? 0) - doc.gross);
  }
  const ids: number[] = [];
  let from: string | null = null;
  for (const doc of docs) {
    if (doc.kind !== "inv" || linked.has(String(doc.sumit_id))) continue;
    if (Math.abs(open.get(doc.sumit_id) ?? 0) < 0.005) continue;
    ids.push(doc.sumit_id);
    if (from == null || doc.date < from) from = doc.date;
  }
  return { ids, from };
}

export function assertSumitUrl(url: string): void {
  if (!(SUMIT_ALLOWLIST as readonly string[]).includes(url)) {
    throw new Error("SUMIT path is not allowlisted");
  }
}
