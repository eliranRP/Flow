import type { ForecastOverrideRow } from "@flow/shared";
import type { IncomeFacts } from "./next-month-chart";
import type { ChargeHint } from "./project-next-edit";
import type { ForecastPace, NextMonthForecast, NextMonthRow } from "./project-next-month";

/**
 * FLOW-1315 (plan FLOW-1275, slice 9): public.project_forecast's answer (FLOW-1309) turned back into what the project page's
 * card, its צפי page and its edit page drew from the TypeScript builders (nextMonthForecast, applyForecastEdits, skipEdits,
 * cashForecast and the edit page's history and category hints), pure. The database gives the figures; this file gives them
 * their shape (bigint amounts, null for what is absent) and keeps each list in the builders' order. project-forecast-map.test.ts
 * holds the two equal for the shared vectors (packages/shared/fixtures/vectors/project-forecast).
 */

/** What the three pages read of one project's month. */
export type ProjectForecastRead = {
  /** yyyy-mm-dd, the day the forecast is from. */
  today: string;
  /** yyyy-mm */
  month: string;
  currency: string;
  /** The company's overhead project's page: the general costs (FLOW-1002). */
  general: boolean;
  /** The rows, the totals in profit terms (cashForecast adds the loans' cash), the rows taken out and those only a skip took out. */
  forecast: NextMonthForecast;
  /** What the card's income note reads of the rows. */
  income: IncomeFacts;
  /** An edit of the project starts in this month: the צפי page's reset button. */
  edited: boolean;
  /**
   * The loans' cash (`forecast.cashOnlyMinor`) is not known after a tap: removing a loan's row can take its principal out, and
   * the answer holds no cash by loan. The cash figures wait for the read after the write. Always false in an answer.
   */
  cashPending: boolean;
  /** forecast_overrides_for the month: what the skip (לא החודש) and its restore read. */
  overrides: ForecastOverrideRow[];
  /** The six months before this one and the project's expense months by category, for the edit page's history bars. */
  history: { months: string[]; categories: Array<{ id: string | null; currency: string; months_minor: number[] }> };
  /** The project's charges that file to a category, for the edit page's hints. */
  charges: ChargeHint[];
};

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);

function shapeError(what: string): Error {
  return new Error(`project_forecast: ${what}`);
}

/** An amount as a JSON number in minor units (a digit string too), refused when it is not a safe integer; to the app's bigint. */
function minorOf(value: unknown, what: string): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const amount = BigInt(value);
    if (amount <= BigInt(Number.MAX_SAFE_INTEGER) && amount >= -BigInt(Number.MAX_SAFE_INTEGER)) return amount;
  }
  throw shapeError(`${what} is not a safe whole amount`);
}

/** The same as a plain number (the history's months, the overrides' amounts), for the places that hold numbers. */
function safeNumber(value: unknown, what: string): number {
  return Number(minorOf(value, what));
}

function countOf(value: unknown, what: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  throw shapeError(`${what} is not a count`);
}

function textOf(row: Row, field: string): string | null {
  const value = row[field];
  return typeof value === "string" ? value : null;
}

function neededText(row: Row, field: string, what: string): string {
  const value = textOf(row, field);
  if (value == null) throw shapeError(`${what} has no ${field}`);
  return value;
}

function listOf(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw shapeError(`${what} is not a list`);
  return value;
}

const KINDS = new Set<string>(["recurring", "loan", "average", "added"]);
const PACES = new Set<string>(["once", "month", "2months", "quarter", "year"]);

function paceOf(value: unknown, what: string): ForecastPace | null {
  if (value == null) return null;
  if (typeof value !== "string" || !PACES.has(value)) throw shapeError(`${what} pace is not one`);
  return value as ForecastPace;
}

/** A recurring charge's pace: every month when it names none (expected_months' own, so never `once`). */
function chargePaceOf(value: unknown): NonNullable<ChargeHint["pace"]> {
  const pace = paceOf(value, "a charge's");
  if (pace === "once") throw shapeError("a charge's pace is not one");
  return pace ?? "month";
}

function rowOf(value: unknown): NextMonthRow {
  if (!isRow(value)) throw shapeError("a row is not an object");
  const key = textOf(value, "key");
  const { kind, direction } = value;
  if (key == null || typeof kind !== "string" || !KINDS.has(kind) || (direction !== "income" && direction !== "expense")) throw shapeError("a row has no key, kind or direction");
  return {
    key,
    kind: kind as NextMonthRow["kind"],
    direction,
    name: textOf(value, "name") ?? "",
    date: textOf(value, "date"),
    minor: minorOf(value.minor, "a row's amount"),
    categoryId: textOf(value, "category_id"),
    wasMinor: value.was_minor == null ? null : minorOf(value.was_minor, "a row's was_minor"),
    pace: paceOf(value.pace, "a row's"),
  };
}

/** The amount a row sorted by in the builder: Flow's number, before the user's change (an edited row keeps its place). */
const sortMinor = (row: NextMonthRow): bigint => row.wasMinor ?? row.minor;

/** The biggest cost first, then by name (the builder's byAmount). */
function byAmount(a: NextMonthRow, b: NextMonthRow): number {
  return sortMinor(a) === sortMinor(b) ? a.name.localeCompare(b.name, "he") : sortMinor(a) < sortMinor(b) ? -1 : 1;
}

/** The recurring ones by expected day, then by name (the builder's). */
function byDay(a: NextMonthRow, b: NextMonthRow): number {
  return (a.date ?? "") === (b.date ?? "") ? a.name.localeCompare(b.name, "he") : (a.date ?? "") < (b.date ?? "") ? -1 : 1;
}

/**
 * A list of rows in the builder's order: the recurring rows by day, the loan rows, the averages (each by the amount Flow had,
 * before a change, and name in Hebrew order), then the lines the user added in the order given (the edits'). The database
 * lists them so already; the sort is stable, so rows it holds equal keep its order, and a Hebrew order the database's
 * collation and this phone's differ on is the phone's, as the builder drew it.
 */
export function orderRows(rows: readonly NextMonthRow[]): NextMonthRow[] {
  const of = (kind: NextMonthRow["kind"]) => rows.filter((row) => row.kind === kind);
  return [...of("recurring").sort(byDay), ...of("loan").sort(byAmount), ...of("average").sort(byAmount), ...of("added")];
}

function rowsIn(value: unknown, what: string): NextMonthRow[] {
  return orderRows(listOf(value, what).map(rowOf));
}

function factsOf(value: unknown): IncomeFacts {
  if (!isRow(value)) throw shapeError("the income note is not an object");
  return { rows: countOf(value.rows, "the income rows"), recurring: countOf(value.recurring, "the recurring income"), rent: countOf(value.rent, "the rent"), name: textOf(value, "name") };
}

function overrideOf(value: unknown): ForecastOverrideRow {
  if (!isRow(value)) throw shapeError("an override is not an object");
  return {
    item_key: neededText(value, "item_key", "an override"),
    amount_minor: value.amount_minor == null ? null : safeNumber(value.amount_minor, "an override's amount"),
    due_on: textOf(value, "due_on"),
    moved_out: value.moved_out === true,
  };
}

function historyOf(value: unknown): ProjectForecastRead["history"] {
  if (!isRow(value)) throw shapeError("the history is not an object");
  return {
    months: listOf(value.months, "the history's months").map((month) => {
      if (typeof month !== "string") throw shapeError("a history month is not a date");
      return month;
    }),
    categories: listOf(value.categories, "the history's categories").map((category) => {
      if (!isRow(category)) throw shapeError("a history category is not an object");
      // A category with no id is the uncategorized row: the id is absent in the answer, null in the page's own history.
      return {
        id: textOf(category, "id"),
        currency: neededText(category, "currency", "a history category"),
        months_minor: listOf(category.months_minor, "a history category's months").map((minor) => safeNumber(minor, "a history amount")),
      };
    }),
  };
}

/**
 * The charges the edit page's hints read, as the page took them from expected_months: the project's own (so the project, a
 * loan's payment aside) in the forecast's currency, each with its category, its usual amount (positive) and its pace.
 */
function chargesOf(value: unknown, projectId: string, currency: string): ChargeHint[] {
  return listOf(value, "the charges").map((charge) => {
    if (!isRow(charge)) throw shapeError("a charge is not an object");
    return {
      project_id: projectId,
      pays_loan: false,
      currency,
      category_id: neededText(charge, "category_id", "a charge"),
      typical_amount_minor: minorOf(charge.amount_minor, "a charge's amount"),
      pace: chargePaceOf(charge.pace),
    };
  });
}

/**
 * project_forecast's answer as the pages read it. `projectId` is the project asked (the answer does not repeat it). A null
 * answer (no company, or another company's project) is no forecast; a malformed one, or an amount outside 2^53 - 1, throws, so
 * the read fails and the page shows its failed state with retry.
 */
export function projectForecastOf(answer: unknown, projectId: string): ProjectForecastRead | null {
  if (answer == null) return null;
  if (!isRow(answer)) throw shapeError("the answer is not an object");
  const month = neededText(answer, "month", "the answer");
  const currency = neededText(answer, "currency", "the answer");
  const rows = rowsIn(answer.rows, "the rows");
  const removed = rowsIn(answer.removed, "the removed rows");
  const skipped = rowsIn(answer.skipped, "the skipped rows");
  // The cash figures the card and the page lead with are cashForecast of these (the expense plus the loans' cash, the net less
  // it), so cash_expense_minor and cash_net_minor are not read; the vectors hold them equal.
  const cashOnlyMinor = minorOf(answer.cash_only_minor, "the cash only");
  const incomeMinor = minorOf(answer.income_minor, "the income");
  const expenseMinor = minorOf(answer.expense_minor, "the expense");
  // The totals are the rows' (a tap's patch counts them again from the rows): an answer whose rows do not add up is no answer.
  const sum = (side: 1n | -1n) => rows.reduce((total, row) => (row.minor * side > 0n ? total + row.minor * side : total), 0n);
  if (sum(1n) !== incomeMinor || sum(-1n) !== expenseMinor) throw shapeError("the rows do not add up to the totals");
  return {
    today: neededText(answer, "today", "the answer"),
    month,
    currency,
    general: answer.general === true,
    forecast: {
      month,
      rows,
      incomeMinor,
      expenseMinor,
      netMinor: minorOf(answer.net_minor, "the net"),
      loanCount: countOf(answer.loan_count, "the loan count"),
      averageMonths: countOf(answer.average_months, "the average months"),
      // The loans' cash by loan and the arrived added lines are in no row and no screen reads them (cashOnlyMinor is the sum).
      loanCash: [],
      cashOnlyMinor,
      removed,
      skipped,
      arrived: [],
    },
    income: factsOf(answer.income),
    edited: answer.edited === true,
    cashPending: false,
    overrides: listOf(answer.overrides, "the overrides").map(overrideOf),
    history: historyOf(answer.history),
    charges: chargesOf(answer.charges, projectId, currency),
  };
}
