import type { ForecastOverrideRow } from "@flow/shared";
import { countOf, factsOf, isRow, minorOf, orderRows, rowsIn, shapeError, textOf } from "./company-forecast-map";
import type { IncomeFacts } from "./next-month-chart";
import type { ChargeHint } from "./project-next-edit";
import type { NextMonthForecast } from "./project-next-month";

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

/** A list, or the read fails. */
function listOf(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw shapeError();
  return value;
}

function neededText(row: Record<string, unknown>, field: string): string {
  const value = textOf(row, field);
  if (value == null) throw shapeError();
  return value;
}

/** An amount as a plain number (the history's months, the overrides'), for the places that hold numbers. */
const safeNumber = (value: unknown): number => Number(minorOf(value));

/** A recurring charge's pace (expected_months' own): every month when it names none, never `once`. */
function chargePaceOf(value: unknown): NonNullable<ChargeHint["pace"]> {
  if (value == null) return "month";
  if (value !== "month" && value !== "2months" && value !== "quarter" && value !== "year") throw shapeError();
  return value;
}

function overrideOf(value: unknown): ForecastOverrideRow {
  if (!isRow(value)) throw shapeError();
  return {
    item_key: neededText(value, "item_key"),
    amount_minor: value.amount_minor == null ? null : safeNumber(value.amount_minor),
    due_on: textOf(value, "due_on"),
    moved_out: value.moved_out === true,
  };
}

function historyOf(value: unknown): ProjectForecastRead["history"] {
  if (!isRow(value)) throw shapeError();
  return {
    months: listOf(value.months).map((month) => {
      if (typeof month !== "string") throw shapeError();
      return month;
    }),
    categories: listOf(value.categories).map((category) => {
      if (!isRow(category)) throw shapeError();
      // A category with no id is the uncategorized row: the id is absent in the answer, null in the page's own history.
      return { id: textOf(category, "id"), currency: neededText(category, "currency"), months_minor: listOf(category.months_minor).map(safeNumber) };
    }),
  };
}

/**
 * The charges the edit page's hints read, as the page took them from expected_months: the project's own (a loan's payment aside) in
 * the forecast's currency, each with its category, its usual amount (positive) and its pace.
 */
function chargesOf(value: unknown, projectId: string, currency: string): ChargeHint[] {
  return listOf(value).map((charge) => {
    if (!isRow(charge)) throw shapeError();
    return { project_id: projectId, pays_loan: false, currency, category_id: neededText(charge, "category_id"), typical_amount_minor: minorOf(charge.amount_minor), pace: chargePaceOf(charge.pace) };
  });
}

/**
 * project_forecast's answer as the pages read it. `projectId` is the project asked (the answer does not repeat it). A null
 * answer (no company, or another company's project) is no forecast; a malformed one, an amount outside 2^53 - 1 or rows that do
 * not add up to the totals throw, so the read fails and the page shows its failed state with retry.
 */
export function projectForecastOf(answer: unknown, projectId: string): ProjectForecastRead | null {
  if (answer == null) return null;
  if (!isRow(answer)) throw shapeError();
  const month = neededText(answer, "month");
  const currency = neededText(answer, "currency");
  const rows = orderRows(rowsIn(answer.rows));
  const incomeMinor = minorOf(answer.income_minor);
  const expenseMinor = minorOf(answer.expense_minor);
  // The totals are the rows' (a tap's patch counts them again from the rows): an answer whose rows do not add up is no answer.
  const sum = (side: 1n | -1n) => rows.reduce((total, row) => (row.minor * side > 0n ? total + row.minor * side : total), 0n);
  if (sum(1n) !== incomeMinor || sum(-1n) !== expenseMinor) throw shapeError();
  return {
    today: neededText(answer, "today"),
    month,
    currency,
    general: answer.general === true,
    forecast: {
      month,
      rows,
      incomeMinor,
      expenseMinor,
      netMinor: minorOf(answer.net_minor),
      loanCount: countOf(answer.loan_count),
      averageMonths: countOf(answer.average_months),
      // The loans' cash by loan and the arrived added lines are in no row and no screen reads them (cashOnlyMinor is the sum). The
      // cash figures the pages lead with are cashForecast of this (cash_expense_minor and cash_net_minor are not read; the vectors hold them equal).
      loanCash: [],
      cashOnlyMinor: minorOf(answer.cash_only_minor),
      removed: orderRows(rowsIn(answer.removed)),
      skipped: orderRows(rowsIn(answer.skipped)),
      arrived: [],
    },
    income: factsOf(answer.income),
    edited: answer.edited === true,
    cashPending: false,
    overrides: listOf(answer.overrides).map(overrideOf),
    history: historyOf(answer.history),
    charges: chargesOf(answer.charges, projectId, currency),
  };
}
