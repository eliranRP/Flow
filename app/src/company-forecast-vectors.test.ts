import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ExpectedParty, LoanKind, LoanStatus } from "@flow/shared";
import { companyNextMonthForecast, splitPartyKeys, type CompanyNextMonth, type CompanyNextMonthInputs } from "./company-next-month";
import { companyMonthInput } from "./company-year-forecast";
import { isRent, type RentCategory } from "./next-month-chart";
import { type ForecastCategory, type ForecastLoan, newPaymentsLeftMemo } from "./project-next-loans";
import type { NextMonthRow } from "./project-next-month";

/**
 * FLOW-1307: the shared company-forecast vectors (packages/shared/fixtures/vectors/company-forecast, format in its
 * README) run through the app's own builders: companyNextMonthForecast for each month asked, with each month's edits
 * (companyMonthInput) and skips, one payments-left memo for the read (FLOW-1304). The database core
 * private.company_forecast_build runs the same files (supabase/tests/database/vectors_company_forecast.test.sql), so
 * Profit, Home's future months and the company forecast pages read the same figures from either. The builders live in
 * the app, so the test does too (packages/shared cannot import them).
 */
const dir = join(dirname(fileURLToPath(import.meta.url)), "../../packages/shared/fixtures/vectors/company-forecast");

type JsonLoan = {
  id: string;
  currency: string;
  projectId: string | null;
  status: LoanStatus;
  balanceMinor: number;
  categoryIds: { interest: string | null; escrow: string | null };
  principalMinor: number;
  annualRatePpm: number;
  termMonths: number | null;
  startDate: string;
  paymentMinor: number | null;
  escrowMinor: number;
  kind: LoanKind;
  interestOnlyMonths: number | null;
  amortizationMonths: number | null;
  /** Oldest first, as private.loan_schedule takes them. */
  rates: { effectiveDate: string; annualRatePpm: number }[];
};

type JsonParty = Omit<ExpectedParty, "typical_amount_minor"> & { typical_amount_minor: number };

type JsonCategory = ForecastCategory & RentCategory;

type CompanyForecastVectorInput = {
  currency: string;
  today: string;
  /** yyyy-mm, the months to build, in the order asked. */
  months: string[];
  recurring: JsonParty[];
  loans: JsonLoan[];
  categories: JsonCategory[];
  inputs: CompanyNextMonthInputs;
};

type Vector = { name: string; description?: string; input: CompanyForecastVectorInput; expected: unknown };

function load(): Vector[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const text = readFileSync(join(dir, file), "utf8");
      const max = BigInt(Number.MAX_SAFE_INTEGER);
      for (const literal of text.match(/-?\d{16,}/g) ?? []) expect(BigInt(literal) <= max && BigInt(literal) >= -max, `${file}: ${literal} is inside 2^53 - 1`).toBe(true);
      const vector = JSON.parse(text) as Vector;
      expect(file, "the file is named after the vector").toBe(`${vector.name}.json`);
      return vector;
    });
}

/** The JSON loan as the forecast takes it: bigint amounts, the rates newest first (as a LoanDetail holds them). */
function toLoan(json: JsonLoan): ForecastLoan {
  return {
    id: json.id,
    currency: json.currency as ForecastLoan["currency"],
    projectId: json.projectId,
    status: json.status,
    balanceMinor: BigInt(json.balanceMinor),
    categoryIds: { interest: json.categoryIds.interest, escrow: json.categoryIds.escrow, principal: null, fees: null },
    principalMinor: BigInt(json.principalMinor),
    annualRatePpm: json.annualRatePpm,
    termMonths: json.termMonths,
    startDate: json.startDate,
    paymentMinor: json.paymentMinor == null ? null : BigInt(json.paymentMinor),
    escrowMinor: BigInt(json.escrowMinor),
    kind: json.kind,
    interestOnlyMonths: json.interestOnlyMonths,
    amortizationMonths: json.amortizationMonths,
    rates: json.rates.map((rate, index) => ({ id: `rate-${String(index)}`, ...rate })).reverse(),
  };
}

type CompanyRow = CompanyNextMonth["rows"][number];

/** Code-unit order, as the database's collate "C" orders these ASCII keys. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The rows come unsorted from the database: both sides list them by project, key, amount, day and name. */
function byKey(a: { project?: string; row: NextMonthRow }, b: { project?: string; row: NextMonthRow }): number {
  return compare(a.project ?? "", b.project ?? "")
    || compare(a.row.key, b.row.key)
    || (a.row.minor === b.row.minor ? 0 : a.row.minor < b.row.minor ? -1 : 1)
    || compare(a.row.date ?? "", b.row.date ?? "")
    || compare(a.row.name, b.row.name);
}

function rowJson(row: NextMonthRow): Record<string, unknown> {
  return {
    key: row.key,
    kind: row.kind,
    direction: row.direction,
    name: row.name,
    ...(row.date == null ? {} : { date: row.date }),
    minor: Number(row.minor),
    ...(row.categoryId == null ? {} : { category_id: row.categoryId }),
    ...(row.wasMinor == null ? {} : { was_minor: Number(row.wasMinor) }),
    ...(row.pace == null ? {} : { pace: row.pace }),
  };
}

function rowsJson(rows: readonly NextMonthRow[]): Record<string, unknown>[] {
  return rows.map((row) => ({ row })).sort(byKey).map(({ row }) => rowJson(row));
}

/**
 * What the income notes read (companyIncomeNote, restIncomeNote): the income rows, how many are recurring, how many of
 * those are rent, and the row's name when there is one.
 */
function incomeFacts(rows: readonly NextMonthRow[], categories: readonly RentCategory[]): Record<string, unknown> {
  const income = rows.filter((row) => row.minor > 0n);
  const recurring = income.filter((row) => row.kind === "recurring");
  const only = income.length === 1 ? income[0] : undefined;
  return {
    rows: income.length,
    recurring: recurring.length,
    rent: recurring.filter((row) => isRent(row.categoryId, categories)).length,
    ...(only == null ? {} : { name: only.name }),
  };
}

function monthJson(forecast: CompanyNextMonth, categories: readonly RentCategory[]): Record<string, unknown> {
  const cashOnly = forecast.parts.reduce((sum, part) => sum + part.forecast.cashOnlyMinor, 0n);
  return {
    month: forecast.month,
    income_minor: Number(forecast.incomeMinor),
    expense_minor: Number(forecast.expenseMinor),
    net_minor: Number(forecast.netMinor),
    cash_only_minor: Number(cashOnly),
    projects: forecast.parts.filter((part) => part.projectId != null).length,
    general: forecast.parts.some((part) => part.projectId == null),
    income: incomeFacts(forecast.rows, categories),
    parts: forecast.parts.map(({ projectId, forecast: part }) => ({
      ...(projectId == null ? {} : { project_id: projectId }),
      income_minor: Number(part.incomeMinor),
      expense_minor: Number(part.expenseMinor),
      cash_only_minor: Number(part.cashOnlyMinor),
      average_months: part.averageMonths,
      rows: rowsJson(part.rows),
      removed: rowsJson(part.removed),
      arrived: rowsJson(part.arrived),
      loan_cash: [...part.loanCash]
        .sort((a, b) => compare(a.loanId, b.loanId))
        .map((loan) => ({ loan_id: loan.loanId, row_category_ids: loan.rowCategoryIds, minor: Number(loan.minor) })),
    })),
    skipped: forecast.skipped
      .map(({ projectId, row }) => (projectId == null ? { row } : { project: projectId, row }))
      .sort(byKey)
      .map(({ project, row }) => ({ ...(project == null ? {} : { project_id: project }), ...rowJson(row) })),
  };
}

/** What private.company_forecast_build answers for the vector's input, from the app's builders. */
function companyForecastAnswer(input: CompanyForecastVectorInput): unknown {
  const recurring: ExpectedParty[] = input.recurring.map((party) => ({ ...party, typical_amount_minor: BigInt(party.typical_amount_minor) }));
  const read = { currency: input.currency, today: input.today, recurring, loans: input.loans.map(toLoan), categories: input.categories, inputs: input.inputs };
  const payments = newPaymentsLeftMemo();
  const forecasts = input.months.map((month) => companyNextMonthForecast({ ...companyMonthInput(read, month), skips: input.inputs.skips?.[month] ?? [], payments }));
  // restIncomeNote: each stream once, however many months it comes in.
  const streams = new Map<string, CompanyRow>();
  for (const forecast of forecasts) {
    for (const row of forecast.rows) {
      const key = `${row.projectId ?? ""}:${row.key}`;
      if (row.minor > 0n && !streams.has(key)) streams.set(key, row);
    }
  }
  return {
    months: forecasts.map((forecast) => monthJson(forecast, input.categories)),
    income: incomeFacts([...streams.values()], input.categories),
    split_keys: [...splitPartyKeys(recurring)].sort(compare),
  };
}

describe("shared vectors: company-forecast", () => {
  const vectors = load();

  it("has the cases of the project, company and year forecast tests, and the date and size edges", () => {
    const names = vectors.map((vector) => vector.name);
    for (const part of ["project-", "edits-", "loan-", "cash-", "company-", "skips-", "year-", "twelve-months", "month-length", "december-31", "israel-midnight", "near-2-to-the-53"]) {
      expect(names.some((name) => name.includes(part)), part).toBe(true);
    }
  });

  it.each(vectors.map((vector) => [vector.name, vector] as const))("%s", (_name, vector) => {
    expect(companyForecastAnswer(vector.input)).toEqual(vector.expected);
  });
});
