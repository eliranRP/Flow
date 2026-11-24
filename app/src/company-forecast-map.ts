import { captionOfCounts, companyForecastCaption, companyIncomeNote, companyIncomeNoteOfFacts, sumCompanyParts, type CompanyForecastPart, type CompanyNextMonth } from "./company-next-month";
import { restIncomeNote, type RestOfYear } from "./company-year-forecast";
import { futureForecastKey } from "./forecast-future-keys";
import type { IncomeFacts, RentCategory } from "./next-month-chart";
import type { ForecastPace, NextMonthForecast, NextMonthRow } from "./project-next-month";

/**
 * FLOW-1308 (plan FLOW-1275, slice 7): public.company_forecast's answer (FLOW-1307) turned back into what the screens
 * drew from the TypeScript builders (companyNextMonthForecast, companyRestOfYear, companyMonthForecast and their notes), pure.
 * The database gives the figures; this file gives them their shape, and sorts the rows as the builders did (the database's
 * order is by key, and Hebrew order differs between ICU and its collation). company-forecast-map.test.ts holds the two equal for
 * the shared vectors.
 */

/** One month's totals, 'totals' and 'rows' both: what the card and the year view read. */
export type ForecastMonthTotals = {
  /** yyyy-mm */
  month: string;
  incomeMinor: bigint;
  expenseMinor: bigint;
  netMinor: bigint;
  /** The loans' cash no row holds: the cash view's expense is `expenseMinor` plus it. */
  cashOnlyMinor: bigint;
  /** The projects with a row, and whether the general costs have one: what the caption reads. */
  projects: number;
  general: boolean;
  income: IncomeFacts;
};

export type CompanyForecastTotals = {
  today: string;
  currency: string;
  months: ForecastMonthTotals[];
  /** The income over every month asked, each stream once (restIncomeNote). */
  income: IncomeFacts;
};

/** The answer of 'rows' (one month): the totals, and the month with its parts, as companyNextMonthForecast builds it, in profit terms. */
export type CompanyForecastRows = CompanyForecastTotals & { forecast: CompanyNextMonth };

type Row = Record<string, unknown>;

export const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);

/** A forecast read (company_forecast, project_forecast) answered in a shape the app does not draw: the read fails. */
export function shapeError(): Error {
  return new Error("forecast: unexpected answer");
}

/** An amount as a JSON number in minor units (a digit string too), refused when it is not a safe integer; to the app's bigint. */
export function minorOf(value: unknown): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const amount = BigInt(value);
    if (amount <= BigInt(Number.MAX_SAFE_INTEGER) && amount >= -BigInt(Number.MAX_SAFE_INTEGER)) return amount;
  }
  throw shapeError();
}

export function countOf(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  throw shapeError();
}

export function textOf(row: Row, field: string): string | null {
  const value = row[field];
  return typeof value === "string" ? value : null;
}

export function factsOf(value: unknown): IncomeFacts {
  if (!isRow(value)) throw shapeError();
  return { rows: countOf(value.rows), recurring: countOf(value.recurring), rent: countOf(value.rent), name: textOf(value, "name") };
}

function monthOf(value: unknown): { totals: ForecastMonthTotals; raw: Row } {
  if (!isRow(value) || typeof value.month !== "string") throw shapeError();
  return {
    raw: value,
    totals: {
      month: value.month,
      incomeMinor: minorOf(value.income_minor),
      expenseMinor: minorOf(value.expense_minor),
      netMinor: minorOf(value.net_minor),
      cashOnlyMinor: minorOf(value.cash_only_minor),
      projects: countOf(value.projects),
      general: value.general === true,
      income: factsOf(value.income),
    },
  };
}

function totalsOf(answer: unknown): { totals: CompanyForecastTotals; raws: Row[]; raw: Row } {
  if (!isRow(answer) || typeof answer.today !== "string" || typeof answer.currency !== "string" || !Array.isArray(answer.months)) throw shapeError();
  const months = answer.months.map(monthOf);
  return { totals: { today: answer.today, currency: answer.currency, months: months.map((month) => month.totals), income: factsOf(answer.income) }, raws: months.map((month) => month.raw), raw: answer };
}

/** company_forecast with 'totals': each month's totals, as the card and the year view read them. */
export function forecastTotalsOf(answer: unknown): CompanyForecastTotals {
  return totalsOf(answer).totals;
}

const KINDS = new Set(["recurring", "loan", "average", "added"]);
const PACES = new Set(["once", "month", "2months", "quarter", "year"]);

/** A row: a kind outside the four or a pace that is not one fails the read (a row of a kind the app does not know would drop out of the totals). */
export function rowOf(value: unknown): NextMonthRow {
  if (!isRow(value)) throw shapeError();
  const key = textOf(value, "key");
  const { kind, direction, pace } = value;
  if (key == null || typeof kind !== "string" || !KINDS.has(kind) || (direction !== "income" && direction !== "expense")) throw shapeError();
  if (pace != null && (typeof pace !== "string" || !PACES.has(pace))) throw shapeError();
  return {
    key,
    kind: kind as NextMonthRow["kind"],
    direction,
    name: textOf(value, "name") ?? "",
    date: textOf(value, "date"),
    minor: minorOf(value.minor),
    categoryId: textOf(value, "category_id"),
    wasMinor: value.was_minor == null ? null : minorOf(value.was_minor),
    pace: (pace ?? null) as ForecastPace | null,
  };
}

export function rowsIn(value: unknown): NextMonthRow[] {
  if (!Array.isArray(value)) throw shapeError();
  return value.map(rowOf);
}

/** The amount a row sorted by in the builder: Flow's number, before the user's change. */
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
 * A part's list in the builder's order: the recurring rows by day, the loan rows, the averages (each by amount as Flow
 * had it, before a change, and name in Hebrew order), then the lines the user added in the order given (the edits').
 * The rows and the rows taken out (skipped) are built from one list in this order, so each is.
 */
export function orderRows(rows: readonly NextMonthRow[]): NextMonthRow[] {
  const of = (kind: NextMonthRow["kind"]) => rows.filter((row) => row.kind === kind);
  return [...of("recurring").sort(byDay), ...of("loan").sort(byAmount), ...of("average").sort(byAmount), ...of("added")];
}

/** A part's forecast from its rows: the totals are the rows' (withTotals), as the builder counts them. */
function partForecast(month: string, parts: { rows: NextMonthRow[]; skipped: NextMonthRow[]; averageMonths: number; cashOnlyMinor: bigint }): NextMonthForecast {
  const { rows } = parts;
  const incomeMinor = rows.reduce((sum, row) => (row.minor > 0n ? sum + row.minor : sum), 0n);
  const expenseMinor = rows.reduce((sum, row) => (row.minor < 0n ? sum - row.minor : sum), 0n);
  return {
    month,
    rows,
    incomeMinor,
    expenseMinor,
    netMinor: incomeMinor - expenseMinor,
    loanCount: 0,
    averageMonths: parts.averageMonths,
    loanCash: [],
    cashOnlyMinor: parts.cashOnlyMinor,
    removed: [],
    skipped: parts.skipped,
    arrived: [],
  };
}

const skippedKeys = (forecast: NextMonthForecast): string[] => (forecast.skipped ?? []).map((row) => row.key);

function partOf(forecast: NextMonthForecast, projectId: string | null): CompanyForecastPart {
  return { projectId, forecast, skipped: skippedKeys(forecast) };
}

/** A part with nothing expected: where a row only a skip took out is listed (or comes back to). */
function emptyPart(month: string, projectId: string | null, skipped: NextMonthRow[]): CompanyForecastPart {
  return partOf(partForecast(month, { rows: [], skipped, averageMonths: 1, cashOnlyMinor: 0n }), projectId);
}

/** The projects by id, the general costs last (the builder's order). */
function inPartOrder(parts: readonly CompanyForecastPart[]): CompanyForecastPart[] {
  const projects = parts.filter((part) => part.projectId != null).sort((a, b) => ((a.projectId ?? "") < (b.projectId ?? "") ? -1 : (a.projectId ?? "") > (b.projectId ?? "") ? 1 : 0));
  return [...projects, ...parts.filter((part) => part.projectId == null)];
}

/**
 * company_forecast with 'rows' (one month): the month as companyNextMonthForecast builds it, in profit terms: the parts
 * with a row, the rows taken out, the split party keys. The general costs' part comes listed even with no row (so the
 * overhead project's page has its removed rows); it is dropped here, as the builder's sum drops it, so it counts in no
 * total, no caption and no per-part cash (sumCompanyParts keeps the parts with a row).
 */
export function forecastRowsOf(answer: unknown): CompanyForecastRows {
  const { totals, raws, raw } = totalsOf(answer);
  const [month] = totals.months;
  const [monthRaw] = raws;
  if (totals.months.length !== 1 || month == null || monthRaw == null) throw shapeError();
  if (!Array.isArray(monthRaw.parts) || !Array.isArray(monthRaw.skipped) || !Array.isArray(raw.split_keys) || !raw.split_keys.every((key) => typeof key === "string")) throw shapeError();
  const skipped = new Map<string | null, NextMonthRow[]>();
  for (const item of monthRaw.skipped) {
    if (!isRow(item)) throw shapeError();
    const projectId = textOf(item, "project_id");
    skipped.set(projectId, [...(skipped.get(projectId) ?? []), rowOf(item)]);
  }
  const parts: CompanyForecastPart[] = monthRaw.parts.map((item): CompanyForecastPart => {
    if (!isRow(item)) throw shapeError();
    const projectId = textOf(item, "project_id");
    const average = item.average_months;
    if (typeof average !== "number" || !Number.isInteger(average) || average < 1) throw shapeError();
    const own = skipped.get(projectId) ?? [];
    skipped.delete(projectId);
    return partOf(partForecast(month.month, {
      rows: orderRows(rowsIn(item.rows)),
      skipped: orderRows(own),
      averageMonths: average,
      cashOnlyMinor: minorOf(item.cash_only_minor),
    }), projectId);
  });
  // A project with nothing expected still lists what a skip took out of it (the builder lists every project's).
  for (const [projectId, rows] of skipped) parts.push(emptyPart(month.month, projectId, orderRows(rows)));
  const forecast = sumCompanyParts(month.month, inPartOrder(parts), new Set(raw.split_keys));
  // The parts' rows must add up to the database's month: a row of a kind the app does not know would drop out of a total.
  if (forecast.incomeMinor !== month.incomeMinor || forecast.expenseMinor !== month.expenseMinor || forecast.netMinor !== month.netMinor) throw shapeError();
  return { ...totals, forecast };
}

/**
 * The month with this page's own answers drawn at once (FLOW-1096, FLOW-1079): a recurring row whose forecast key is in
 * `skips` moves from its part to the rows taken out, and one listed there whose key is not comes back to its part. The
 * database builds the same month from the saved overrides, so once a read lands the two agree. Returns `forecast` itself
 * when nothing moves.
 */
export function withSkips(forecast: CompanyNextMonth, skips: ReadonlySet<string>, currency: string): CompanyNextMonth {
  const keyOf = futureForecastKey(forecast, currency);
  const isOut = (row: NextMonthRow, projectId: string | null): boolean => {
    const key = keyOf(row.key, projectId);
    return key != null && skips.has(key);
  };
  // Every part that holds a row or a row taken out, a part with only the latter included.
  const held = new Map<string | null, CompanyForecastPart>(forecast.parts.map((part) => [part.projectId, part]));
  for (const { projectId } of forecast.skipped) {
    if (!held.has(projectId)) held.set(projectId, emptyPart(forecast.month, projectId, forecast.skipped.filter((item) => item.projectId === projectId).map((item) => item.row)));
  }
  const before = [...held.values()];
  const parts = before.map((part): CompanyForecastPart => {
    const { forecast: own } = part;
    const taking = own.rows.filter((row) => isOut(row, part.projectId));
    const back = (own.skipped ?? []).filter((row) => !isOut(row, part.projectId));
    if (taking.length === 0 && back.length === 0) return part;
    return partOf(partForecast(own.month, {
      rows: orderRows([...own.rows.filter((row) => !taking.includes(row)), ...back]),
      skipped: orderRows([...(own.skipped ?? []).filter((row) => !back.includes(row)), ...taking]),
      averageMonths: own.averageMonths,
      cashOnlyMinor: own.cashOnlyMinor,
    }), part.projectId);
  });
  return parts.some((part, index) => part !== before[index]) ? sumCompanyParts(forecast.month, inPartOrder(parts), forecast.splitKeys) : forecast;
}

/** What Profit's next-month card draws: the month's totals and its two notes (its caption and its income note). */
export type NextMonthCard = {
  month: string;
  incomeMinor: bigint;
  expenseMinor: bigint;
  /** No part has a row: nothing is expected, and the card hides. */
  empty: boolean;
  caption: string;
  incomeNote: string;
};

export function cardOfTotals(month: ForecastMonthTotals): NextMonthCard {
  return {
    month: month.month,
    incomeMinor: month.incomeMinor,
    expenseMinor: month.expenseMinor,
    empty: month.projects === 0 && !month.general,
    caption: captionOfCounts(month.projects, month.general),
    incomeNote: companyIncomeNoteOfFacts(month.income),
  };
}

/** The card the TypeScript builder's month gives (a sample, a story): the same value from the same facts. */
export function cardOfForecast(forecast: CompanyNextMonth, categories: readonly RentCategory[]): NextMonthCard {
  return { month: forecast.month, incomeMinor: forecast.incomeMinor, expenseMinor: forecast.expenseMinor, empty: forecast.rows.length === 0, caption: companyForecastCaption(forecast), incomeNote: companyIncomeNote(forecast, categories) };
}

/** The months left in the year, summed: what the year view's card draws (RestOfYear without the forecasts it was built from). */
export type RestOfYearTotals = Omit<RestOfYear, "forecasts"> & {
  /** Every month's parts have no row: nothing is expected, and the card hides. */
  empty: boolean;
  incomeNote: string;
};

/** The year view's card from company_forecast's 'totals' for the months left in this year (none left in December: null). */
export function restOfTotals(today: string, months: readonly ForecastMonthTotals[], income: IncomeFacts): RestOfYearTotals | null {
  if (months.length === 0) return null;
  const incomeMinor = months.reduce((sum, month) => sum + month.incomeMinor, 0n);
  const expenseMinor = months.reduce((sum, month) => sum + month.expenseMinor, 0n);
  return {
    year: today.slice(0, 4),
    months: months.map((month) => ({ month: month.month, incomeMinor: month.incomeMinor, expenseMinor: month.expenseMinor })),
    incomeMinor,
    expenseMinor,
    netMinor: incomeMinor - expenseMinor,
    empty: months.every((month) => month.projects === 0 && !month.general),
    incomeNote: companyIncomeNoteOfFacts(income),
  };
}

/** The same from the TypeScript builder's rest of the year (a sample, a story). */
export function restOfForecast(rest: RestOfYear, categories: readonly RentCategory[]): RestOfYearTotals {
  const { forecasts, ...totals } = rest;
  return { ...totals, empty: forecasts.every((forecast) => forecast.rows.length === 0), incomeNote: restIncomeNote(rest, categories) };
}
