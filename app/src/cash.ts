import type { CashCurrencyRow, CashMonth, CashMonths, CashSide } from "@flow/shared";
import { cashAmountsText, type CashRow } from "./ui/cash-rows";
import { HEBREW_MONTHS, israelToday } from "./ui/date-math";

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

/** A month's lines page: נכנס, יצא, or (FLOW-417) "kept", the cash the P&L leaves out. */
export type CashListSide = CashSide | "kept";

export function cashSideLabel(side: CashListSide): string {
  if (side === "kept") return NOT_IN_PROFIT_LABEL;
  return side === "in" ? "נכנס" : "יצא";
}

export function isCashSide(value: string | undefined): value is CashListSide {
  return value === "in" || value === "out" || value === "kept";
}

/** FLOW-417 (glossary: kept-out is "לא נספר ברווח"). */
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
 * The rows under a month's cash figure: נכנס and יצא open the month's lines, רווח החודש opens the
 * profit view for the month, and (FLOW-417) לא נספר ברווח, the rest of the month's figure, opens
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
          tone: "quiet",
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
      label: "רווח החודש",
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
