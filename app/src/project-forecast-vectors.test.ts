import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ExpectedParty, ForecastOverrideRow, LoanKind, LoanStatus } from "@flow/shared";
import { companyGeneralForecast, skipEdits, type CategoryMonthsRow } from "./company-next-month";
import { skippedKeys } from "./forecast-skip";
import { isRent, type RentCategory } from "./next-month-chart";
import { shiftMonthKey } from "./period";
import { type ForecastCategory, type ForecastLoan } from "./project-next-loans";
import { applyForecastEdits, cashForecast, nextMonthForecast, type NextMonthForecast, type NextMonthRow, type ProjectForecastEdit } from "./project-next-month";

/**
 * FLOW-1309: the shared project-forecast vectors (packages/shared/fixtures/vectors/project-forecast, format in its
 * README) run through the app's own builders: nextMonthForecast with the project's edits and the month's skips on top
 * (applyForecastEdits, skipEdits) and cashForecast, as useNextMonthForecast and the project page's card build them,
 * and, for the company's overhead project, companyGeneralForecast, as useProjectNextMonth builds the general costs.
 * The database core private.project_forecast_build runs the same files (supabase/tests/database/
 * vectors_project_forecast.test.sql), so the project page, its צפי page and its edit page read the same figures from
 * either. Unlike the company's answer, the rows keep the builder's order: the צפי page lists them as they come.
 */
const dir = join(dirname(fileURLToPath(import.meta.url)), "../../packages/shared/fixtures/vectors/project-forecast");

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

type ProjectForecastVectorInput = {
  projectId: string;
  /** The company's overhead project: its page is the general costs. */
  general?: boolean;
  currency: string;
  today: string;
  /** yyyy-mm, the month of the forecast. */
  month: string;
  /** expected_months' recurring[]: the project's charges, or with `general` the company's. */
  recurring: JsonParty[];
  categoryMonths: CategoryMonthsRow[];
  /** project_forecast_edits_for, as the app reads it. */
  edits: ProjectForecastEdit[];
  /** forecast_overrides_for the month. */
  overrides: ForecastOverrideRow[];
  loans: JsonLoan[];
  categories: JsonCategory[];
};

type Vector = { name: string; description?: string; input: ProjectForecastVectorInput; expected: unknown };

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

/** What the card's income note reads (incomeNote): the income rows, how many are recurring, how many of those are rent, and the name of a single one. */
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

function absolute(minor: bigint): bigint {
  return minor < 0n ? -minor : minor;
}

/** The forecast the page builds for the vector's input, with the month's skips and the edits on top. */
function forecastOf(input: ProjectForecastVectorInput, recurring: readonly ExpectedParty[], loans: readonly ForecastLoan[]): NextMonthForecast {
  const skips = [...skippedKeys(input.overrides)];
  if (input.general === true) {
    // useProjectNextMonth: the overhead project's page is companyGeneralForecast, with the overhead project's edits.
    return companyGeneralForecast({
      currency: input.currency,
      today: input.today,
      recurring,
      loans,
      categories: input.categories,
      inputs: {
        month: input.month,
        overhead_project_id: input.projectId,
        projects: [],
        general: input.categoryMonths,
        edits: input.edits.map((edit) => ({ ...edit, project_id: input.projectId })),
      },
      skips,
      month: input.month,
    }, input.month);
  }
  const categoryMonths = {
    project_id: input.projectId,
    today: input.today,
    this_month: `${input.today.slice(0, 7)}-01`,
    months: [],
    categories: input.categoryMonths.map((row) => ({ ...row, group_name: null, this_month_minor: 0, months_seen: 0, expected_minor: null, typical_day: null, flag: null })),
  };
  return applyForecastEdits(
    nextMonthForecast({ projectId: input.projectId, currency: input.currency, today: input.today, recurring, categoryMonths, loans, categories: input.categories, month: input.month }),
    [...input.edits, ...skipEdits(skips, input.projectId, null, input.month)],
  );
}

/** What private.project_forecast_build answers for the vector's input, from the app's builders. */
function projectForecastAnswer(input: ProjectForecastVectorInput): unknown {
  const general = input.general === true;
  const all: ExpectedParty[] = input.recurring.map((party) => ({ ...party, typical_amount_minor: BigInt(party.typical_amount_minor) }));
  // useProjectNextMonth: the general costs' charges are those of no project or of the overhead project, built as the project's.
  const recurring = general ? all.filter((party) => party.project_id == null || party.project_id === input.projectId).map((party) => ({ ...party, project_id: input.projectId })) : all;
  const loans = input.loans.map(toLoan).filter((loan) => (general ? loan.projectId == null || loan.projectId === input.projectId : loan.projectId === input.projectId));
  const forecast = forecastOf(input, recurring, loans);
  const cash = cashForecast(forecast);
  return {
    today: input.today,
    month: input.month,
    currency: input.currency,
    general,
    income_minor: Number(forecast.incomeMinor),
    expense_minor: Number(forecast.expenseMinor),
    net_minor: Number(forecast.netMinor),
    cash_only_minor: Number(forecast.cashOnlyMinor),
    cash_expense_minor: Number(cash.expenseMinor),
    cash_net_minor: Number(cash.netMinor),
    loan_count: forecast.loanCount,
    average_months: forecast.averageMonths,
    income: incomeFacts(forecast.rows, input.categories),
    rows: forecast.rows.map(rowJson),
    removed: forecast.removed.map(rowJson),
    skipped: (forecast.skipped ?? []).map(rowJson),
    // The צפי page's reset button: an edit made for this month.
    edited: input.edits.some((edit) => edit.start_month === forecast.month),
    overrides: input.overrides.map((row) => Object.fromEntries(Object.entries(row).filter(([, value]) => value != null))),
    history: {
      months: Array.from({ length: 6 }, (_, index) => `${shiftMonthKey(input.today.slice(0, 7), index - 6)}-01`),
      categories: input.categoryMonths.filter((row) => row.currency === input.currency).map((row) => ({ ...(row.id == null ? {} : { id: row.id }), currency: row.currency, months_minor: row.months_minor })),
    },
    // categoryChoices: the project's charges that file to a category, a loan's payment aside.
    charges: recurring
      .filter((party) => party.project_id === input.projectId && party.pays_loan !== true && party.currency === input.currency && party.category_id != null)
      .map((party) => ({ category_id: party.category_id, amount_minor: Number(absolute(party.typical_amount_minor)), pace: party.pace ?? "month" })),
  };
}

describe("shared vectors: project-forecast", () => {
  const vectors = load();

  it("has the cases of the project forecast tests, and the date and size edges", () => {
    const names = vectors.map((vector) => vector.name);
    for (const part of ["project-", "edits-", "loan-", "cash-", "skips-", "general-", "month-length", "december-31", "israel-midnight", "near-2-to-the-53"]) {
      expect(names.some((name) => name.includes(part)), part).toBe(true);
    }
  });

  it.each(vectors.map((vector) => [vector.name, vector] as const))("%s", (_name, vector) => {
    expect(projectForecastAnswer(vector.input)).toEqual(vector.expected);
  });
});
