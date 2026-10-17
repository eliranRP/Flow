import type { CashCurrencyRow, CashLine, CashMonths, CashToDay, CashYears } from "@flow/shared";
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
  const nets = [210_000n, 340_000n, -90_000n, 150_000n, 280_000n, 60_000n, 190_000n, -130_000n, 220_000n, 170_000n, 250_000n, 310_000n];
  return {
    basis: "paid",
    base_currency: "ILS",
    months: nets.map((net, index) => {
      const month = String(12 - index).padStart(2, "0");
      return { month: `${String(year)}-${month}-01`, by_currency: [row(1_500_000n + net, 1_500_000n, net / 2n)] };
    }),
  };
}

/** FLOW-364: the previous month up to today's day, as cash_month_to_day returns it (invented figures). */
export function sampleCashToDay(): CashToDay {
  return [{ currency: "ILS", in_minor: 1_420_000n, out_minor: 1_310_000n }];
}

/**
 * FLOW-364 (board): a negative month in dollars, the board's shape. Money out is above money in,
 * the split card reads the minus with an investment row and a negative profit row, and the
 * forecast is negative. `past` gives the darker frame's month (`?month=past`), whose own figures
 * and the month before it are the board's September. Invented round figures, in cents.
 */
function usdRow(inMinor: bigint, outMinor: bigint, profit: bigint, kept: CashCurrencyRow["not_in_profit_categories"] = []): CashCurrencyRow {
  return {
    currency: "USD",
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

export function sampleCashUsdLoss(past = false, now = new Date()): NonNullable<CashMonths> {
  const current = israelToday(now).slice(0, 7);
  const month = (back: number) => `${shiftMonthKey(current, -back)}-01`;
  // Three named categories, so the subline reads "שיפוץ והשבחה, הון בעלים ועוד" as the board's does.
  const investment = (amount: bigint) => {
    const part = amount / 10n;
    return [
      { name: "שיפוץ והשבחה", amount_minor: part * 6n },
      { name: "הון בעלים", amount_minor: part * 2n + (amount - part * 9n) },
      { name: "ריבית", amount_minor: part },
    ];
  };
  const months = past
    ? [
        usdRow(2_480_000n, 4_200_000n, -340_000n, investment(-1_380_000n)),
        usdRow(6_145_000n, 23_877_000n, -2_472_000n, investment(-15_260_000n)),
        usdRow(14_890_000n, 3_431_800n, 11_458_200n),
        usdRow(1_700_000n, 1_520_000n, 180_000n),
      ]
    : [
        usdRow(2_487_740n, 4_206_860n, -343_400n, investment(-1_375_700n)),
        usdRow(1_824_000n, 6_350_000n, -4_526_000n),
        usdRow(1_720_000n, 1_480_000n, 240_000n),
        usdRow(1_700_000n, 1_520_000n, 180_000n),
      ];
  return {
    basis: "paid",
    base_currency: "USD",
    months: months.map((by, index) => ({ month: month(index), by_currency: [by] })),
  };
}

/** The current month's previous month up to today's day, in dollars, for the change pills. */
export function sampleCashUsdToDay(): CashToDay {
  // The board: money in up, money out down (the same-day compare for the change pills).
  return [{ currency: "USD", in_minor: 1_824_000n, out_minor: 6_351_000n }];
}

/**
 * FLOW-364 (board, FlowPicker): the usd-loss year in dollars, January to the current month. The
 * cells show each month's net: losses in coral with a minus, the rest plain. Invented figures.
 */
export function sampleCashUsdYear(now = new Date()): NonNullable<CashMonths> {
  const year = israelToday(now).slice(0, 4);
  const current = israelToday(now).slice(0, 7);
  const nets = [842_000n, -315_000n, 1_278_000n, 409_000n, -2_160_000n, 931_000n, 299_600n, 11_458_200n, -17_732_000n, -1_720_000n];
  return {
    basis: "paid",
    base_currency: "USD",
    months: nets.map((net, index) => {
      const key = `${year}-${String(index + 1).padStart(2, "0")}`;
      const base = 2_000_000n;
      const inMinor = net >= 0n ? base + net : base;
      const outMinor = net >= 0n ? base : base - net;
      return { month: `${key}-01`, by_currency: [usdRow(inMinor, outMinor, net)] };
    }).filter((row) => row.month.slice(0, 7) <= current),
  };
}

/** FLOW-366: the lines with the flags the server sends. The first has a review open, the second is out of profit. */
export function sampleCashLinesFlagged(side: "in" | "out" | "kept", now = new Date()): CashLine[] {
  return sampleCashLines(side, now).map((row, index) => ({ ...row, pending: index === 0, in_pnl: index !== 1 }));
}

/**
 * The board's USD company (the Lines frames): invented suppliers, amounts with cents, five lines
 * waiting for approval, and $13,757 that profit leaves out. The days count back from today, so the
 * day heads read "היום" and "אתמול" on any date.
 */

const BOARD_KEPT = [
  { name: "ציוד לעסק", amount_minor: -900_000n },
  { name: "שיפוץ והשבחה", amount_minor: -475_700n },
];

export function sampleBoardCashMonths(now = new Date()): NonNullable<CashMonths> {
  const current = israelToday(now).slice(0, 7);
  const month = (back: number) => `${shiftMonthKey(current, -back)}-01`;
  return {
    basis: "paid",
    base_currency: "USD",
    months: [
      { month: month(0), by_currency: [usdRow(2_487_700n, 4_206_900n, -3_094_900n, BOARD_KEPT)] },
      { month: month(1), by_currency: [usdRow(1_980_000n, 2_310_000n, 180_000n)] },
      { month: month(2), by_currency: [usdRow(2_120_000n, 1_890_000n, 410_000n)] },
      { month: month(3), by_currency: [usdRow(1_760_000n, 1_720_000n, 90_000n)] },
    ],
  };
}

/**
 * The board's lines: [days back, supplier, project, category, minor, pending, in P&L]. The first five wait
 * for approval; the loan principal and the rehab are the two lines profit leaves out ($13,757).
 */
const BOARD_OUT: Array<[number, string, string | null, string, bigint, boolean, boolean]> = [
  [0, "Redfield", "Maple St · השכרה", "ביטוח", 124_000n, true, true],
  [1, "Bayside Water Works", "Maple St · השכרה", "אחר", 8_640n, true, true],
  [1, "Harlow's", null, "חומרים", 41_218n, true, true],
  [2, "Pike Plumbing LLC", "Pine Ridge · שיפוץ", "שירותים", 240_000n, true, true],
  [3, "Norvell Builders", "Birch Court · דופלקס להשכרה", "שיפוץ", 128_450n, true, true],
  [4, "Ridgeway Loans", "Birch Court · דופלקס להשכרה", "תשלומי הלוואה", 395_700n, false, false],
  [5, "Hillcrest Renovations", "Birch Court · דופלקס להשכרה", "שיפוץ", 980_000n, false, false],
  [6, "Clearwater Clean", "Birch Court · דופלקס להשכרה", "שירותים", 650_000n, false, true],
  [7, "Cloudline Software", null, "תוכנות ומנויים", 118_000n, false, true],
  [8, "Tilecraft Supply", "Maple St · השכרה", "חומרים", 745_000n, false, true],
  [9, "Payroll Partners", "Pine Ridge · שיפוץ", "שכר", 211_892n, false, true],
  [9, "Harbor Bistro", null, "אחר", 64_000n, false, true],
  [10, "Flameline Gas", "Pine Ridge · שיפוץ", "חשמל", 195_000n, false, true],
  [10, "Lantern Paint Co", "Pine Ridge · שיפוץ", "חומרים", 290_000n, false, true],
  [10, "Kestrel Electric", "Maple St · השכרה", "חשמל", 15_000n, false, true],
];

/** The board's income lines: a tenant's rent, and the lines that make up the day totals. */
const BOARD_IN: Array<[number, string, string | null, string, bigint, boolean]> = [
  [2, "R. Delgado · שכר דירה", "Birch Court · דופלקס להשכרה", "הכנסה מלקוחות", 185_000n, true],
  [6, "T. Lindqvist · שכר דירה", "Maple St · השכרה", "הכנסה מלקוחות", 172_500n, false],
  [8, "S. Whitfield · שכר דירה", "Maple St · השכרה", "הכנסה מלקוחות", 215_000n, false],
  [9, "Moreno Co · החזר נאמנות", "Birch Court · דופלקס להשכרה", "הכנסה אחרת", 260_000n, false],
  [9, "Harborline Ltd · תשלום 2 מתוך 4", "Harborline · עבודת לקוח", "הכנסה מלקוחות", 155_200n, false],
];

function isoDaysBack(now: Date, back: number): string {
  const [year, month, day] = israelToday(now).split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) - back)).toISOString().slice(0, 10);
}

function boardLine(id: number, day: string, supplier: string, project: string | null, category: string, minor: bigint, side: "in" | "out", pending: boolean, inPnl: boolean): CashLine {
  // The loan's installment is its principal part, which profit leaves out (the tag reads "קרן הלוואה").
  const part = category === "תשלומי הלוואה" ? "principal" : null;
  return { ...line(String(id), day, supplier, project, category, minor, side, "mercury"), part, currency: "USD", pending, in_pnl: inPnl };
}

export function sampleBoardCashLines(side: "in" | "out", now = new Date()): CashLine[] {
  if (side === "in") {
    return BOARD_IN.map(([back, supplier, project, category, minor, pending], index) =>
      boardLine(100 + index, isoDaysBack(now, back), supplier, project, category, minor, "in", pending, true));
  }
  return BOARD_OUT.map(([back, supplier, project, category, minor, pending, inPnl], index) =>
    boardLine(200 + index, isoDaysBack(now, back), supplier, project, category, minor, "out", pending, inPnl));
}
