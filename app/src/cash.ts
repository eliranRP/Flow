import { formatAmountText, type CashCurrencyRow, type CashLine, type CashMonth, type CashMonths, type CashSide, type CashTotalRow, type CashYears } from "@flow/shared";
import { cashAmountsText, type CashRow } from "./ui/cash-rows";
import { HEBREW_MONTHS, israelToday } from "./ui/date-math";
import type { SplitHintPart } from "./ui/split-parts-hint";

/**
 * FLOW-413 (owner's "Cash first", frame b; decision 0168). The words, paths and figures of the
 * monthly cash view: Home shows this month's תזרים, then נכנס and יצא, then רווח החודש and the
 * earlier months.
 */

/** Home reads this many months: the current one and the earlier ones under "חודשים קודמים". */
export const CASH_MONTHS = 4;

/** yyyy-mm of a `cash_months` month ("2026-10-01"). */
export function cashMonthKey(month: string): string {
  return month.slice(0, 7);
}

export function isCashMonthKey(value: string | undefined): value is string {
  return value != null && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** The month's name; a month outside the current year keeps its year ("דצמבר 2025"). */
export function cashMonthName(key: string, now = new Date()): string {
  const name = HEBREW_MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
  return key.slice(0, 4) === israelToday(now).slice(0, 4) ? name : `${name} ${key.slice(0, 4)}`;
}

/** "תזרים אוקטובר": the band's label, and a month page's title. */
export function cashTitle(key: string, now = new Date()): string {
  return `תזרים ${cashMonthName(key, now)}`;
}

/** A month's lines page: נכנס, יצא, or (FLOW-418) "kept", the cash the P&L leaves out. */
export type CashListSide = CashSide | "kept";

export function cashSideLabel(side: CashListSide): string {
  if (side === "kept") return NOT_IN_PROFIT_LABEL;
  return side === "in" ? "נכנס" : "יצא";
}

export function isCashSide(value: string | undefined): value is CashListSide {
  return value === "in" || value === "out" || value === "kept";
}

/** FLOW-418 (glossary: kept-out is "לא נספר ברווח"). */
export const NOT_IN_PROFIT_LABEL = "לא נספר ברווח";

/** The cash profit leaves out: with רווח החודש it adds up to the month's figure. */
export function notInProfitMinor(row: CashCurrencyRow): bigint {
  return row.net_minor - row.profit_minor;
}

/** The row's hint: the two largest categories profit leaves out ("שיפוץ והשבחה, השקעת בעלים"). */
export function notInProfitHint(row: CashCurrencyRow | undefined): string | undefined {
  const names = (row?.not_in_profit_categories ?? []).map((category) => category.name).filter((name) => name !== "");
  if (names.length === 0) return undefined;
  const shown = names.slice(0, 2).join(", ");
  return names.length > 2 ? `${shown} ועוד` : shown;
}

/**
 * What the categories don't cover (VAT, a line out of the view but in profit): the lines page
 * says so under its figure, so its rows and figure still add up.
 */
export function notInProfitRest(row: CashCurrencyRow): bigint {
  return notInProfitMinor(row) - row.not_in_profit_categories.reduce((sum, category) => sum + category.amount_minor, 0n);
}

/** A month's page: its figure, נכנס and יצא. */
export function cashMonthPath(key: string, search: string): string {
  return `/cash/${key}${search}`;
}

/** The lines behind one month's נכנס, יצא or לא נספר ברווח in one currency. */
export function cashLinesPath(key: string, side: CashListSide, currency: string, search: string): string {
  return `/cash/${key}/${side}/${currency}${search}`;
}

/** The base currency first, then the others as the server sends them. */
export function cashRows(month: CashMonth | undefined, base: string): CashCurrencyRow[] {
  const rows = month?.by_currency ?? [];
  if (rows.some((row) => row.currency === base)) return rows;
  return [
    {
      currency: base,
      in_minor: 0n,
      out_minor: 0n,
      net_minor: 0n,
      profit_minor: 0n,
      excluded_count: 0,
      excluded_in_minor: 0n,
      excluded_out_minor: 0n,
      not_in_profit_categories: [],
    },
    ...rows,
  ];
}

/** A currency other than the base shows only in a month where it moved. */
export function shownCashRows(month: CashMonth | undefined, base: string): CashCurrencyRow[] {
  return cashRows(month, base).filter(
    (row) => row.currency === base || row.in_minor !== 0n || row.out_minor !== 0n || row.profit_minor !== 0n,
  );
}

/** The profit view (frame b-2). "רווח החודש" opens it on its month (the row's `profitMonth`). */
export function profitPath(search: string): string {
  return `/profit${search}`;
}

/**
 * The rows under a month's cash figure: נכנס and יצא open the month's lines, רווח החודש (on an
 * earlier month "רווח ב<month>") opens the profit view for the month, and (FLOW-418) לא נספר ברווח, the rest of the month's figure, opens
 * the lines profit leaves out; it shows only when some currency has any. Each row lists the base
 * currency, then any other that moved.
 */
export function cashSummaryRows(key: string, rows: CashCurrencyRow[], search: string, now = new Date()): CashRow[] {
  const name = cashMonthName(key, now);
  const base = rows[0]?.currency ?? "ILS";
  const amounts = (pick: (row: CashCurrencyRow) => bigint) => rows.map((row) => ({ currency: row.currency, minor: pick(row) }));
  const incoming = amounts((row) => row.in_minor);
  const outgoing = amounts((row) => row.out_minor);
  const profit = amounts((row) => row.profit_minor);
  const kept = amounts(notInProfitMinor);
  const keptRow: CashRow[] = kept.some((amount) => amount.minor !== 0n)
    ? [
        {
          id: "kept",
          label: NOT_IN_PROFIT_LABEL,
          hint: notInProfitHint(rows[0]),
          tone: "aside",
          amounts: kept,
          href: cashLinesPath(key, "kept", base, search),
          name: `${NOT_IN_PROFIT_LABEL} ב${name} ${cashAmountsText(kept)} – פירוט`,
        },
      ]
    : [];
  return [
    {
      id: "in",
      label: cashSideLabel("in"),
      tone: "in",
      amounts: incoming,
      href: cashLinesPath(key, "in", base, search),
      name: `נכנס ב${name} ${cashAmountsText(incoming)} – פירוט`,
    },
    {
      id: "out",
      label: cashSideLabel("out"),
      tone: "out",
      amounts: outgoing,
      href: cashLinesPath(key, "out", base, search),
      name: `יצא ב${name} ${cashAmountsText(outgoing)} – פירוט`,
    },
    {
      id: "profit",
      // FLOW-362: an earlier month's row names its month; the current month keeps "רווח החודש".
      label: key === israelToday(now).slice(0, 7) ? "רווח החודש" : `רווח ב${name}`,
      tone: "quiet",
      amounts: profit,
      href: profitPath(search),
      profitMonth: key,
      name: `רווח ב${name} ${cashAmountsText(profit)}`,
    },
    ...keptRow,
  ];
}

/** The earlier months under "חודשים קודמים": each month's net, opening its own page. */
export function earlierMonthRows(data: NonNullable<CashMonths>, search: string, now = new Date()): CashRow[] {
  return data.months.slice(1).map((month) => {
    const key = cashMonthKey(month.month);
    const rows = shownCashRows(month, data.base_currency);
    const net = rows.map((row) => ({ currency: row.currency, minor: row.net_minor }));
    return {
      id: key,
      label: cashMonthName(key, now),
      tone: "net",
      amounts: net,
      href: cashMonthPath(key, search),
      name: `${cashTitle(key, now)} ${cashAmountsText(net)}`,
    };
  });
}

/**
 * FLOW-417 (owner's "Years, then months", decision 0174). Home's "לכל החודשים" opens the history:
 * the net since the first cash month, then a row per year; a year opens its months, and a month
 * opens its page as from Home.
 */
export function cashHistoryPath(search: string): string {
  return `/cash/history${search}`;
}

export function cashYearPath(year: number, search: string): string {
  return `/cash/year/${String(year)}${search}`;
}

export function isCashYear(value: string | undefined): value is string {
  return value != null && /^\d{4}$/.test(value);
}

/** "תזרים מאז מרץ 2023": the history band. Books with no cash line yet read "תזרים". */
export function cashHistoryLabel(firstMonth: string | null): string {
  if (firstMonth == null) return "תזרים";
  const name = HEBREW_MONTHS[Number(firstMonth.slice(5, 7)) - 1] ?? "";
  return `תזרים מאז ${name} ${firstMonth.slice(0, 4)}`;
}

/** A year page's band: the current year runs "עד היום" so it does not read as a full year. */
export function cashYearTitle(year: number, now = new Date()): string {
  return year === Number(israelToday(now).slice(0, 4)) ? `תזרים ${String(year)} עד היום` : `תזרים ${String(year)}`;
}

/** The base currency first (always), then any other currency that moved. */
export function shownTotalRows(rows: CashTotalRow[], base: string): CashTotalRow[] {
  const withBase = rows.some((row) => row.currency === base)
    ? rows
    : [{ currency: base, in_minor: 0n, out_minor: 0n, net_minor: 0n }, ...rows];
  return withBase.filter((row) => row.currency === base || row.in_minor !== 0n || row.out_minor !== 0n);
}

/** The quiet line under a year: the current year's month count, or the first year's first month. */
function yearHint(year: number, data: NonNullable<CashYears>): string | undefined {
  const first = data.first_month;
  if (first != null && Number(first.slice(0, 4)) === year && first.slice(5, 7) !== "01") {
    return `מאז ${HEBREW_MONTHS[Number(first.slice(5, 7)) - 1] ?? ""}`;
  }
  if (Number(data.this_month.slice(0, 4)) === year) {
    const months = Number(data.this_month.slice(5, 7));
    return months === 1 ? "חודש אחד" : `${String(months)} חודשים`;
  }
  return undefined;
}

/** One row per year, newest first, each opening its months. */
export function cashYearRows(data: NonNullable<CashYears>, search: string): CashRow[] {
  return data.years.map((entry) => {
    const net = shownTotalRows(entry.by_currency, data.base_currency).map((row) => ({ currency: row.currency, minor: row.net_minor }));
    return {
      id: String(entry.year),
      label: String(entry.year),
      hint: yearHint(entry.year, data),
      tone: "net",
      amounts: net,
      href: cashYearPath(entry.year, search),
      name: `תזרים ${String(entry.year)} ${cashAmountsText(net)}`,
    };
  });
}

/** A year's months that hold books: none before the first cash month. */
export function cashYearMonths(data: NonNullable<CashMonths>, firstMonth: string | null | undefined): CashMonth[] {
  return data.months.filter((month) => firstMonth == null || month.month >= firstMonth);
}

/** The year's figures, summed from its months, per currency. */
export function cashYearTotals(months: CashMonth[], base: string): CashCurrencyRow[] {
  const sums = new Map<string, CashCurrencyRow>();
  for (const month of months) {
    for (const row of month.by_currency) {
      const sum = sums.get(row.currency);
      sums.set(
        row.currency,
        sum == null
          ? { ...row }
          : {
              currency: row.currency,
              in_minor: sum.in_minor + row.in_minor,
              out_minor: sum.out_minor + row.out_minor,
              net_minor: sum.net_minor + row.net_minor,
              profit_minor: sum.profit_minor + row.profit_minor,
              excluded_count: sum.excluded_count + row.excluded_count,
              excluded_in_minor: sum.excluded_in_minor + row.excluded_in_minor,
              excluded_out_minor: sum.excluded_out_minor + row.excluded_out_minor,
              // The year page has no לא נספר ברווח row.
              not_in_profit_categories: [],
            },
      );
    }
  }
  const rows = [...sums.values()].sort((a, b) => (a.currency === base ? -1 : b.currency === base ? 1 : a.currency.localeCompare(b.currency)));
  return shownCashRows({ month: "", by_currency: rows }, base);
}

/** The year page's נכנס and יצא: figures only, since a month's page holds the lines. */
export function cashYearSummaryRows(year: number, rows: CashCurrencyRow[]): CashRow[] {
  const incoming = rows.map((row) => ({ currency: row.currency, minor: row.in_minor }));
  const outgoing = rows.map((row) => ({ currency: row.currency, minor: row.out_minor }));
  return [
    { id: "in", label: cashSideLabel("in"), tone: "in", amounts: incoming, name: `נכנס ב${String(year)} ${cashAmountsText(incoming)}` },
    { id: "out", label: cashSideLabel("out"), tone: "out", amounts: outgoing, name: `יצא ב${String(year)} ${cashAmountsText(outgoing)}` },
  ];
}

/** The year's month rows, newest first, by name only (the page names the year). */
export function cashYearMonthRows(months: CashMonth[], base: string, search: string): CashRow[] {
  return months.map((month) => {
    const key = cashMonthKey(month.month);
    const name = HEBREW_MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
    const net = shownCashRows(month, base).map((row) => ({ currency: row.currency, minor: row.net_minor }));
    return {
      id: key,
      label: name,
      tone: "net",
      amounts: net,
      href: cashMonthPath(key, search),
      name: `תזרים ${name} ${key.slice(0, 4)} ${cashAmountsText(net)}`,
    };
  });
}

/**
 * FLOW-432. A split line's parts as its row hint names them: each part this row counts, by its
 * category, with its amount (cents when it has them), and the whole line. null for any other row.
 */
export function cashLineSplit(row: Pick<CashLine, "parts" | "line_minor" | "currency">): { parts: SplitHintPart[]; total: string } | null {
  if (row.parts == null || row.parts.length === 0 || row.line_minor == null) return null;
  return {
    parts: row.parts.map((part) => ({
      name: part.name ?? "חלק",
      amount: formatAmountText(part.amount_minor < 0n ? -part.amount_minor : part.amount_minor, row.currency, { detail: true }),
    })),
    total: formatAmountText(row.line_minor, row.currency, { detail: true }),
  };
}
