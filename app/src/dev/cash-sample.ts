import type { CashCurrencyRow, CashLine, CashMonths, CashYears } from "@flow/shared";
import { shiftMonthKey } from "../period";
import { israelToday } from "../ui/date-math";

/**
 * FLOW-413: invented figures for the cash view's dev fixtures and stories (frame b's numbers).
 * The months end with the current one, so the band always names this month.
 */

function row(inMinor: bigint, outMinor: bigint, profit: bigint, currency = "ILS"): CashCurrencyRow {
  return {
    currency,
    in_minor: inMinor,
    out_minor: outMinor,
    net_minor: inMinor - outMinor,
    profit_minor: profit,
    excluded_count: 0,
    excluded_in_minor: 0n,
    excluded_out_minor: 0n,
  };
}

export function sampleCashMonths(now = new Date()): NonNullable<CashMonths> {
  const current = israelToday(now).slice(0, 7);
  const month = (back: number) => `${shiftMonthKey(current, -back)}-01`;
  return {
    basis: "paid",
    base_currency: "ILS",
    months: [
      { month: month(0), by_currency: [row(1_800_000n, 1_480_000n, 560_000n)] },
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

export function sampleCashLines(side: "in" | "out", now = new Date()): CashLine[] {
  const current = israelToday(now).slice(0, 7);
  const day = (d: number) => `${current}-${String(d).padStart(2, "0")}`;
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

/**
 * FLOW-417: invented years for the history page. The books start in March three years back, and
 * one year ends in a loss, so a loss row shows.
 */
export function sampleCashYears(now = new Date(), currencies: "one" | "two" = "one"): NonNullable<CashYears> {
  const current = israelToday(now).slice(0, 7);
  const year = Number(current.slice(0, 4));
  const total = (net: bigint, inMinor: bigint, currency = "ILS") => ({ currency, in_minor: inMinor, out_minor: inMinor - net, net_minor: net });
  const usd = (net: bigint) => (currencies === "two" ? [total(net, 400_000n, "USD")] : []);
  return {
    basis: "paid",
    base_currency: "ILS",
    this_month: `${current}-01`,
    first_month: `${String(year - 3)}-03-01`,
    by_currency: [total(4_130_000n, 52_000_000n), ...usd(-120_000n)],
    years: [
      { year, by_currency: [total(890_000n, 15_100_000n), ...usd(-120_000n)] },
      { year: year - 1, by_currency: [total(1_960_000n, 18_400_000n)] },
      { year: year - 2, by_currency: [total(-420_000n, 11_300_000n)] },
      { year: year - 3, by_currency: [total(1_700_000n, 7_200_000n)] },
    ],
  };
}

/** FLOW-417: last year's twelve months, newest first, for the year page. */
export function sampleCashYearMonths(now = new Date()): NonNullable<CashMonths> {
  const year = Number(israelToday(now).slice(0, 4)) - 1;
  const nets = [210_000n, 340_000n, -90_000n, 150_000n, 280_000n, 60_000n, 190_000n, -130_000n, 220_000n, 170_000n, 250_000n, 300_000n];
  return {
    basis: "paid",
    base_currency: "ILS",
    months: nets.map((net, index) => {
      const month = String(12 - index).padStart(2, "0");
      return { month: `${String(year)}-${month}-01`, by_currency: [row(1_500_000n + net, 1_500_000n, net / 2n)] };
    }),
  };
}
