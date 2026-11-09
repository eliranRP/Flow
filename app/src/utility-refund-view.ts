import { formatAmountText } from "@flow/shared";
import type { UtilityBill, UtilityPayment } from "./utility-refunds";

/**
 * FLOW-1135 (V3-UtilityRefunds): the list's cards, worked out from list_utility_refunds. A payment Flow suggests
 * for one bill, or for several of the property's bills together (rules 2 and 3), is one card; a payment the owner
 * matched that sits in another category is the same card with the "may be filed wrong" note.
 */
export type RefundCard = {
  /** The payment: one card per payment and property. */
  key: string;
  projectId: string;
  bills: UtilityBill[];
  payment: UtilityPayment;
  rule: UtilityBill["rule"];
  /** The owner said yes and the payment sits in another category: the one-tap fix. */
  fix: boolean;
  /** The payment is not filed to the bills' category (the fix's note after a yes). */
  wrongCategory: boolean;
};

export type RefundGroup = {
  projectId: string;
  name: string;
  cards: RefundCard[];
  open: UtilityBill[];
};

export type RefundFilter = "all" | "review" | "open";

/** What the screen did before the next read: a card or a row answered here, or a card waiting for the fix. */
export type LocalAnswer = "hidden" | "fix";

/** The suggestions and the fixes first, then the bills not refunded, per property in the server's order. */
export function refundGroups(bills: readonly UtilityBill[], local: ReadonlyMap<string, LocalAnswer> = new Map()): RefundGroup[] {
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
      if (local.get(bill.bill_transaction_id) !== "hidden") group(bill).open.push(bill);
      continue;
    }
    const payment = bill.payment;
    const card = bill.state === "suggested" || (bill.state === "refunded" && bill.source === "owner" && bill.wrong_category && !bill.keep_category && !bill.refiled);
    if (payment == null || !card) continue;
    const key = `${bill.project_id}:${payment.transaction_id}`;
    const into = group(bill);
    const found = into.cards.find((item) => item.key === key);
    if (found) {
      found.bills.push(bill);
      continue;
    }
    into.cards.push({ key, projectId: bill.project_id, bills: [bill], payment, rule: bill.rule, fix: bill.state === "refunded", wrongCategory: bill.wrong_category });
  }
  return [...groups.values()]
    .map((item) => ({
      ...item,
      cards: item.cards
        .filter((card) => local.get(card.key) !== "hidden")
        .map((card) => (local.get(card.key) === "fix" ? { ...card, fix: true } : card)),
    }))
    .filter((item) => item.cards.length + item.open.length > 0);
}

/** The cards waiting for a yes or a no. */
export function askingCards(groups: readonly RefundGroup[]): RefundCard[] {
  return groups.flatMap((item) => item.cards.filter((card) => !card.fix));
}

/** The sum of the bills not refunded, per currency in the order they first appear. */
export function openTotals(groups: readonly RefundGroup[]): { currency: string; minor: bigint }[] {
  const totals = new Map<string, bigint>();
  for (const bill of groups.flatMap((item) => item.open)) totals.set(bill.currency, (totals.get(bill.currency) ?? 0n) + bill.amount_minor);
  return [...totals].map(([currency, minor]) => ({ currency, minor }));
}

/** dd/mm, as the board writes a bill's day. */
export function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function days(count: number): string {
  return count === 1 ? "יום אחד" : `${String(count)} ימים`;
}

/** A card's bills: their supplier names, and their category with the date. */
export function cardBillTitle(card: RefundCard): string {
  return card.bills.map((bill) => bill.supplier_name ?? "ספק").join(" + ");
}

export function cardBillTotal(card: RefundCard): bigint {
  return card.bills.reduce((sum, bill) => sum + bill.amount_minor, 0n);
}

export function cardBillMeta(card: RefundCard): string {
  const [first] = card.bills;
  if (first == null) return "";
  return [first.category_name, dayMonth(first.doc_date)].filter((part): part is string => part != null).join(" · ");
}

/** The payment's payer (or its description). */
export function paymentTitle(payment: UtilityPayment): string {
  return payment.party ?? payment.description ?? "תשלום";
}

/** "שכירות · 02/10 · 18 ימים אחרי", or "בלי פרויקט · הכנסה · 12/09 · …" for a payment on no property. */
export function paymentMeta(card: RefundCard): string {
  const [first] = card.bills;
  const gap = first == null ? 0 : Math.round((Date.parse(card.payment.doc_date) - Date.parse(first.doc_date)) / 86_400_000);
  return [
    card.payment.project_id == null ? "בלי פרויקט" : null,
    card.payment.category_name ?? "בלי קטגוריה",
    dayMonth(card.payment.doc_date),
    gap === 0 ? "באותו יום" : gap > 0 ? `${days(gap)} אחרי` : `${days(-gap)} לפני`,
  ].filter((part): part is string => part != null).join(" · ");
}

/** Why Flow suggests it: the same amount, the month's bills together, or the usual rent plus the bill. */
export function cardWhy(card: RefundCard): string {
  const bills = cardBillTotal(card);
  const currency = card.payment.currency;
  if (card.rule === "rent_and_bills") {
    const rent = card.payment.amount_minor - bills;
    return `השכירות ${formatAmountText(rent, currency, { detail: true })} + ${card.bills.length === 1 ? "החשבון" : "החשבונות"} ${formatAmountText(bills, currency, { detail: true })}`;
  }
  const what = card.rule === "bills" ? `${String(card.bills.length)} חשבונות של אותו חודש יחד` : "אותו סכום";
  return card.payment.project_id == null ? `${what} · התשלום בלי פרויקט` : what;
}

/** Where the fix files it, and what the note says it will do. The books do not change until the tap. */
export function fixCopy(card: RefundCard): { label: string; hint: string } {
  const category = card.bills[0]?.category_name ?? "החשבונות";
  const split = card.rule === "rent_and_bills";
  const filed = card.payment.category_name ?? "הכנסה";
  return {
    label: split ? `פיצול והחזר ל${category}` : `העברה ל${category} כהחזר`,
    hint: split
      ? `התשלום רשום כ${filed}. אפשר לפצל ממנו את החשבון ולרשום אותו כהחזר. הספרים לא ישתנו עד שתלחצו.`
      : `התשלום רשום כ${filed}${card.payment.project_id == null ? ", בלי פרויקט" : ""}. הספרים לא ישתנו עד שתלחצו.`,
  };
}

/** A bill's line: "לא הוחזר · 67 ימים · 03/09", and the no-rent note. */
export function openMeta(bill: UtilityBill): string {
  return ["לא הוחזר", days(bill.days), dayMonth(bill.doc_date), bill.no_rent ? "חודש בלי שכירות" : null]
    .filter((part): part is string => part != null)
    .join(" · ");
}

/** The group head's line: "1 לבדיקה · 2 לא הוחזרו". */
export function groupSummary(group: RefundGroup): string {
  const asking = group.cards.filter((card) => !card.fix).length;
  const parts = [asking > 0 ? `${String(asking)} לבדיקה` : null, group.open.length > 0 ? `${String(group.open.length)} לא הוחזרו` : null];
  return parts.filter((part): part is string => part != null).join(" · ") || "הכול נבדק";
}

/** A property's row on its page: the same count and totals Home's row reads, from the property's list. */
export function refundCount(bills: readonly UtilityBill[]): { notRefunded: number; suggested: number; totals: { currency: string; minor: bigint }[] } {
  const open = bills.filter((bill) => bill.state === "not_refunded");
  const totals = new Map<string, bigint>();
  for (const bill of open) totals.set(bill.currency, (totals.get(bill.currency) ?? 0n) + bill.amount_minor);
  return {
    notRefunded: open.length,
    suggested: bills.filter((bill) => bill.state === "suggested").length,
    totals: [...totals].map(([currency, minor]) => ({ currency, minor })),
  };
}
