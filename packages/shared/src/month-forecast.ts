import type { UnpaidRow } from "./dashboard.ts";
import type { ExpectedMonths } from "./forecast.ts";
import { dueInMonth } from "./recurring-due.ts";

/**
 * FLOW-141: the month-end forecast (צפי). One pure builder for the app and the MCP read, so the
 * items, the sections and the totals come from the same arithmetic. Inputs are the server's
 * reads (expected_months, list_unpaid, forecast_overrides_for); nothing here reads the network.
 *
 * Items: the recurring parties due this month and not yet seen (income and expense), and the open
 * customer invoices (income). A charge every 2 months, quarter or year is due only in its cycle's
 * months (dueInMonth, the rule the expected_months cells follow; decision 0199); a late one still
 * counts. A row's own number is never changed; an override only changes the forecast (its amount,
 * its day, or "not this month", which moves it out of the totals).
 *
 * FLOW-1005 (decision 0240): the owner's project forecast edits for the month count too, as each project's
 * צפי page counts them (`company_forecast_edits_for`). A line they added is an item until its bank line
 * comes; a recurring charge they removed leaves the forecast; a changed amount is the item's own number. A
 * charge with no project takes the overhead project's edits. The category averages stay the project pages'.
 */

/** One override as the server sends it (amounts are JSON numbers, whole agorot). */
export type ForecastOverrideRow = {
  item_key: string;
  amount_minor: number | null;
  due_on: string | null;
  moved_out: boolean;
};

/** One project forecast edit that applies to the month, as company_forecast_edits_for sends it. */
export type MonthForecastEdit = {
  id: string;
  project_id: string;
  kind: "change" | "remove" | "add";
  /** `rec:<direction>:<party id>` for a recurring charge, `add:<edit id>` for an added line; null on an add. */
  row_key: string | null;
  category_id: string | null;
  category_name?: string | null;
  direction: "income" | "expense" | null;
  amount_minor: number | null;
  /** once, month, 2months, quarter or year (FLOW-1010: an added line's pace shows on its page). */
  pace?: string | null;
  start_month: string;
  /** An added line: the bank line that came as it this month, or null. */
  matched_transaction_id?: string | null;
};

export type ForecastItem = {
  /**
   * `party:<direction>:<party id>:<currency>` for a recurring party (`:<project id>` added when the party is
   * split by project, decision 0185), `invoice:<id>` for an invoice, `added:<edit id>` for a line the owner
   * added to a project's forecast (FLOW-1005).
   */
  key: string;
  direction: "income" | "expense";
  kind: "recurring" | "invoice" | "added";
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
  /** The category it files to (the recurring charge's usual one, the invoice's own), or null. */
  category_id: string | null;
  /** A recurring charge's project (decision 0185), or null. An invoice names its project instead. */
  project_id: string | null;
  /** An invoice's project, as the open-invoices list names it, or null. */
  project_name: string | null;
  /**
   * FLOW-1010: how often it repeats. A recurring charge's pace (month, 2months, quarter, year); an added line's
   * (once too); null for an invoice.
   */
  pace: string | null;
  /** FLOW-1010: an added line's first month (YYYY-MM): in that month its page can change its pace. Null otherwise. */
  line_start: string | null;
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
  /** FLOW-1005: the project forecast edits that apply to the month, and the project the general charges' edits are on. */
  edits?: readonly MonthForecastEdit[];
  overheadProjectId?: string | null;
  /** Sample data only: when set, dates are expected (usual day, or document date plus these days) and late items are marked. */
  paymentTermsDays?: number;
}): ForecastBuild {
  const overrides = new Map(input.overrides.map((row) => [row.item_key, row] as const));
  const terms = input.paymentTermsDays ?? null;
  const today = terms == null ? null : input.expected?.today ?? null;
  const raw: Omit<ForecastItem, "minor" | "due_on" | "moved_out" | "overridden" | "late_days">[] = [];

  // A party split by project (decision 0185) is one item per project; a party with one charge keeps its key,
  // so the overrides saved for it still apply.
  const charges = new Map<string, number>();
  for (const party of input.expected?.recurring ?? []) {
    const base = `party:${party.direction}:${party.party_id}:${party.currency}`;
    charges.set(base, (charges.get(base) ?? 0) + 1);
  }
  const thisMonth = input.expected?.today.slice(0, 7) ?? "";
  // FLOW-1005: each row's edits by `<project>|<row key>`; the latest change of a row wins, as on the project page.
  const overhead = input.overheadProjectId ?? null;
  const removed = new Set<string>();
  const changes = new Map<string, MonthForecastEdit>();
  for (const edit of input.edits ?? []) {
    if (edit.row_key == null) continue;
    const at = `${edit.project_id}|${edit.row_key}`;
    if (edit.kind === "remove") removed.add(at);
    if (edit.kind !== "change" || edit.amount_minor == null) continue;
    const held = changes.get(at);
    if (held == null || held.start_month < edit.start_month) changes.set(at, edit);
  }
  for (const party of input.expected?.recurring ?? []) {
    if (party.seen_this_month || party.currency !== input.base) continue;
    if (!dueInMonth(party.next_due_month, party.pace, thisMonth, thisMonth)) continue;
    const owner = party.project_id ?? overhead;
    const at = owner == null ? null : `${owner}|rec:${party.direction}:${party.party_id}`;
    if (at != null && removed.has(at)) continue;
    const changed = at == null ? null : changes.get(at)?.amount_minor ?? null;
    const base = `party:${party.direction}:${party.party_id}:${party.currency}`;
    raw.push({
      key: (charges.get(base) ?? 0) > 1 ? `${base}:${party.project_id ?? "none"}` : base,
      direction: party.direction,
      kind: "recurring",
      name: party.name === "" ? "ללא שם" : party.name,
      currency: party.currency,
      usual: changed == null ? abs(party.typical_amount_minor) : BigInt(changed),
      day: party.typical_day > 0 ? party.typical_day : null,
      description: null,
      category_id: party.category_id ?? null,
      project_id: party.project_id ?? null,
      project_name: null,
      pace: party.pace ?? "month",
      line_start: null,
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
      category_id: row.category_id ?? null,
      project_id: null,
      project_name: row.project_name,
      pace: null,
      line_start: null,
      expected_on: terms != null ? addDays(row.doc_date, terms) : null,
    });
  }

  // FLOW-1005: the lines the owner added to a project's forecast, in the company's currency (a project's lines
  // are), until the bank line that came as one is in; one they took out again, or matched, is not expected.
  for (const edit of input.edits ?? []) {
    if (edit.kind !== "add" || edit.amount_minor == null || edit.direction == null) continue;
    if (edit.matched_transaction_id != null) continue;
    const at = `${edit.project_id}|add:${edit.id}`;
    if (removed.has(at)) continue;
    const changed = changes.get(at)?.amount_minor ?? null;
    const usual = BigInt(changed ?? edit.amount_minor);
    if (usual === 0n) continue;
    raw.push({
      key: `added:${edit.id}`,
      direction: edit.direction,
      kind: "added",
      name: edit.category_name != null && edit.category_name !== "" ? edit.category_name : "ללא שם",
      currency: input.base,
      usual,
      day: null,
      description: null,
      category_id: edit.category_id,
      project_id: edit.project_id,
      project_name: null,
      pace: edit.pace ?? "once",
      line_start: edit.start_month,
      expected_on: null,
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

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * company_forecast_edits_for's answer, checked by hand (no zod: Home reads this forecast before it paints, and the MCP builds it too).
 * An edit that does not have the shape is left out, and a body with no edits list reads as none, so the month's
 * own items always show; a failed read still fails the forecast.
 */
export function parseMonthEdits(data: unknown): { overheadProjectId: string | null; edits: MonthForecastEdit[] } {
  const body = data as { overhead_project_id?: unknown; edits?: unknown } | null;
  if (body == null || typeof body !== "object" || !Array.isArray(body.edits)) return { overheadProjectId: null, edits: [] };
  const edits = (body.edits as unknown[]).flatMap((value): MonthForecastEdit[] => {
    const row = value as Record<string, unknown> | null;
    if (row == null || typeof row !== "object") return [];
    const id = text(row.id);
    const project = text(row.project_id);
    const kind = row.kind;
    const start = text(row.start_month);
    const direction = row.direction === "income" || row.direction === "expense" ? row.direction : null;
    const amount = typeof row.amount_minor === "number" && Number.isSafeInteger(row.amount_minor) ? row.amount_minor : null;
    if (id == null || project == null || start == null || (kind !== "change" && kind !== "remove" && kind !== "add")) return [];
    return [{
      id,
      project_id: project,
      kind,
      row_key: text(row.row_key),
      category_id: text(row.category_id),
      category_name: text(row.category_name),
      direction,
      amount_minor: amount,
      pace: text(row.pace),
      start_month: start,
      matched_transaction_id: text(row.matched_transaction_id),
    }];
  });
  return { overheadProjectId: text(body.overhead_project_id), edits };
}

/** Home's number: the cash net today, plus the income still to come, minus the charges still to go. */
export function forecastTotal(netMinor: bigint, build: Pick<ForecastBuild, "incomeTotal" | "expenseTotal">): bigint {
  return netMinor + build.incomeTotal - build.expenseTotal;
}
