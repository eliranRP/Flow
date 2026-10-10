import type { CashCurrencyRow, CashLine, CashMonths } from "@flow/shared";
import { shiftMonthKey } from "../period";
import { israelToday } from "../ui/date-math";

/**
 * FLOW-413: invented figures for the cash view's dev fixtures and stories (frame b's numbers).
 * The months end with the current one, so the band always names this month.
 */

/** FLOW-418: the cash profit leaves out, by category; it adds up to net less profit. */
const KEPT_OUT = [
  { name: "שיפוץ והשבחה", amount_minor: -440_000n },
  { name: "השקעת בעלים", amount_minor: 200_000n },
];

function row(inMinor: bigint, outMinor: bigint, profit: bigint, kept: CashCurrencyRow["not_in_profit_categories"] = []): CashCurrencyRow {
  return {
    currency: "ILS",
    in_minor: inMinor,
    out_minor: outMinor,
    net_minor: inMinor - outMinor,
    profit_minor: profit,
    excluded_count: 0,
    excluded_in_minor: 0n,
    excluded_out_minor: 0n,
    not_in_profit_categories: kept,
  };
}

export function sampleCashMonths(now = new Date()): NonNullable<CashMonths> {
  const current = israelToday(now).slice(0, 7);
  const month = (back: number) => `${shiftMonthKey(current, -back)}-01`;
  return {
    basis: "paid",
    base_currency: "ILS",
    months: [
      { month: month(0), by_currency: [row(1_800_000n, 1_480_000n, 560_000n, KEPT_OUT)] },
      { month: month(1), by_currency: [row(1_650_000n, 1_765_000n, 210_000n)] },
      { month: month(2), by_currency: [row(1_720_000n, 1_480_000n, 390_000n)] },
      { month: month(3), by_currency: [row(1_700_000n, 1_520_000n, 330_000n)] },
    ],
  };
}

/** A month with nothing in or out yet: the band reads ₪0. */
export function sampleQuietCashMonths(now = new Date()): NonNullable<CashMonths> {
  const data = sampleCashMonths(now);
  const [first, ...rest] = data.months;
  return { ...data, months: [{ month: first?.month ?? "", by_currency: [row(0n, 0n, 0n)] }, ...rest] };
}

function line(id: string, day: string, supplier: string, project: string | null, category: string, minor: bigint, side: "in" | "out", source: string): CashLine {
  return {
    transaction_id: id,
    part: null,
    description: supplier,
    supplier_name: supplier,
    project_name: project,
    category_name: category,
    doc_date: day,
    cash_month_date: day,
    currency: "ILS",
    amount_minor: minor,
    side,
    source,
  };
}

export function sampleCashLines(side: "in" | "out" | "kept", now = new Date()): CashLine[] {
  const current = israelToday(now).slice(0, 7);
  const day = (d: number) => `${current}-${String(d).padStart(2, "0")}`;
  // FLOW-418: the month's cash profit leaves out (KEPT_OUT's lines), both sides mixed.
  if (side === "kept") {
    return [
      line("8", day(7), "קבלן שיפוצים לדוגמה", "שיפוץ הרצל 12", "שיפוץ והשבחה", 440_000n, "out", "mercury"),
      line("9", day(3), "שותף לדוגמה", null, "השקעת בעלים", 200_000n, "in", "mercury"),
    ];
  }
  if (side === "in") {
    return [
      line("1", day(9), "שוכר דירה לדוגמה", "בניין הדקל", "שכר דירה", 650_000n, "in", "mercury"),
      line("2", day(5), "שוכרת דירה לדוגמה", "וילה רעננה", "שכר דירה", 600_000n, "in", "mercury"),
      line("3", day(2), "לקוח לדוגמה", "שיפוץ הרצל 12", "הכנסה מלקוחות", 550_000n, "in", "sumit"),
    ];
  }
  return [
    line("4", day(8), "בנק משכנתאות לדוגמה", "בניין הדקל", "משכנתא", 720_000n, "out", "mercury"),
    line("5", day(6), "חומרי בניין לדוגמה", "שיפוץ הרצל 12", "חומרים", 410_000n, "out", "sumit"),
    line("6", day(4), "חברת חשמל לדוגמה", "בניין הדקל", "חשמל", 95_000n, "out", "mercury"),
    line("7", day(1), "עירייה לדוגמה", "וילה רעננה", "ארנונה", 255_000n, "out", "mercury"),
  ];
}
