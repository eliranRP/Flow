import { applyBp, type MemberShareResult, type PropertyShare, type QuoteShare } from "@flow/shared";
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

/** Sell everything: value − selling costs − loans = net; the member's part of it. */
export function saleFormula(r: MemberShareResult, member: Share, memberMinor: bigint | null): Formula {
  const t = r.totals;
  const count = r.properties.length;
  return {
    rows: [
      money("value", "", "שווי הנכסים", t.valueMinor, `${String(count)} נכסים`),
      money("selling", "−", "עלויות מכירה", -t.sellingCostMinor, "תיווך, סגירה ומסים"),
      money("loans", "−", "סילוק הלוואות", -t.loanBalanceMinor, "יתרות היום"),
      ...(member == null ? [] : [money("net", "=", "הון נקי", t.saleNetMinor, "לכל השותפים")]),
    ],
    result: shareRow("share", t.saleNetMinor, member, memberMinor),
  };
}

/** Refinance: new loan − payoff − closing = cash out; the member's part of it. */
export function refiFormula(r: MemberShareResult, member: Share, memberMinor: bigint | null): Formula {
  const t = r.totals;
  return {
    rows: [
      money("loan", "", "הלוואה חדשה", t.newLoanMinor, `${bpText(r.assumptions.ltvBp)} מהשווי`),
      money("payoff", "−", "סילוק ההלוואות הקיימות", -t.payoffMinor, "יתרות היום"),
      money("closing", "−", "עלויות סגירה", -t.closingMinor, `${bpText(r.assumptions.closingBp)} מההלוואה החדשה`),
      ...(member == null ? [] : [money("cash", "=", "כסף שמשתחרר", t.cashOutMinor, "לכל השותפים")]),
    ],
    result: shareRow("share", t.cashOutMinor, member, memberMinor),
  };
}

/** One property's sale. */
export function propertySaleFormula(p: PropertyShare, member: Share): Formula {
  return {
    rows: [
      money("value", "", "שווי", p.valueMinor, p.valueDate == null ? undefined : "הערכה"),
      money("selling", "−", "עלויות מכירה", -p.sellingCostMinor, `${bpText(p.sellingCostBp)}${p.sellingCostDefault ? " · ברירת מחדל" : ""}`),
      money("loans", "−", "סילוק הלוואות", -p.loanBalanceMinor, "יתרה היום"),
      ...(member == null ? [] : [money("net", "=", "הון נקי", p.saleNetMinor, "לכל השותפים")]),
    ],
    result: shareRow("share", p.saleNetMinor, member, member == null ? null : applyBp(p.saleNetMinor, member.ownershipBp)),
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
