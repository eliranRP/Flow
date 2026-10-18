import type { UnpaidRow } from "./dashboard.ts";
import type { ExpectedMonths } from "./forecast.ts";

/**
 * FLOW-141: the month-end forecast (צפי). One pure builder for the app and the MCP read, so the
 * items, the sections and the totals come from the same arithmetic. Inputs are the server's
 * reads (expected_months, list_unpaid, forecast_overrides_for); nothing here reads the network.
 *
 * Items: the recurring parties not yet seen this month (income and expense), and the open
 * customer invoices (income). A row's own number is never changed; an override only changes the
 * forecast (its amount, its day, or "not this month", which moves it out of the totals).
 */

/** One override as the server sends it (amounts are JSON numbers, whole agorot). */
export type ForecastOverrideRow = {
  item_key: string;
  amount_minor: number | null;
  due_on: string | null;
  moved_out: boolean;
};

export type ForecastItem = {
  /** `party:<direction>:<party id>:<currency>` for a recurring party, `invoice:<id>` for an invoice. */
  key: string;
  direction: "income" | "expense";
  kind: "recurring" | "invoice";
  name: string;
  currency: string;
  /** Flow's own number, unsigned, in minor units. */
  usual: bigint;
  /** The number the forecast uses, unsigned: the override's, else usual. */
  minor: bigint;
  /** The usual day of the month (1–31), or null. */
  day: number | null;
  /** An invoice's own description (its number, for example "Invoice #1043"), or null for a recurring charge. */
  description: string | null;
  /** The day the owner set (yyyy-mm-dd), or null. */
  due_on: string | null;
  moved_out: boolean;
  overridden: boolean;
  /** Where Flow itself expects it (yyyy-mm-dd): the usual day this month, or the invoice's date plus its terms. Null unless the caller passes `paymentTermsDays` (the app has no per-document terms, so only fixtures do). */
  expected_on: string | null;
  /** Whole days past `expected_on` (0 when it is not late yet). */
  late_days: number;
};

export type ForecastBuild = {
  /** Every item of the base currency, the moved ones included. */
  items: ForecastItem[];
  /** The items that count, largest first, then by name. */
  income: ForecastItem[];
  expense: ForecastItem[];
  /** Items moved to next month: listed, not counted. */
  moved: ForecastItem[];
  /** The small recurring charges (expense, under SMALL_CHARGE_MINOR), grouped under one row. */
  small: ForecastItem[];
  incomeTotal: bigint;
  expenseTotal: bigint;
  /** How many items the owner changed this month (the reset line's count). */
  changed: number;
};

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

function monthLength(today: string): number {
  return new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
}

function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** A recurring charge under this many minor units (₪100) goes to the grouped row. */
export const SMALL_CHARGE_MINOR = 10000n;

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function byAmountThenName(a: ForecastItem, b: ForecastItem): number {
  if (a.minor !== b.minor) return a.minor > b.minor ? -1 : 1;
  return a.name.localeCompare(b.name, "he");
}

function overrideOf(overrides: ReadonlyMap<string, ForecastOverrideRow>, key: string) {
  return overrides.get(key) ?? null;
}

function applyOverride(item: Omit<ForecastItem, "minor" | "due_on" | "moved_out" | "overridden" | "late_days">, row: ForecastOverrideRow | null, today: string | null): ForecastItem {
  const amount = row?.amount_minor ?? null;
  return {
    ...item,
    late_days: today != null && item.expected_on != null ? Math.max(0, dayNumber(today) - dayNumber(item.expected_on)) : 0,
    minor: amount == null ? item.usual : BigInt(amount),
    due_on: row?.due_on ?? null,
    moved_out: row?.moved_out ?? false,
    overridden: row != null,
  };
}

export function buildMonthForecast(input: {
  base: string;
  expected: ExpectedMonths | null;
  unpaid: readonly UnpaidRow[];
  overrides: readonly ForecastOverrideRow[];
  /** Sample data only: when set, dates are expected (usual day, or document date plus these days) and late items are marked. */
  paymentTermsDays?: number;
}): ForecastBuild {
  const overrides = new Map(input.overrides.map((row) => [row.item_key, row] as const));
  const terms = input.paymentTermsDays ?? null;
  const today = terms == null ? null : input.expected?.today ?? null;
  const raw: Omit<ForecastItem, "minor" | "due_on" | "moved_out" | "overridden" | "late_days">[] = [];

  for (const party of input.expected?.recurring ?? []) {
    if (party.seen_this_month || party.currency !== input.base) continue;
    raw.push({
      key: `party:${party.direction}:${party.party_id}:${party.currency}`,
      direction: party.direction,
      kind: "recurring",
      name: party.name === "" ? "ללא שם" : party.name,
      currency: party.currency,
      usual: abs(party.typical_amount_minor),
      day: party.typical_day > 0 ? party.typical_day : null,
      description: null,
      expected_on: today != null && party.typical_day > 0 ? `${today.slice(0, 7)}-${String(Math.min(party.typical_day, monthLength(today))).padStart(2, "0")}` : null,
    });
  }

  for (const row of input.unpaid) {
    const currency = row.currency ?? "ILS";
    const usual = abs(row.open_gross_agorot);
    if (currency !== input.base || usual === 0n) continue;
    raw.push({
      key: `invoice:${row.id}`,
      // A customer invoice is income; a supplier invoice is expense (older payloads: income).
      direction: row.direction ?? "income",
      kind: "invoice",
      name: row.customer_name != null && row.customer_name !== "" ? row.customer_name : row.description,
      currency,
      usual,
      day: null,
      description: row.description,
      expected_on: terms != null ? addDays(row.doc_date, terms) : null,
    });
  }

  const items = raw.map((item) => applyOverride(item, overrideOf(overrides, item.key), today));
  const moved = items.filter((item) => item.moved_out).sort(byAmountThenName);
  const counted = items.filter((item) => !item.moved_out);
  const income = counted.filter((item) => item.direction === "income").sort(byAmountThenName);
  const expense = counted.filter((item) => item.direction === "expense" && item.minor >= SMALL_CHARGE_MINOR).sort(byAmountThenName);
  const small = counted.filter((item) => item.direction === "expense" && item.minor < SMALL_CHARGE_MINOR).sort(byAmountThenName);
  const sum = (list: readonly ForecastItem[]) => list.reduce((total, item) => total + item.minor, 0n);

  return {
    items,
    income,
    expense,
    moved,
    small,
    incomeTotal: sum(income),
    expenseTotal: sum([...expense, ...small]),
    changed: items.filter((item) => item.overridden).length,
  };
}

/** Home's number: the cash net today, plus the income still to come, minus the charges still to go. */
export function forecastTotal(netMinor: bigint, build: Pick<ForecastBuild, "incomeTotal" | "expenseTotal">): bigint {
  return netMinor + build.incomeTotal - build.expenseTotal;
}
