import { applyBp, type MemberShare, type MemberShareResult, type PropertyShare, type QuoteShare } from "@flow/shared";
import type { Formula, FormulaRow } from "./project-returns-info";

/* ------------------------------------------------------------------------------------------------
 * FLOW-1118: the member share report's words and formulas (pure, for the screen and its sheets).
 * ---------------------------------------------------------------------------------------------- */

export type ReportMode = "sell" | "refi";

/** A rate in parts per million as a percent: 58800 → "5.88%", 61250 with 3 places → "6.125%". */
export function ppmText(ppm: number, places = 2): string {
  return `${(ppm / 10_000).toFixed(places)}%`;
}

/** A quote's rate: two places, or three when the third is not zero (6.125%). */
export function quoteRateText(ppm: number): string {
  return ppmText(ppm, ppm % 100 === 0 ? 2 : 3);
}

/** Basis points as a percent with no trailing zeros: 7500 → "75%", 250 → "2.5%". */
export function bpText(bp: number): string {
  return `${String(Number((bp / 100).toFixed(2)))}%`;
}

/** A spread in basis points as points: 150 → "+1.5". */
export function spreadText(bp: number): string {
  return `+${String(Number((bp / 100).toFixed(2)))}`;
}

/** A quote's line under its lender: how far from the expected rate, and whether it is good. */
export function verdictText(quote: QuoteShare): string | null {
  if (quote.diffPpm == null || quote.verdict == null) return null;
  const gap = ppmText(Math.abs(quote.diffPpm));
  if (quote.verdict === "good") return quote.diffPpm === 0 ? "בדיוק הצפוי · הצעה טובה" : `מתחת לצפוי ב־${gap} · הצעה טובה`;
  if (quote.verdict === "near") return `מעל הצפוי ב־${gap} · קרוב`;
  return `מעל הצפוי ב־${gap}`;
}

/** The member the page shows: `?member=` when it names one, else the first. */
export function memberIndex(search: string, count: number): number {
  const raw = new URLSearchParams(search).get("member");
  const index = raw != null && /^\d+$/.test(raw) ? Number(raw) : 0;
  return index < count ? index : 0;
}

export function modeOf(search: string): ReportMode {
  return new URLSearchParams(search).get("mode") === "refi" ? "refi" : "sell";
}

function money(key: string, op: FormulaRow["op"], label: string, minor: bigint, hint?: string, income = false): FormulaRow {
  return { key, op, label, ...(hint == null ? {} : { hint }), value: { kind: "money", minor, ...(income ? { income: true } : {}) } };
}

/** The member's part, or the company's whole before ownership is set. */
export type Share = { name: string; ownershipBp: number } | null;

function shareRow(key: string, whole: bigint, member: Share, minor: bigint | null): FormulaRow {
  if (member == null) return money(key, "=", "לכל השותפים", whole);
  return money(key, "=", `החלק של ${member.name}`, minor ?? 0n, bpText(member.ownershipBp), true);
}

/**
 * FLOW-1121: the part of החישוב a row opens: its figure per property (or per member, or per loan), and the total.
 * FLOW-1124: the members' loans, a member's total, and the profit's rows.
 */
export type DrillKey =
  | "value" | "selling" | "loans" | "member_loans" | "net" | "share" | "total"
  | "loan" | "payoff" | "closing" | "cash"
  | "profit_value" | "profit_selling" | "all_in" | "profit" | "profit_share";

export const DRILL_KEYS: readonly DrillKey[] = [
  "value", "selling", "loans", "member_loans", "net", "share", "total",
  "loan", "payoff", "closing", "cash",
  "profit_value", "profit_selling", "all_in", "profit", "profit_share",
];

/** The rows open their parts: each row's sheet (the page's resolver opens it). */
function opens(row: FormulaRow, sheet: DrillKey): FormulaRow {
  return { ...row, target: { kind: "sheet", sheet } };
}

/**
 * The selling cost's hint: its percent ("8% · ברירת מחדל" when every property takes the default), or the range
 * when the properties differ ("7%–8%"), then what it is.
 */
export function sellingHint(properties: readonly PropertyShare[]): string {
  const what = "תיווך, סגירה ומסים";
  if (properties.length === 0) return what;
  const bps = properties.map((p) => p.sellingCostBp);
  const low = Math.min(...bps);
  const high = Math.max(...bps);
  if (low !== high) return `${bpText(low)}–${bpText(high)} · ${what}`;
  return `${bpText(low)}${properties.every((p) => p.sellingCostDefault) ? " · ברירת מחדל" : ""} · ${what}`;
}

/**
 * Sell everything: value − selling costs − the banks' loans − the members' loans = equity, then the member's part
 * of it, and (FLOW-1124) their own loans back: their total. Every row opens its parts, so the last row is a row
 * too (FormulaList's result row opens nothing).
 */
export function saleFormula(r: MemberShareResult, member: MemberShare | null): Formula {
  const t = r.totals;
  const count = r.properties.length;
  const share: Share = member == null ? null : { name: member.name, ownershipBp: member.ownershipBp };
  const memberLoans = t.memberLoansMinor === 0n ? [] : [
    opens(money("member_loans", "−", "החזר הלוואות שותפים", -t.memberLoansMinor, "חוזרות לשותף שנתן אותן"), "member_loans"),
  ];
  const own = member == null || t.memberLoansMinor === 0n ? [] : [
    opens(money("own", "+", `הלוואות של ${member.name}`, member.loansMinor, member.loansMinor === 0n ? "אין" : "מוחזרות במכירה", true), "member_loans"),
    opens(money("total", "=", `סה״כ ל־${member.name}`, member.saleTotalMinor, "חלק בהון + הלוואות", true), "total"),
  ];
  return {
    rows: [
      opens(money("value", "", "שווי הנכסים", t.valueMinor, `${String(count)} נכסים`), "value"),
      opens(money("selling", "−", "עלויות מכירה", -t.sellingCostMinor, sellingHint(r.properties)), "selling"),
      opens(money("loans", "−", "סילוק הלוואות", -t.bankLoanMinor, "יתרות היום"), "loans"),
      ...memberLoans,
      ...(member == null ? [] : [opens(money("net", "=", "הון נקי", t.equityMinor, "לכל השותפים"), "net")]),
      opens(shareRow("share", t.equityMinor, share, member?.saleMinor ?? null), member == null ? "net" : "share"),
      ...own,
    ],
    result: null,
  };
}

/** FLOW-1124: why a property has no all-in, in a few words. */
export const PROFIT_MISSING_WORDS = { purchase: "אין מחיר קנייה", rehab: "אין עלות שיפוץ במטבע הנכס" } as const;

/** Why one property has no all-in: no purchase, or no renovation figure in its currency. */
export function noAllInText(p: PropertyShare): string {
  return p.purchaseMinor == null ? PROFIT_MISSING_WORDS.purchase : PROFIT_MISSING_WORDS.rehab;
}

/** The all-in's hint: what it is made of. */
export const ALL_IN_HINT = "קנייה, שיפוץ והחזקה";

/**
 * FLOW-1124: the profit at the sale, as the investment page's net profit: value − selling costs − the all-in
 * (purchase, renovation, holding), of the properties with an all-in, then the member's part.
 */
export function profitFormula(r: MemberShareResult, member: MemberShare | null): Formula {
  const t = r.totals;
  const share: Share = member == null ? null : { name: member.name, ownershipBp: member.ownershipBp };
  const counted = r.properties.length - r.profitMissing.length;
  return {
    rows: [
      opens(money("profit_value", "", "שווי הנכסים", t.profitValueMinor, `${String(counted)} נכסים`), "profit_value"),
      opens(money("profit_selling", "−", "עלויות מכירה", -t.profitSellingMinor, sellingHint(r.properties.filter((p) => p.allInMinor != null))), "profit_selling"),
      opens(money("all_in", "−", "עלות כוללת", -t.allInMinor, ALL_IN_HINT), "all_in"),
      ...(member == null ? [] : [opens(money("profit", "=", "רווח", t.profitMinor, "לכל השותפים"), "profit")]),
      opens(member == null
        ? money("profit_share", "=", "רווח לכל השותפים", t.profitMinor)
        : shareRow("profit_share", t.profitMinor, share, member.profitMinor), member == null ? "profit" : "profit_share"),
    ],
    result: null,
  };
}

/** Refinance: new loan − payoff − closing = cash out, then the member's part of it; every row opens its parts. */
export function refiFormula(r: MemberShareResult, member: Share, memberMinor: bigint | null): Formula {
  const t = r.totals;
  return {
    rows: [
      opens(money("loan", "", "הלוואה חדשה", t.newLoanMinor, `${bpText(r.assumptions.ltvBp)} מהשווי`), "loan"),
      opens(money("payoff", "−", "סילוק ההלוואות הקיימות", -t.payoffMinor, "יתרות היום"), "payoff"),
      opens(money("closing", "−", "עלויות סגירה", -t.closingMinor, `${bpText(r.assumptions.closingBp)} מההלוואה החדשה`), "closing"),
      ...(member == null ? [] : [opens(money("cash", "=", "כסף שמשתחרר", t.cashOutMinor, "לכל השותפים"), "cash")]),
      opens(shareRow("share", t.cashOutMinor, member, memberMinor), member == null ? "cash" : "share"),
    ],
    result: null,
  };
}

/** One property's sale: its loans, a member's loan on it apart (FLOW-1124). */
export function propertySaleFormula(p: PropertyShare, member: Share): Formula {
  return {
    rows: [
      money("value", "", "שווי", p.valueMinor, p.valueDate == null ? undefined : "הערכה"),
      money("selling", "−", "עלויות מכירה", -p.sellingCostMinor, `${bpText(p.sellingCostBp)}${p.sellingCostDefault ? " · ברירת מחדל" : ""}`),
      money("loans", "−", "סילוק הלוואות", -p.bankLoanMinor, "יתרה היום"),
      ...(p.memberLoanMinor === 0n ? [] : [money("member_loans", "−", "החזר הלוואת שותף", -p.memberLoanMinor, "חוזרת לשותף")]),
      ...(member == null ? [] : [money("net", "=", "הון נקי", p.saleNetMinor, "לכל השותפים")]),
    ],
    result: shareRow("share", p.saleNetMinor, member, member == null ? null : applyBp(p.saleNetMinor, member.ownershipBp)),
  };
}

/** One property's all-in: purchase + renovation + holding (FLOW-1124). */
export function allInParts(p: PropertyShare): { label: string; minor: bigint }[] {
  return [
    { label: "קנייה", minor: p.purchaseMinor ?? 0n },
    { label: "שיפוץ", minor: p.rehabMinor ?? 0n },
    { label: "החזקה", minor: p.holdingMinor ?? 0n },
  ];
}

/** One property's profit at the sale (FLOW-1124); null without its all-in. */
export function propertyProfitFormula(p: PropertyShare, member: Share): Formula | null {
  if (p.allInMinor == null || p.profitMinor == null) return null;
  return {
    rows: [
      money("value", "", "שווי", p.valueMinor),
      money("selling", "−", "עלויות מכירה", -p.sellingCostMinor, bpText(p.sellingCostBp)),
      ...allInParts(p).map((part, i) => money(`all_in_${String(i)}`, "−" as const, part.label, -part.minor)),
      ...(member == null ? [] : [money("profit", "=", "רווח", p.profitMinor, "לכל השותפים")]),
    ],
    result: member == null
      ? money("profit_share", "=", "רווח", p.profitMinor)
      : shareRow("profit_share", p.profitMinor, member, applyBp(p.profitMinor, member.ownershipBp)),
  };
}

/** One property's refinance. */
export function propertyRefiFormula(p: PropertyShare, r: MemberShareResult, member: Share): Formula {
  const cash = p.refinances ? p.cashOutMinor : 0n;
  return {
    rows: [
      money("loan", "", "הלוואה חדשה", p.newLoanMinor, `${bpText(r.assumptions.ltvBp)} מהשווי`),
      money("payoff", "−", "סילוק ההלוואה הקיימת", -p.loanBalanceMinor, "יתרה היום"),
      money("closing", "−", "עלויות סגירה", -p.closingMinor, bpText(r.assumptions.closingBp)),
      ...(member == null ? [] : [money("cash", "=", "כסף שמשתחרר", cash, p.refinances ? "לכל השותפים" : "לא משתלם למחזר")]),
    ],
    result: shareRow("share", cash, member, member == null ? null : applyBp(cash, member.ownershipBp)),
  };
}

/** Why a property is left out, in a line. */
export const MISSING_WORDS: Record<MemberShareResult["missing"][number]["reason"], string> = {
  value: "אין שווי",
  currency: "במטבע אחר",
  loan_currency: "הלוואה במטבע אחר",
};
