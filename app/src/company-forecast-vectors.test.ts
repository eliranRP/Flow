import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ExpectedParty, LoanKind, LoanStatus } from "@flow/shared";
import { cardOfForecast, cardOfTotals, forecastRowsOf, forecastTotalsOf, orderRows, restOfForecast, restOfTotals, withSkips } from "./company-forecast-map";
import { companyCashForecast, companyForecastCaption, companyGeneralForecast, companyIncomeNoteOfFacts, companyNextMonthForecast, splitPartyKeys, type CompanyForecastInput, type CompanyNextMonth, type CompanyNextMonthInputs } from "./company-next-month";
import { companyMonthInput, companyRestOfYear, restIncomeNote, restOfYearMonths } from "./company-year-forecast";
import { futureForecastKey } from "./forecast-future-keys";
import "./company-forecast-query";
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
/** company-forecast-query.ts registers how a skip moves the cached forecast; the tests below call it as forecast-month.ts does. */
const patch = vi.hoisted(() => ({ run: null as null | ((client: QueryClient, month: string, change: (keys: readonly string[]) => readonly string[]) => () => void) }));
vi.mock("./forecast-month", async (original) => ({
  ...(await original<typeof import("./forecast-month")>()),
  setCompanyForecastPatch: (run: NonNullable<typeof patch.run>) => { patch.run = run; },
}));

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

/**
 * A part's list as the database gives it: its rows by key, then the lines the user added in the builder's own order
 * (the edits' order, which the app cannot rebuild from the keys).
 */
function rowsJson(rows: readonly NextMonthRow[]): Record<string, unknown>[] {
  const sorted = rows.filter((row) => row.kind !== "added").map((row) => ({ row })).sort(byKey).map(({ row }) => row);
  return [...sorted, ...rows.filter((row) => row.kind === "added")].map(rowJson);
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

/** One part of the month, as private.company_forecast_build writes it. */
function partJson(projectId: string | null, part: CompanyNextMonth["parts"][number]["forecast"]): Record<string, unknown> {
  return {
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
  };
}

/** The month's answer; the general costs' part is listed even with no row (companyGeneralForecast), counting in no total. */
function monthJson(forecast: CompanyNextMonth, input: CompanyForecastInput, categories: readonly RentCategory[]): Record<string, unknown> {
  const general = forecast.parts.some((part) => part.projectId == null) ? [] : [partJson(null, companyGeneralForecast(input, forecast.month))];
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
    parts: [...forecast.parts.map(({ projectId, forecast: part }) => partJson(projectId, part)), ...general],
    skipped: forecast.skipped
      .map(({ projectId, row }) => (projectId == null ? { row } : { project: projectId, row }))
      .sort(byKey)
      .map(({ project, row }) => ({ ...(project == null ? {} : { project_id: project }), ...rowJson(row) })),
  };
}

/** The app's builders' months for the vector's input: one payments-left memo for the read (FLOW-1304), each month's edits and skips. */
function builtMonths(input: CompanyForecastVectorInput) {
  const recurring: ExpectedParty[] = input.recurring.map((party) => ({ ...party, typical_amount_minor: BigInt(party.typical_amount_minor) }));
  const read = { currency: input.currency, today: input.today, recurring, loans: input.loans.map(toLoan), categories: input.categories, inputs: input.inputs };
  const payments = newPaymentsLeftMemo();
  const monthInputs = input.months.map((month): CompanyForecastInput => ({ ...companyMonthInput(read, month), skips: input.inputs.skips?.[month] ?? [], payments }));
  return { recurring, read, monthInputs, forecasts: monthInputs.map((monthInput) => companyNextMonthForecast(monthInput)) };
}

/** What private.company_forecast_build answers for the vector's input, from the app's builders. */
function companyForecastAnswer(input: CompanyForecastVectorInput): unknown {
  const { recurring, monthInputs, forecasts } = builtMonths(input);
  // restIncomeNote: each stream once, however many months it comes in.
  const streams = new Map<string, CompanyRow>();
  for (const forecast of forecasts) {
    for (const row of forecast.rows) {
      const key = `${row.projectId ?? ""}:${row.key}`;
      if (row.minor > 0n && !streams.has(key)) streams.set(key, row);
    }
  }
  return {
    months: forecasts.map((forecast, index) => monthJson(forecast, monthInputs[index] as CompanyForecastInput, input.categories)),
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

/**
 * FLOW-1308: the app reads company_forecast's answer back into what the screens drew from the builders. Each vector's
 * expected answer (what the database gives) goes through the app's mapping and must equal the builders' own value for the
 * same input, and so must the notes the cards read.
 */
describe("the app's reading of the answer equals the builders' (FLOW-1308)", () => {
  const vectors = load();
  type Expected = { months: Record<string, unknown>[]; income: unknown; split_keys: unknown };

  /** The answer of one month of the vector's expected answer, as company_forecast gives it for 'rows'. */
  function rowsAnswer(vector: Vector, index: number) {
    const expected = vector.expected as Expected;
    return { today: vector.input.today, currency: vector.input.currency, months: [expected.months[index]], income: expected.income, split_keys: expected.split_keys };
  }

  /**
   * The amounts and lists as the screens read them: no undefined skipped, the loans' cash by loan. `drawn` leaves out what no
   * company screen draws and a part with no row cannot hold again (its average months). The rows removed or arrived and the loans' cash
   * are not read from the answer: no company screen draws them (the overhead project's page builds its own).
   */
  function plain(forecast: CompanyNextMonth, drawn = false) {
    return {
      ...forecast,
      splitKeys: [...forecast.splitKeys].sort(),
      parts: forecast.parts.map((part) => ({
        ...part,
        skipped: part.skipped ?? [],
        forecast: { ...part.forecast, ...(drawn ? { averageMonths: 0 } : {}), removed: [], arrived: [], loanCash: [], loanCount: 0, skipped: part.forecast.skipped ?? [] },
      })),
    };
  }

  it.each(vectors.map((vector) => [vector.name, vector] as const))("%s: each month as 'rows' is the builders' month, with its rows in their order, in profit and in cash terms", (_name, vector) => {
    const { forecasts } = builtMonths(vector.input);
    forecasts.forEach((built, index) => {
      const mapped = forecastRowsOf(rowsAnswer(vector, index));
      expect(plain(mapped.forecast)).toEqual(plain(built));
      expect(plain(companyCashForecast(mapped.forecast))).toEqual(plain(companyCashForecast(built)));
      expect(mapped.months[0]?.netMinor).toBe(built.netMinor);
    });
  });

  it.each(vectors.map((vector) => [vector.name, vector] as const))("%s: each month's 'totals' give the card and the notes the builders give", (_name, vector) => {
    const { forecasts, read } = builtMonths(vector.input);
    const totals = forecastTotalsOf({ today: vector.input.today, currency: vector.input.currency, ...(vector.expected as Expected) });
    expect(totals.months).toHaveLength(forecasts.length);
    forecasts.forEach((built, index) => {
      const month = totals.months[index];
      if (month == null) throw new Error("no month");
      expect(cardOfTotals(month)).toEqual(cardOfForecast(built, vector.input.categories));
      expect(month.incomeMinor).toBe(built.incomeMinor);
      expect(month.expenseMinor).toBe(built.expenseMinor);
      // The cash view's expense: the loans' cash no row holds, over the parts with a row.
      expect(month.expenseMinor + month.cashOnlyMinor).toBe(companyCashForecast(built).expenseMinor);
    });
    // The income over the months, each stream once.
    expect(companyIncomeNoteOfFacts(totals.income)).toBe(restIncomeNote({ forecasts }, vector.input.categories));
    // The year view's card, where the months asked are the months left in the year: the sums of the builders' months.
    if (JSON.stringify(vector.input.months) === JSON.stringify(restOfYearMonths(vector.input.today))) {
      const incomeMinor = forecasts.reduce((sum, forecast) => sum + forecast.incomeMinor, 0n);
      const expenseMinor = forecasts.reduce((sum, forecast) => sum + forecast.expenseMinor, 0n);
      const rest = { year: vector.input.today.slice(0, 4), months: forecasts.map((forecast) => ({ month: forecast.month, incomeMinor: forecast.incomeMinor, expenseMinor: forecast.expenseMinor })), incomeMinor, expenseMinor, netMinor: incomeMinor - expenseMinor, forecasts };
      expect(restOfTotals(vector.input.today, totals.months, totals.income)).toEqual(restOfForecast(rest, vector.input.categories));
      // companyRestOfYear builds every month from the read's later edits (next month's too), companyMonthInput next month from `edits`: the same unless a payload gives them apart.
      const built = companyRestOfYear({ ...read, skipsByMonth: vector.input.inputs.skips });
      if (vector.input.inputs.rest_edits == null) expect(built == null ? null : restOfForecast(built, vector.input.categories)).toEqual(restOfForecast(rest, vector.input.categories));
    }
  });

  it("covers the year view's card with more than one vector", () => {
    expect(vectors.filter((vector) => JSON.stringify(vector.input.months) === JSON.stringify(restOfYearMonths(vector.input.today))).length).toBeGreaterThan(1);
  });

  it.each(vectors.filter((vector) => Object.values(vector.input.inputs.skips ?? {}).some((keys) => keys.length > 0)).map((vector) => [vector.name, vector] as const))(
    "%s: a skip drawn at once is the month the builders give with that skip, and its undo the month without",
    (_name, vector) => {
      const withSkip = builtMonths(vector.input).forecasts;
      const bare = { ...vector.input, inputs: { ...vector.input.inputs, skips: undefined } };
      const without = builtMonths(bare);
      const bareAnswer = companyForecastAnswer(bare) as Expected;
      withSkip.forEach((built, index) => {
        const keyOf = futureForecastKey(built, vector.input.currency);
        const keys = new Set(built.skipped.flatMap(({ row, projectId }) => keyOf(row.key, projectId) ?? []));
        const mappedWith = forecastRowsOf(rowsAnswer(vector, index)).forecast;
        const mappedBare = forecastRowsOf({ ...rowsAnswer(vector, index), months: [bareAnswer.months[index]] }).forecast;
        expect(plain(withSkips(mappedWith, new Set(), vector.input.currency), true)).toEqual(plain(without.forecasts[index] as CompanyNextMonth, true));
        expect(plain(withSkips(mappedBare, keys, vector.input.currency), true)).toEqual(plain(built, true));
      });
    },
  );

  it("refuses an answer whose parts do not add up to its month: a row of a kind the app does not know would drop out of a total", () => {
    const vector = vectors.find((item) => item.name === "company-projects-and-general");
    if (vector == null) throw new Error("no vector");
    const answer = rowsAnswer(vector, 0);
    expect(() => forecastRowsOf(answer)).not.toThrow();
    const month = JSON.parse(JSON.stringify(answer.months[0])) as { expense_minor: number; net_minor: number; parts: Array<{ rows: unknown[] }> };
    // The database counts the row: 50 more expense.
    month.expense_minor += 50;
    month.net_minor -= 50;
    month.parts[0]?.rows.push({ key: "x:transfer", kind: "transfer", direction: "expense", name: "Transfer", minor: -50 });
    expect(() => forecastRowsOf({ ...answer, months: [month] })).toThrow(/company_forecast/u);
  });

  it.each(vectors.filter((vector) => Object.values(vector.input.inputs.skips ?? {}).some((keys) => keys.length > 0)).map((vector) => [vector.name, vector] as const))(
    "%s: the patch a skip's tap runs on the cached month, its totals and its income note, is the month the database gives with that skip",
    (_name, vector) => {
      const bare = { ...vector.input, inputs: { ...vector.input.inputs, skips: undefined } };
      const bareAnswer = companyForecastAnswer(bare) as Expected;
      const run = patch.run;
      if (run == null) throw new Error("no patch registered");
      builtMonths(vector.input).forecasts.forEach((built, index) => {
        const keyOf = futureForecastKey(built, vector.input.currency);
        const keys = built.skipped.flatMap(({ row, projectId }) => keyOf(row.key, projectId) ?? []);
        const server = forecastRowsOf(rowsAnswer(vector, index));
        const client = new QueryClient();
        const rows = ["month-forecast", "off", "company", "rows", vector.input.today, built.month];
        const card = ["month-forecast", "off", "company", "totals", vector.input.today, built.month];
        client.setQueryData(rows, forecastRowsOf({ ...rowsAnswer(vector, index), months: [bareAnswer.months[index]] }));
        client.setQueryData(card, forecastTotalsOf({ ...rowsAnswer(vector, index), months: [bareAnswer.months[index]] }));
        client.setQueryData(["categories", "off"], vector.input.categories);
        const undo = run(client, built.month, () => keys);
        const patched = client.getQueryData<ReturnType<typeof forecastRowsOf>>(rows);
        if (patched == null) throw new Error("no rows");
        // Rows and totals as the server gives them (a part with no row is not told apart on average months and removed rows).
        expect(plain(patched.forecast, true)).toEqual(plain(server.forecast, true));
        expect(patched.months[0]).toEqual(server.months[0]);
        expect(client.getQueryData<ReturnType<typeof forecastTotalsOf>>(card)?.months[0]).toEqual(server.months[0]);
        undo();
        expect(client.getQueryData<ReturnType<typeof forecastRowsOf>>(rows)?.months[0]?.netMinor).not.toBe(undefined);
      });
    },
  );

  it("drops the general part when it has no row: it adds no row, no caption, and no cash of its own", () => {
    const part = (extra: Record<string, unknown>) => ({ average_months: 3, removed: [], arrived: [], loan_cash: [], ...extra });
    const answer = {
      today: "2026-11-24",
      currency: "USD",
      months: [{
        month: "2026-12", income_minor: 0, expense_minor: 20_000, net_minor: -20_000, cash_only_minor: 0, projects: 1, general: false, income: { rows: 0, recurring: 0, rent: 0 },
        parts: [
          part({ project_id: "p1", income_minor: 0, expense_minor: 20_000, cash_only_minor: 0, rows: [{ key: "avg:c1", kind: "average", direction: "expense", name: "Repairs", minor: -20_000, category_id: "c1" }] }),
          // The general costs: no row, and the cash of a loan of theirs (its principal).
          part({ income_minor: 0, expense_minor: 0, cash_only_minor: 90_000, rows: [], loan_cash: [{ loan_id: "l1", row_category_ids: [], minor: 90_000 }] }),
        ],
        skipped: [],
      }],
      income: { rows: 0, recurring: 0, rent: 0 },
      split_keys: [],
    };
    const { forecast, months } = forecastRowsOf(answer);
    expect(forecast.parts.map((part) => part.projectId)).toEqual(["p1"]);
    expect(companyForecastCaption(forecast)).toBe("פרויקט אחד");
    expect(forecast.expenseMinor).toBe(20_000n);
    // companyCashForecast adds each kept part's cash: the dropped general part's 90,000 is in no total.
    expect(companyCashForecast(forecast).expenseMinor).toBe(20_000n);
    expect(months[0]?.cashOnlyMinor).toBe(0n);
  });

  it("lists the rows taken out as the builders do: by project in id order, the general costs last, each part's rows in its own order", () => {
    const row = (key: string, name: string, minor: number, extra: Record<string, unknown> = {}) => ({ key, kind: "recurring", direction: minor > 0 ? "income" : "expense", name, date: "2026-12-05", minor, ...extra });
    const part = (extra: Record<string, unknown>) => ({ income_minor: 0, expense_minor: 0, cash_only_minor: 0, average_months: 3, rows: [], removed: [], arrived: [], loan_cash: [], ...extra });
    const answer = {
      today: "2026-11-24",
      currency: "USD",
      months: [{
        month: "2026-12", income_minor: 0, expense_minor: 0, net_minor: 0, cash_only_minor: 0, projects: 0, general: false, income: { rows: 0, recurring: 0, rent: 0 },
        parts: [part({})],
        // The database lists the general costs first, then the projects by id, each by key.
        skipped: [
          row("rec:expense:b", "בית", -100),
          row("rec:expense:a", "אור", -200),
          { project_id: "p2", ...row("rec:expense:z", "Z", -300) },
          { project_id: "p1", ...row("rec:expense:y", "Y", -400) },
          { project_id: "p1", ...row("add:e1", "קטגוריה", -500, { kind: "added", date: undefined, pace: "month" }) },
          { project_id: "p1", ...row("rec:expense:x", "X", -600, { date: "2026-12-01" }) },
        ],
      }],
      income: { rows: 0, recurring: 0, rent: 0 },
      split_keys: [],
    };
    const { forecast } = forecastRowsOf(answer);
    // The builder: projects by id (`p1`, `p2`), then the general costs; in each, the rows by day then name, the added line last.
    expect(forecast.skipped.map(({ projectId, row }) => [projectId, row.key])).toEqual([
      ["p1", "rec:expense:x"],
      ["p1", "rec:expense:y"],
      ["p1", "add:e1"],
      ["p2", "rec:expense:z"],
      [null, "rec:expense:a"],
      [null, "rec:expense:b"],
    ]);
  });

  it("sorts the Hebrew names as the builder does, and a changed row where Flow had it", () => {
    const names = ["שמש", "אור", "בית", "אבא", "גן", "דבורה"];
    const parties = names.map((name, index): ExpectedParty => ({
      direction: "expense", party_id: `s${String(index)}`, name, currency: "USD", typical_amount_minor: -1000n, typical_day: 5, months_seen: 6, seen_this_month: true,
      project_id: "p1", category_id: null, pace: "month", next_due_month: "2026-12", pays_loan: false,
    }));
    const built = companyNextMonthForecast({
      currency: "USD", today: "2026-11-24", recurring: parties, loans: [], categories: [],
      inputs: { month: "2026-12", overhead_project_id: null, projects: [{ project_id: "p1", categories: [] }], general: [], edits: [] },
    });
    const wanted = built.rows.map((row) => row.name);
    expect(wanted).toEqual([...names].sort((a, b) => a.localeCompare(b, "he")));
    // The database lists them by key (s0, s1, ...): the names in the order given above, not Hebrew order.
    const byKey = [...built.rows].sort((a, b) => compare(a.key, b.key));
    expect(orderRows(byKey).map((row) => row.name)).toEqual(wanted);
    // Averages of equal amounts tie on the name; a changed one sorts by the amount Flow had, as the builder's sort ran before the change.
    const average = (key: string, name: string, minor: bigint, wasMinor: bigint | null): NextMonthRow => ({ key, kind: "average", direction: "expense", name, date: null, minor, categoryId: key, wasMinor, pace: null });
    const rows = [average("avg:a", "תיקונים", -500n, -100n), average("avg:b", "אחזקה", -200n, null), average("avg:c", "ביטוח", -200n, null)];
    expect(orderRows(rows).map((row) => row.key)).toEqual(["avg:b", "avg:c", "avg:a"]);
  });

  it("keeps the lines the user added in the order given, whatever their names or keys", () => {
    const added = (key: string, name: string): NextMonthRow => ({ key, kind: "added", direction: "expense", name, date: null, minor: -100n, categoryId: null, wasMinor: null, pace: "month" });
    const rows = [added("add:z", "אור"), added("add:a", "תיקונים"), added("add:m", "בית")];
    expect(orderRows(rows).map((row) => row.key)).toEqual(["add:z", "add:a", "add:m"]);
  });

  it("refuses an amount that is not a safe integer, and a month that is not one", () => {
    const answer = (extra: Record<string, unknown>) => ({ today: "2026-11-24", currency: "USD", income: { rows: 0, recurring: 0, rent: 0 }, months: [{ month: "2026-12", income_minor: 1, expense_minor: 0, net_minor: 1, cash_only_minor: 0, projects: 0, general: false, income: { rows: 0, recurring: 0, rent: 0 }, ...extra }] });
    expect(forecastTotalsOf(answer({})).months[0]?.incomeMinor).toBe(1n);
    for (const bad of [2 ** 60, 9_007_199_254_740_992, 1.5, "12.5", null]) expect(() => forecastTotalsOf(answer({ income_minor: bad })), String(bad)).toThrow(/company_forecast/u);
    expect(() => forecastTotalsOf({ ...answer({}), months: [{}] })).toThrow(/company_forecast/u);
    expect(() => forecastTotalsOf({ today: "2026-11-24" })).toThrow(/company_forecast/u);
    // 'rows' is of one month.
    expect(() => forecastRowsOf({ ...answer({}), months: [] })).toThrow(/company_forecast/u);
  });
});
