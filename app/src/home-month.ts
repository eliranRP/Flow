// FLOW-364: Home's month logic, with no React. Amounts are bigint minor units, months are
// YYYY-MM keys and days are the Israel-local date (YYYY-MM-DD) that israelToday() returns.

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The month Home shows: `?month=` clamped to [first, current]. Anything else, or no month, is
 * the current month. `firstKey` is null when the books hold no cash yet.
 */
export function homeMonthKey(search: string, todayKey: string, firstKey: string | null): string {
  const raw = new URLSearchParams(search).get("month");
  const current = todayKey.slice(0, 7);
  if (raw == null || !MONTH_KEY.test(raw)) return current;
  if (raw > current) return current;
  if (firstKey != null && raw < firstKey) return firstKey;
  return raw;
}

/** The Home path for a month: "/" for the current month, else "/?month=YYYY-MM"; `preview` is kept. */
export function homeMonthPath(key: string, search: string, currentKey: string): string {
  const params = new URLSearchParams();
  if (key !== currentKey) params.set("month", key);
  const preview = new URLSearchParams(search).get("preview");
  if (preview != null) params.set("preview", preview);
  const query = params.toString();
  return query === "" ? "/" : `/?${query}`;
}

/**
 * A change pill's tone. נכנס going up helps, and יצא going down helps; the opposite hurts.
 * No change, no pill.
 */
export function changeTone(side: "in" | "out", delta: bigint): "helps" | "hurts" | null {
  if (delta === 0n) return null;
  const up = delta > 0n;
  return (side === "in") === up ? "helps" : "hurts";
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

export type SplitParts = {
  /** net minus profit: the cash the P&L leaves out ("השקעה" or "הון שנכנס"). */
  notCounted: bigint;
  profit: bigint;
  /** Whole percents of the two absolute parts; they add to 100. */
  notCountedPct: number;
  profitPct: number;
  /** The note's lead when the left-out part is the larger one: money out went to properties, or money in is capital. */
  lead: "out" | "in" | null;
  /** False when both parts are 0: the card is hidden. */
  visible: boolean;
};

/** The split card: the month's net, divided into the part the P&L leaves out and the month's profit. */
export function splitParts(netMinor: bigint, profitMinor: bigint): SplitParts {
  const notCounted = netMinor - profitMinor;
  const total = abs(notCounted) + abs(profitMinor);
  if (total === 0n) {
    return { notCounted, profit: profitMinor, notCountedPct: 0, profitPct: 0, lead: null, visible: false };
  }
  const notCountedPct = Math.round((Number(abs(notCounted)) * 100) / Number(total));
  const larger = abs(notCounted) > abs(profitMinor);
  return {
    notCounted,
    profit: profitMinor,
    notCountedPct,
    profitPct: 100 - notCountedPct,
    lead: larger ? (notCounted < 0n ? "out" : "in") : null,
    visible: true,
  };
}

/**
 * The forecast for the month's end: net so far, plus the recurring money in still due and the
 * open invoices, less the recurring money out still due. The three addends are positive amounts.
 * The row shows only when one of them is not 0.
 */
export function forecastMinor(
  netMinor: bigint,
  recurringInMinor: bigint,
  recurringOutMinor: bigint,
  openInvoicesMinor: bigint,
): { minor: bigint; show: boolean } {
  const show = recurringInMinor !== 0n || recurringOutMinor !== 0n || openInvoicesMinor !== 0n;
  return { minor: netMinor + recurringInMinor - recurringOutMinor + openInvoicesMinor, show };
}

export type DrawerCellState = "selected" | "data" | "future" | "before";

export type DrawerCell = {
  key: string;
  /** 0 for January. */
  index: number;
  state: DrawerCellState;
  /** The month's net in the base currency; null for a future or a before-the-books month. */
  netMinor: bigint | null;
};

/**
 * The twelve cells of one year in the month drawer. `netByMonth` holds the base-currency net
 * of each month that has data, keyed by YYYY-MM. A month after today is "future"; a month
 * before the books' first month is "before" (both disabled).
 */
export function drawerCells(
  year: number,
  netByMonth: Record<string, bigint>,
  firstKey: string | null,
  todayKey: string,
  selectedKey: string,
): DrawerCell[] {
  const today = todayKey.slice(0, 7);
  return Array.from({ length: 12 }, (_, index) => {
    const key = `${String(year)}-${String(index + 1).padStart(2, "0")}`;
    if (key === selectedKey) return { key, index, state: "selected", netMinor: netByMonth[key] ?? 0n };
    if (key > today) return { key, index, state: "future", netMinor: null };
    if (firstKey != null && key < firstKey) return { key, index, state: "before", netMinor: null };
    return { key, index, state: "data", netMinor: netByMonth[key] ?? 0n };
  });
}

/** Whether a year button can step to `year + delta`: only into a year that has months in [first, current]. */
export function canStepYear(year: number, delta: number, firstKey: string | null, todayKey: string): boolean {
  const target = year + delta;
  if (target > Number(todayKey.slice(0, 4))) return false;
  if (firstKey != null && target < Number(firstKey.slice(0, 4))) return false;
  return true;
}
