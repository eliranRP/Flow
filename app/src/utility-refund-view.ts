import { formatAmountText } from "@flow/shared";
import { formatDayMonth, HEBREW_MONTHS } from "./ui/date-math";
import type { UtilityBill, UtilityIncome, UtilityIncomeBill, UtilityMonth, UtilityPayment } from "./utility-refunds";

/**
 * FLOW-1135 (V3-UtilityRefunds), FLOW-1143: the list's cards, worked out from list_utility_refunds. Flow suggests
 * nothing (the owner, 2026-11-09): a card is a payment the owner matched to a bill (or to the month's bills) that
 * sits in another category, with the "may be filed wrong" note, its one-tap fix and להשאיר.
 */
export type RefundCard = {
  /** The payment: one card per payment and property. */
  key: string;
  projectId: string;
  bills: UtilityBill[];
  payment: UtilityPayment;
};

export type RefundGroup = {
  projectId: string;
  name: string;
  cards: RefundCard[];
  open: UtilityBill[];
};

/** The fix cards first, then the bills not refunded, per property in the server's order. `hidden`: answered here. */
export function refundGroups(bills: readonly UtilityBill[], hidden: ReadonlySet<string> = new Set()): RefundGroup[] {
  const groups = new Map<string, RefundGroup>();
  const group = (bill: UtilityBill) => {
    const found = groups.get(bill.project_id);
    if (found) return found;
    const made: RefundGroup = { projectId: bill.project_id, name: bill.project_name, cards: [], open: [] };
    groups.set(bill.project_id, made);
    return made;
  };
  for (const bill of bills) {
    if (bill.state === "not_refunded") {
      if (!hidden.has(bill.bill_transaction_id)) group(bill).open.push(bill);
      continue;
    }
    const payment = bill.payment;
    const card = bill.state === "refunded" && bill.source === "owner" && bill.wrong_category && !bill.keep_category && !bill.refiled;
    if (payment == null || !card) continue;
    const key = `${bill.project_id}:${payment.transaction_id}`;
    const into = group(bill);
    const found = into.cards.find((item) => item.key === key);
    if (found) {
      found.bills.push(bill);
      continue;
    }
    into.cards.push({ key, projectId: bill.project_id, bills: [bill], payment });
  }
  return [...groups.values()]
    .map((item) => ({
      ...item,
      cards: item.cards.filter((card) => !hidden.has(card.key)),
      // FLOW-1159: the newest bill first.
      open: [...item.open].sort((a, b) => b.doc_date.localeCompare(a.doc_date)),
    }))
    .filter((item) => item.cards.length + item.open.length > 0);
}

/** The sum of the bills not refunded, per currency in the order they first appear. */
export function openTotals(groups: readonly RefundGroup[]): { currency: string; minor: bigint }[] {
  const totals = new Map<string, bigint>();
  for (const bill of groups.flatMap((item) => item.open)) totals.set(bill.currency, (totals.get(bill.currency) ?? 0n) + bill.amount_minor);
  return [...totals].map(([currency, minor]) => ({ currency, minor }));
}

/** FLOW-1141 (the owner): every date on the utility refund screens reads dd/mm/yy, the year included. */
export function refundDate(iso: string): string {
  return formatDayMonth(iso, undefined, { year: "always" });
}

function days(count: number): string {
  return count === 1 ? "יום אחד" : `${String(count)} ימים`;
}

/** A card's bills: their supplier names, and their category with the date. */
export function cardBillTitle(card: RefundCard): string {
  return card.bills.map((bill) => bill.supplier_name ?? "ספק").join(" + ");
}

/** A bill's leg on its card: its category and its date. */
export function billMeta(bill: UtilityBill): string {
  return [bill.category_name, refundDate(bill.doc_date)].filter((part): part is string => part != null).join(" · ");
}

/** The payment's payer (or its description). */
export function paymentTitle(payment: UtilityPayment): string {
  return payment.party ?? payment.description ?? "תשלום";
}

/**
 * "דירת הגפן 3 · שכירות · 02/10/26 · 18 ימים אחרי" (FLOW-1142: the project the payment is filed to), or
 * "בלי פרויקט · הכנסה · 12/09/26 · …" for a payment on no property.
 */
export function paymentMeta(card: RefundCard): string {
  const [first] = card.bills;
  const gap = first == null ? 0 : Math.round((Date.parse(card.payment.doc_date) - Date.parse(first.doc_date)) / 86_400_000);
  return [
    card.payment.project_id == null ? "בלי פרויקט" : card.payment.project_name,
    card.payment.category_name ?? "בלי קטגוריה",
    refundDate(card.payment.doc_date),
    gap === 0 ? "באותו יום" : gap > 0 ? `${days(gap)} אחרי` : `${days(-gap)} לפני`,
  ].filter((part): part is string => part != null).join(" · ");
}

function cardBillTotal(card: RefundCard): bigint {
  return card.bills.reduce((sum, bill) => sum + bill.amount_minor, 0n);
}

/** Where the fix files it, and what the note says it will do. The books do not change until the tap. */
export function fixCopy(card: RefundCard): { label: string; hint: string } {
  const category = card.bills[0]?.category_name ?? "החשבונות";
  // A payment over the bills by more than one unit (rent and the bills): the fix splits their part off it.
  const split = card.payment.amount_minor - cardBillTotal(card) > 100n;
  const filed = card.payment.category_name ?? "הכנסה";
  return {
    label: split ? `פיצול והחזר ל${category}` : `העברה ל${category} כהחזר`,
    hint: split
      ? `התשלום רשום כ${filed}. אפשר לפצל ממנו את החשבון ולרשום אותו כהחזר. הספרים לא ישתנו עד שתלחצו.`
      : `התשלום רשום כ${filed}${card.payment.project_id == null ? ", בלי פרויקט" : ""}. הספרים לא ישתנו עד שתלחצו.`,
  };
}

/** A bill's line: "לא הוחזר · 67 ימים · 03/09/26", and the no-rent note. */
export function openMeta(bill: UtilityBill): string {
  return ["לא הוחזר", days(bill.days), refundDate(bill.doc_date), bill.no_rent ? "חודש בלי שכירות" : null]
    .filter((part): part is string => part != null)
    .join(" · ");
}

/** The group head's line: "2 לא הוחזרו", or "הכול נבדק" when only a fix card is left. */
export function groupSummary(group: RefundGroup): string {
  return group.open.length > 0 ? `${String(group.open.length)} לא הוחזרו` : "הכול נבדק";
}

/** A property's row on its page: the same count and totals Home's row reads, from the property's list. */
export function refundCount(bills: readonly UtilityBill[]): { notRefunded: number; totals: { currency: string; minor: bigint }[] } {
  const open = bills.filter((bill) => bill.state === "not_refunded");
  const totals = new Map<string, bigint>();
  for (const bill of open) totals.set(bill.currency, (totals.get(bill.currency) ?? 0n) + bill.amount_minor);
  return {
    notRefunded: open.length,
    totals: [...totals].map(([currency, minor]) => ({ currency, minor })),
  };
}

/**
 * The payments already the refund of another bill (Flow's match or the owner's), which the payment picker leaves
 * out. A payment matched to a bill of the same property and month stays: one payment may refund a month's bills.
 */
export function paymentsTaken(all: readonly UtilityBill[], bill: UtilityBill): Set<string> {
  const taken = new Set<string>();
  for (const other of all) {
    if (other.state !== "refunded" || other.payment == null || other.bill_transaction_id === bill.bill_transaction_id) continue;
    const sameMonth = other.project_id === bill.project_id && other.doc_date.slice(0, 7) === bill.doc_date.slice(0, 7);
    if (!sameMonth) taken.add(other.payment.transaction_id);
  }
  return taken;
}

/**
 * FLOW-1142: a split payment's parts, one line each: "<category> · <project, when not the payment's>" and the
 * amount. None for a payment that is not split.
 */
export function paymentParts(payment: UtilityPayment): { key: string; text: string; amount: string }[] {
  return payment.parts.map((part, index) => ({
    key: `${String(index)}:${part.category_id ?? ""}:${part.project_id ?? ""}`,
    text: [
      part.category_name ?? "בלי קטגוריה",
      part.project_id === payment.project_id ? null : part.project_id == null ? "בלי פרויקט" : part.project_name,
    ].filter((item): item is string => item != null).join(" · "),
    amount: formatAmountText(part.amount_minor, payment.currency, { detail: true }),
  }));
}

/** FLOW-1144: "אוקטובר 2026", a month of list_utility_months (YYYY-MM-01). */
export function utilityMonthLabel(month: string): string {
  const name = HEBREW_MONTHS[Number(month.slice(5, 7)) - 1];
  return name == null ? month : `${name} ${month.slice(0, 4)}`;
}

/** The month's currency: its first line's, else the company's. */
export function utilityMonthCurrency(month: UtilityMonth, fallback: string): string {
  return month.rent_lines[0]?.currency ?? month.bills[0]?.currency ?? fallback;
}

/**
 * FLOW-1144: a month's status. No rent came in ("לא נכנסה שכירות"); or bills are not refunded ("חסר $X", their sum,
 * a bill still waiting included); or every bill is back ("כל החשבונות הוחזרו"), or closed with ראיתי
 * ("כל החשבונות נבדקו": the owner's word is closed, not refunded).
 */
export function utilityMonthStatus(month: UtilityMonth, currency: string): { ok: boolean; text: string } {
  if (month.rent_lines.length === 0 && month.rent_in === 0n) return { ok: false, text: "לא נכנסה שכירות" };
  if (month.not_refunded > 0n) return { ok: false, text: `חסר ${formatAmountText(month.not_refunded, currency, { detail: true })}` };
  // The owner, 2026-11-10: a month with no tenant-paid bill has nothing to refund, so it does not read "הוחזרו".
  if (month.bills.length === 0) return { ok: true, text: "לא שולמו חשבונות" };
  if (month.bills.some((bill) => bill.state === "seen")) return { ok: true, text: "כל החשבונות נבדקו" };
  return { ok: true, text: "כל החשבונות הוחזרו" };
}

/** Whole days from one ISO date to another (negative when `to` is earlier). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** FLOW-1159: a bill's category for the type views, or "בלי קטגוריה". */
function typeName(bill: { category_name: string | null }): string {
  return bill.category_name ?? "בלי קטגוריה";
}

/** FLOW-1159: "latest update": the later of the bill's date and its payment's (ISO). Lists run newest first by it. */
export function billActivity(bill: UtilityBill): string {
  const paid = bill.payment?.doc_date;
  return paid != null && paid > bill.doc_date ? paid : bill.doc_date;
}

/**
 * FLOW-1159 (V3-J boards): a bill's status in plain words. Refunded within 7 days of the bill: "הוחזר באותו חודש ·
 * 05/11"; later: "הוחזר ב־05/11 · 34 ימים אחרי"; refunded with no payment line: "הוחזר". Seen: "נבדק · ראיתי". Not
 * refunded: "לא הוחזר · 40 ימים"; waiting: "עוד לא הוחזר · 9 ימים". Dates read dd/mm (the year when not this one).
 */
export function billStatusLine(bill: UtilityBill, now = new Date()): string {
  if (bill.state === "refunded") {
    const payment = bill.payment;
    if (payment == null) return "הוחזר";
    const lag = daysBetween(bill.doc_date, payment.doc_date);
    const date = formatDayMonth(payment.doc_date, now);
    return lag <= 7 ? `הוחזר באותו חודש · ${date}` : `הוחזר ב־${date} · ${days(lag)} אחרי`;
  }
  if (bill.state === "seen") return "נבדק · ראיתי";
  if (bill.state === "not_refunded") return `לא הוחזר · ${days(bill.days)}`;
  return `עוד לא הוחזר · ${days(bill.days)}`;
}

export type Totals = { currency: string; minor: bigint }[];

/** The bills the tenant still owes: not refunded, or still waiting. */
function owed(bill: UtilityBill): boolean {
  return bill.state === "not_refunded" || bill.state === "waiting";
}

function totals(bills: readonly UtilityBill[]): Totals {
  const sums = new Map<string, bigint>();
  for (const bill of bills) sums.set(bill.currency, (sums.get(bill.currency) ?? 0n) + bill.amount_minor);
  return [...sums].map(([currency, minor]) => ({ currency, minor }));
}

function byActivity(a: UtilityBill, b: UtilityBill): number {
  return billActivity(b).localeCompare(billActivity(a)) || b.doc_date.localeCompare(a.doc_date);
}

export type BillType = {
  /** The category's name, or "בלי קטגוריה". */
  name: string;
  categoryId: string | null;
  /** Newest activity first. */
  bills: UtilityBill[];
  /** What the tenant still owes of this type (not refunded and waiting), per currency. */
  missing: Totals;
  /** The newest activity of the type (ISO). */
  latest: string;
};

/**
 * FLOW-1159 (V3-J-B3-ByType): a property's bills (list_utility_refunds with all) by type, its category: each type's
 * bills newest activity first with what is missing, the types ordered by their newest activity.
 */
export function billsByType(bills: readonly UtilityBill[]): BillType[] {
  const types = new Map<string, UtilityBill[]>();
  for (const bill of bills) {
    const name = typeName(bill);
    types.set(name, [...(types.get(name) ?? []), bill]);
  }
  return [...types]
    .map(([name, list]) => {
      const sorted = [...list].sort(byActivity);
      return {
        name,
        categoryId: sorted[0]?.category_id ?? null,
        bills: sorted,
        missing: totals(sorted.filter(owed)),
        latest: sorted[0] == null ? "" : billActivity(sorted[0]),
      };
    })
    .sort((a, b) => b.latest.localeCompare(a.latest) || a.name.localeCompare(b.name));
}

/** FLOW-1159: what the tenant owes on these bills (not refunded and waiting), per currency. */
export function tenantOwes(bills: readonly UtilityBill[]): Totals {
  return totals(bills.filter(owed));
}

function sameType(bill: UtilityBill, other: UtilityBill): boolean {
  return other.project_id === bill.project_id && other.category_id === bill.category_id;
}

/**
 * FLOW-1159: how long this type usually takes to come back at the property, from its refunded bills with a payment:
 * "בדרך כלל חשמל מוחזר כ־33 ימים אחרי החשבון." and, for this bill, " החשבון הזה כבר מעבר לזה." (not refunded) or
 * " החשבון הזה עוד בטווח." (waiting). With none: "עוד אין החזרים קודמים של חשמל בנכס."
 */
export function typePattern(bills: readonly UtilityBill[], bill: UtilityBill): string {
  const name = typeName(bill);
  const lags = bills
    .filter((other) => sameType(bill, other) && other.state === "refunded" && other.payment != null)
    .map((other) => daysBetween(other.doc_date, other.payment?.doc_date ?? other.doc_date));
  if (lags.length === 0) return `עוד אין החזרים קודמים של ${name} בנכס.`;
  const average = Math.round(lags.reduce((sum, lag) => sum + lag, 0) / lags.length);
  const usual = average <= 0 ? `בדרך כלל ${name} מוחזר באותו יום של החשבון.` : `בדרך כלל ${name} מוחזר כ־${days(average)} אחרי החשבון.`;
  const tail = bill.state === "not_refunded" ? " החשבון הזה כבר מעבר לזה." : bill.state === "waiting" ? " החשבון הזה עוד בטווח." : "";
  return usual + tail;
}

/** FLOW-1159: this type's bills at the property, newest activity first. */
export function typeHistory(bills: readonly UtilityBill[], bill: UtilityBill): UtilityBill[] {
  return bills.filter((other) => sameType(bill, other)).sort(byActivity);
}

export type IncomeRow =
  | { kind: "bill"; key: string; date: string; label: string }
  | {
    kind: "payment";
    key: string;
    transactionId: string;
    date: string;
    /** "RentRedi · 06/11/26": the payer (or description) and the date. */
    title: string;
    /** "חשמל $180.20 · החזיר את 04/09, 06/10", or "בלי חשמל" when no part of it is the bill's type. */
    hit: string;
    /** No part is the bill's type: the hit reads in the signal colour. */
    hitMissing: boolean;
    /** The other parts: "שכירות $1,750.00 · מים $122.80"; null when there are none. */
    others: string | null;
    /** "+$2,121.40". */
    amount: string;
    /** This line is the bill's refund. */
    refund: boolean;
  };

/**
 * FLOW-1159 (V3-J-Income): the payments around a bill, newest first, with a marker row at the bill's date ("החשבון ·
 * 04/10"; a payment on the bill's day sits above it). Each payment names the part of the bill's type (a line not
 * split, filed to the bill's category, counts whole) and the bills of that type it refunded, then its other parts.
 */
export function incomeRows(income: UtilityIncome, bill: UtilityIncomeBill = income.bill, now = new Date()): IncomeRow[] {
  const type = typeName(bill);
  const money = (minor: bigint, currency: string) => formatAmountText(minor, currency, { detail: true });
  const payments: IncomeRow[] = income.lines.map((line) => {
    const parts = line.parts.length > 0
      ? line.parts
      : [{ category_id: line.category_id, category_name: line.category_name, amount_minor: line.amount_minor }];
    const own = parts.filter((part) => part.category_id === bill.category_id);
    const rest = parts.filter((part) => part.category_id !== bill.category_id);
    const refunded = line.refunded_bills.filter((item) => item.category_id === bill.category_id);
    const hit = own.length === 0
      ? `בלי ${type}`
      : `${type} ${money(own.reduce((sum, part) => sum + part.amount_minor, 0n), line.currency)}`
        + (refunded.length === 0 ? "" : ` · החזיר את ${refunded.map((item) => formatDayMonth(item.doc_date, now)).join(", ")}`);
    return {
      kind: "payment",
      key: line.transaction_id,
      transactionId: line.transaction_id,
      date: line.doc_date,
      title: `${line.party ?? line.description ?? "תשלום"} · ${refundDate(line.doc_date)}`,
      hit,
      hitMissing: own.length === 0,
      others: line.parts.length === 0
        ? own.length === 0 ? typeName(line) : null
        : rest.map((part) => `${typeName(part)} ${money(part.amount_minor, line.currency)}`).join(" · ") || null,
      amount: formatAmountText(line.amount_minor, line.currency, { detail: true, direction: "income", plus: true }),
      refund: line.transaction_id === bill.payment_transaction_id,
    };
  });
  const marker: IncomeRow = { kind: "bill", key: `bill:${bill.bill_transaction_id}`, date: bill.doc_date, label: `החשבון · ${formatDayMonth(bill.doc_date, now)}` };
  const after = payments.filter((row) => row.date >= bill.doc_date);
  const before = payments.filter((row) => row.date < bill.doc_date);
  return [...after, marker, ...before];
}
