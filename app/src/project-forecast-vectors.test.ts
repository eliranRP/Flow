import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CategoryRow, ExpectedParty, ForecastOverrideRow, LoanKind, LoanStatus } from "@flow/shared";
import { companyGeneralForecast, skipEdits, type CategoryMonthsRow } from "./company-next-month";
import { skippedKeys } from "./forecast-skip";
import { incomeFactsOf, isRent, type RentCategory } from "./next-month-chart";
import { shiftMonthKey } from "./period";
import { projectForecastOf, type ProjectForecastRead } from "./project-forecast-map";
import { withRowRemoved, withSkipsChanged } from "./project-forecast-patch";
import { categoryChoices, type CategoryHistory, type ChargeHint, forecastCategoryAmounts, historyBars } from "./project-next-edit";
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

/** What the page builds for the vector's input: the project's charges and loans (the general costs' for the overhead project) and the forecast from them. */
function built(input: ProjectForecastVectorInput) {
  const general = input.general === true;
  const all: ExpectedParty[] = input.recurring.map((party) => ({ ...party, typical_amount_minor: BigInt(party.typical_amount_minor) }));
  // useProjectNextMonth: the general costs' charges are those of no project or of the overhead project, built as the project's.
  const recurring = general ? all.filter((party) => party.project_id == null || party.project_id === input.projectId).map((party) => ({ ...party, project_id: input.projectId })) : all;
  const loans = input.loans.map(toLoan).filter((loan) => (general ? loan.projectId == null || loan.projectId === input.projectId : loan.projectId === input.projectId));
  return { general, recurring, forecast: forecastOf(input, recurring, loans) };
}

/** What private.project_forecast_build answers for the vector's input, from the app's builders. */
function projectForecastAnswer(input: ProjectForecastVectorInput): unknown {
  const { general, recurring, forecast } = built(input);
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

/**
 * FLOW-1315: project_forecast's answer, mapped by projectForecastOf, is what the pages drew from the builders: the same forecast
 * (whole structures, rows in order, bigint amounts), the card's income note facts, the edit page's history bars and category
 * hints. The vectors' `expected` is the database's answer for the same input (vectors_project_forecast.test.sql).
 */
describe("project_forecast mapped for the pages equals the builders (FLOW-1315)", () => {
  const vectors = load();
  const keyed = (rows: ProjectForecastVectorInput["overrides"]) => rows.map((row) => ({ item_key: row.item_key, amount_minor: row.amount_minor ?? null, due_on: row.due_on ?? null, moved_out: row.moved_out }));

  it.each(vectors.map((vector) => [vector.name, vector] as const))("%s", (_name, vector) => {
    const { input } = vector;
    const read = projectForecastOf(vector.expected, input.projectId);
    const { general, recurring, forecast } = built(input);
    expect(read).not.toBeNull();
    if (read == null) return;
    expect(read.today).toBe(input.today);
    expect(read.month).toBe(input.month);
    expect(read.currency).toBe(input.currency);
    expect(read.general).toBe(general);
    // The whole forecast, in the builders' order. The loans' cash by loan and the arrived lines are in no row and no screen reads them.
    expect(read.forecast).toEqual({ ...forecast, loanCash: [], arrived: [], skipped: forecast.skipped ?? [] });
    // The project page's card and the צפי page lead with the cash forecast.
    const cash = cashForecast(forecast);
    expect(cashForecast(read.forecast)).toEqual({ ...cash, loanCash: [], arrived: [], skipped: cash.skipped ?? [] });
    expect(read.income).toEqual(incomeFactsOf(forecast.rows, input.categories));
    expect(read.edited).toBe(input.edits.some((edit) => edit.start_month === forecast.month));
    expect(read.overrides).toEqual(keyed(input.overrides));
    // The edit page: its history bars and its category sheet's hints, from the page's own history and charges.
    const months = Array.from({ length: 6 }, (_, index) => `${shiftMonthKey(input.today.slice(0, 7), index - 6)}-01`);
    const pageHistory = { months, categories: input.categoryMonths };
    expect(read.history.months).toEqual(months);
    const categoryIds = [null, ...input.categories.map((category) => category.id), ...input.categoryMonths.map((row) => row.id)];
    for (const id of new Set(categoryIds)) expect(historyBars(read.history, id, input.currency), `bars of ${String(id)}`).toEqual(historyBars(pageHistory, id, input.currency));
    const sheet = (charges: readonly ChargeHint[], history: CategoryHistory) => categoryChoices({
      categories: input.categories.map((category) => ({ kind: "expense", hidden: false, ...category }) as CategoryRow),
      categoryMonths: history,
      recurring: charges,
      projectId: input.projectId,
      currency: input.currency,
      divisor: forecast.averageMonths,
      inForecast: forecastCategoryAmounts(forecast),
      query: "",
    });
    expect(sheet(read.charges, read.history)).toEqual(sheet(recurring, pageHistory));
  });

  it("maps the uncategorized history row to a null id, so its bars still show (the answer leaves the id out)", () => {
    const vector = vectors.find((item) => item.name === "project-uncategorized-average-other-p-1-2026-11");
    const read = projectForecastOf(vector?.expected, "p-1");
    expect(read?.history.categories.some((category) => category.id === null)).toBe(true);
    expect(historyBars(read?.history, null, "USD")).not.toBeNull();
  });

  it("keeps the rows in the builders' order when the answer lists them in another Hebrew order", () => {
    const vector = vectors.find((item) => item.name === "project-row-order-ties-by-name-p-1-2026-11");
    const answer = vector?.expected as { rows: Array<{ kind: string }> };
    // The lines the user added keep the edits' order; every other row is put in the reverse of the builders'.
    const shuffled = { ...answer, rows: [...answer.rows.filter((row) => row.kind !== "added").reverse(), ...answer.rows.filter((row) => row.kind === "added")] };
    expect(projectForecastOf(shuffled, "p-1")?.forecast.rows.map((row) => row.key)).toEqual(projectForecastOf(answer, "p-1")?.forecast.rows.map((row) => row.key));
  });

  it("refuses an answer whose rows do not add up to its totals", () => {
    const vector = vectors.find((item) => item.name === "project-board-november-juniper-ct-2026-11");
    const answer = vector?.expected as { income_minor: number; expense_minor: number };
    expect(() => projectForecastOf({ ...answer, income_minor: answer.income_minor + 1 }, "p1")).toThrow("do not add up");
    expect(() => projectForecastOf({ ...answer, expense_minor: answer.expense_minor - 1 }, "p1")).toThrow("do not add up");
  });

  it("refuses an amount outside 2^53 - 1 and an answer of the wrong shape", () => {
    const vector = vectors.find((item) => item.name === "near-2-to-the-53-p1-2026-11");
    const answer = vector?.expected as { income_minor: number; rows: Array<{ minor: number }> };
    expect(() => projectForecastOf({ ...answer, income_minor: 2 ** 53 }, "p1")).toThrow("not a safe whole amount");
    expect(() => projectForecastOf({ ...answer, rows: [{ ...answer.rows[0], minor: 1.5 }] }, "p1")).toThrow("not a safe whole amount");
    expect(() => projectForecastOf({ ...answer, rows: "none" }, "p1")).toThrow("not a list");
    expect(() => projectForecastOf([], "p1")).toThrow("not an object");
    expect(projectForecastOf(null, "p1")).toBeNull();
  });
});

/**
 * FLOW-1315: a tap's patch of the forecast the page holds (project-forecast-patch.ts) is the forecast rebuilt with the tap's edit:
 * for every row of every vector, the skip of its party and its lifting, and the project page's removal of the row, give the figures
 * the builders give with the skip in the overrides or the removal among the edits (whole structures, rows in order). A loan row's removal
 * leaves the loans' cash as it was until the read after the write, which no row holds; an added line takes its place among the lines
 * the user added from the list's order, so those lists are compared by key.
 */
describe("a tap's patch equals the rebuilt forecast (FLOW-1315)", () => {
  const vectors = load();
  const readOf = (input: ProjectForecastVectorInput): ProjectForecastRead => {
    const read = projectForecastOf(projectForecastAnswer(input), input.projectId);
    if (read == null) throw new Error("no read");
    return read;
  };
  const byKey = (rows: readonly NextMonthRow[]) => [...rows].map((row) => row.key).sort();
  const overridesByKey = (read: ProjectForecastRead) => [...read.overrides].sort((a, b) => a.item_key.localeCompare(b.item_key));

  it.each(vectors.map((vector) => [vector.name, vector] as const))("%s: skipping each recurring row and lifting it again", (_name, vector) => {
    const { input } = vector;
    const base = readOf(input);
    const recurring = base.forecast.rows.filter((row) => row.kind === "recurring");
    for (const row of recurring) {
      const [, direction, party] = row.key.split(":");
      const key = `party:${direction ?? ""}:${party ?? ""}:${input.currency}`;
      if (input.overrides.some((item) => item.item_key === key)) continue;
      const patched = withSkipsChanged(base, input.projectId, { added: [key], removed: [] }, input.categories);
      const skipped = readOf({ ...input, overrides: [...input.overrides, { item_key: key, amount_minor: null, due_on: null, moved_out: true }] });
      expect(patched.forecast, `skip ${row.key}`).toEqual(skipped.forecast);
      expect(patched.income).toEqual(skipped.income);
      expect(overridesByKey(patched)).toEqual(overridesByKey(skipped));
      // Lifting it again puts the row back in its place, and the figures as they were. Rows that sort equal (the same day and name)
      // have no place of their own to come back to: the read after the write lists them as the database does.
      const lifted = withSkipsChanged(patched, input.projectId, { added: [], removed: [key] }, input.categories);
      expect({ ...lifted.forecast, rows: lifted.forecast.rows.map((item) => item.key).sort() }, `lift ${row.key}`).toEqual({ ...base.forecast, rows: base.forecast.rows.map((item) => item.key).sort() });
      const tied = (rows: readonly NextMonthRow[], at: number) => rows.filter((item) => item.kind === row.kind && item.date === row.date && item.name === row.name).length > at;
      if (!tied(base.forecast.rows, 1)) expect(lifted.forecast.rows).toEqual(base.forecast.rows);
      expect(lifted.income).toEqual(base.income);
    }
  });

  it.each(vectors.map((vector) => [vector.name, vector] as const))("%s: the project page's removal of each row", (_name, vector) => {
    const { input } = vector;
    const base = readOf(input);
    for (const row of base.forecast.rows) {
      const patched = withRowRemoved(base, row.key, input.categories);
      const edit: ProjectForecastEdit = { id: `optimistic-remove:${row.key}`, kind: "remove", row_key: row.key, category_id: null, direction: null, amount_minor: null, pace: "month", start_month: input.month };
      const removed = readOf({ ...input, edits: [...input.edits, edit] });
      expect(patched.income, `remove ${row.key}`).toEqual(removed.income);
      // The edit the write makes starts in the month: the reset button shows at the tap, as it did.
      expect(patched.edited).toBe(removed.edited);
      expect(patched.edited).toBe(true);
      expect(patched.cashPending, `cash pending after ${row.key}`).toBe(row.kind === "loan");
      expect(removed.cashPending).toBe(false);
      if (row.kind === "added") {
        expect(byKey(patched.forecast.removed)).toEqual(byKey(removed.forecast.removed));
        expect({ ...patched.forecast, removed: [] }).toEqual({ ...removed.forecast, removed: [] });
      } else if (row.kind === "loan") {
        // Everything but the loans' cash, which is pending (never drawn) until the read after the write brings it.
        expect({ ...patched.forecast, cashOnlyMinor: 0n }).toEqual({ ...removed.forecast, cashOnlyMinor: 0n });
      } else {
        expect(patched.forecast).toEqual(removed.forecast);
      }
    }
  });

  it("a skip of a row the project page already removed moves nothing, and lifting it moves nothing back", () => {
    const vector = vectors.find((item) => item.name === "edits-removed-row-listed-apart-juniper-ct-2026-11");
    if (vector == null) throw new Error("no vector");
    const base = readOf(vector.input);
    const [, direction, party] = (base.forecast.removed[0]?.key ?? "").split(":");
    const key = `party:${direction ?? ""}:${party ?? ""}:USD`;
    const skipped = withSkipsChanged(base, vector.input.projectId, { added: [key], removed: [] });
    expect(skipped.forecast.rows).toEqual(base.forecast.rows);
    expect(skipped.forecast.removed).toEqual(base.forecast.removed);
    expect(withSkipsChanged(skipped, vector.input.projectId, { added: [], removed: [key] }).forecast).toEqual(base.forecast);
  });
});
