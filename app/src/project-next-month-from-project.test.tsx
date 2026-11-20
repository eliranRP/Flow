import { act, waitFor } from "@testing-library/react";
import type { ProjectDetail } from "@flow/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyForecastEdits, nextMonthForecast, nextMonthKey } from "./project-next-month";
import { type ForecastLoan, forecastLoansOf, loanParts } from "./project-next-loans";
import { useNextMonthForecast } from "./project-next-month-query";
import { LOAN_WRITE_KEYS } from "./screens/loan-match-api";
import { type LoanDetailDbRow, readLoanRow } from "./screens/loan-detail-data";
import { renderWithProviders } from "./test-render";
import { israelToday } from "./ui/date-math";

// FLOW-1240: the project's forecast builds its loans from the get_project answer, not from the loans and loan_balances
// reads. The fake client logs every rpc and every table read. Invented rows only.
const server = vi.hoisted((): { rpcs: string[]; tables: string[]; answers: Record<string, unknown>; tableAnswers: Record<string, unknown[]> } => ({
  rpcs: [],
  tables: [],
  answers: {},
  tableAnswers: {},
}));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string) => {
      server.rpcs.push(name);
      return Promise.resolve({ data: server.answers[name] ?? null, error: null });
    },
    from: (table: string) => {
      server.tables.push(table);
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) chain[method] = () => chain;
      chain.then = (resolve: (reply: unknown) => unknown) => resolve({ data: server.tableAnswers[table] ?? [], error: null });
      return chain;
    },
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const today = israelToday();
const month = nextMonthKey(today);
const PROJECT = "project-1";

const RATES = [
  { id: "rate-1", effective_date: "2025-01-15", annual_rate_ppm: 60_000 },
  { id: "rate-2", effective_date: "2026-01-15", annual_rate_ppm: 52_500 },
];

/** What the loans read returns for the project's loans (the old path's input). */
function dbRow(id: string, extra: Partial<LoanDetailDbRow>): LoanDetailDbRow {
  return {
    id,
    company_id: "company-1",
    name: `Loan ${id}`,
    currency: "USD",
    principal_minor: 20_000_000,
    annual_rate_ppm: 60_000,
    term_months: 360,
    start_date: "2025-01-15",
    payment_minor: 120_000,
    escrow_minor: 5_000,
    kind: "amortizing",
    interest_only_months: null,
    amortization_months: null,
    status: "open",
    closed_on: null,
    project_id: PROJECT,
    interest_category_id: null,
    escrow_category_id: "cat-escrow-own",
    principal_category_id: null,
    fees_category_id: null,
    loan_rates: RATES,
    ...extra,
  };
}

const DB_ROWS = [
  dbRow("loan-a", {}),
  dbRow("loan-b", { currency: "ILS", interest_category_id: "cat-interest-own" }),
  dbRow("loan-c", { kind: "interest_only", interest_only_months: 24, status: "closed", closed_on: "2026-05-01" }),
];
const BALANCES = [
  { loan_id: "loan-a", balance_minor: 19_000_000, flagged_parts: 2 },
  { loan_id: "loan-b", balance_minor: 18_000_000, flagged_parts: 0 },
  { loan_id: "loan-c", balance_minor: 0, flagged_parts: 0 },
];

/** The same loans as get_project answers them (balance, terms, rates oldest first, and the four category ids). */
function projectLoan(row: LoanDetailDbRow, balance: number, withCategories = true) {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    balance_minor: balance,
    status: row.status,
    closed_on: row.closed_on,
    kind: row.kind,
    principal_minor: row.principal_minor,
    annual_rate_ppm: row.annual_rate_ppm,
    term_months: row.term_months,
    start_date: row.start_date,
    payment_minor: row.payment_minor,
    escrow_minor: row.escrow_minor,
    interest_only_months: row.interest_only_months,
    amortization_months: row.amortization_months,
    rates: RATES.map(({ effective_date, annual_rate_ppm }) => ({ effective_date, annual_rate_ppm })),
    ...(withCategories
      ? {
          interest_category_id: row.interest_category_id,
          escrow_category_id: row.escrow_category_id,
          principal_category_id: row.principal_category_id,
          fees_category_id: row.fees_category_id,
        }
      : {}),
  };
}

function projectAnswer(balances: number[], withCategories = true) {
  return {
    id: PROJECT, name: "Example House", status: "active", state_label: "פעיל", budget_agorot: null, is_overhead: false,
    income_agorot: 0, direct_agorot: 0, shared_agorot: 0, profit_agorot: 0, categories: [],
    loans: DB_ROWS.map((row, index) => projectLoan(row, balances[index] ?? 0, withCategories)),
  };
}

const CATEGORIES = [
  { id: "cat-interest", name: "ריבית משכנתא", kind: "expense", hidden: false, is_default: true, loan_part: "interest", excluded_from_pnl: false },
  { id: "cat-escrow", name: "מסים וביטוח", kind: "expense", hidden: false, is_default: true, loan_part: "escrow", excluded_from_pnl: false },
  { id: "cat-escrow-own", name: "ביטוח הבית", kind: "expense", hidden: false, is_default: false, loan_part: null, excluded_from_pnl: false },
  { id: "cat-interest-own", name: "ריבית פרטית", kind: "expense", hidden: false, is_default: false, loan_part: null, excluded_from_pnl: false },
];

beforeEach(() => {
  server.rpcs.length = 0;
  server.tables.length = 0;
  server.answers = {
    get_project: projectAnswer([19_000_000, 18_000_000, 0]),
    expected_months: { today, project_id: PROJECT, recurring: [] },
    project_category_months: { project_id: PROJECT, today, this_month: `${today.slice(0, 7)}-01`, months: [], categories: [] },
    project_forecast_edits_for: [],
    forecast_overrides_for: [],
    list_categories: CATEGORIES,
  };
  server.tableAnswers = { loans: DB_ROWS, loan_balances: BALANCES };
});

let latest: ReturnType<typeof useNextMonthForecast> | null = null;

function Probe({ currency }: { currency: string }) {
  latest = useNextMonthForecast(PROJECT, currency);
  return null;
}

/** The forecast the old read gave: each loan row with its own balance row, built by the same functions. */
function oldForecast(currency: string, balances = BALANCES) {
  const loans = DB_ROWS.map((row) => {
    const balance = balances.find((entry) => entry.loan_id === row.id);
    return readLoanRow(row, balance == null ? null : { balanceMinor: BigInt(balance.balance_minor), flaggedParts: balance.flagged_parts });
  });
  const base = nextMonthForecast({
    projectId: PROJECT,
    currency,
    today,
    recurring: [],
    categoryMonths: { project_id: PROJECT, today, this_month: `${today.slice(0, 7)}-01`, months: [], categories: [] },
    loans,
    categories: CATEGORIES.map(({ id, name, loan_part, excluded_from_pnl }) => ({ id, name, loan_part, excluded_from_pnl })),
    month,
  });
  return applyForecastEdits(base, []);
}

/** A loan without the fields a rate row's id and the balance row's flagged parts add, which the forecast never reads. */
function forecastFields(loan: ForecastLoan) {
  const { rates, ...rest } = loan;
  return { ...rest, rates: rates.map(({ effectiveDate, annualRatePpm }) => ({ effectiveDate, annualRatePpm })) };
}

describe("the project forecast's loans come from get_project (FLOW-1240)", () => {
  it("builds the same forecast as the loans and loan_balances reads gave, and sends neither request", async () => {
    renderWithProviders(<Probe currency="USD" />);
    await waitFor(() => { expect(latest?.forecast).not.toBeNull(); });

    const expected = oldForecast("USD");
    // Not vacuous: loan-a's payment is due next month, its interest in the keyed category and its escrow in its own.
    expect(expected.rows.filter((row) => row.kind === "loan").map((row) => row.key).sort()).toEqual(["avg:cat-escrow-own", "avg:cat-interest"]);
    expect(latest?.forecast).toEqual(expected);
    expect(server.tables).toEqual([]);
    expect(server.rpcs.filter((name) => name === "get_project")).toHaveLength(1);
  });

  it("the other currency's loan files its own categories", async () => {
    renderWithProviders(<Probe currency="ILS" />);
    await waitFor(() => { expect(latest?.forecast).not.toBeNull(); });
    const expected = oldForecast("ILS");
    expect(expected.rows.filter((row) => row.kind === "loan").map((row) => row.key).sort()).toEqual(["avg:cat-escrow-own", "avg:cat-interest-own"]);
    expect(latest?.forecast).toEqual(expected);
    expect(server.tables).toEqual([]);
  });

  it("a loan write refreshes the forecast: the keys the loan page refreshes read get_project again", async () => {
    const view = renderWithProviders(<Probe currency="USD" />);
    await waitFor(() => { expect(latest?.forecast).not.toBeNull(); });
    const before = latest?.forecast;

    // A payment attached: the balance falls, and so does next month's interest.
    server.answers.get_project = projectAnswer([15_000_000, 18_000_000, 0]);
    await act(async () => {
      await Promise.all(LOAN_WRITE_KEYS.map((key) => view.client.invalidateQueries({ queryKey: [key] })));
    });
    await waitFor(() => { expect(latest?.forecast).not.toEqual(before); });

    expect(latest?.forecast).toEqual(oldForecast("USD", [{ loan_id: "loan-a", balance_minor: 15_000_000, flagged_parts: 2 }, ...BALANCES.slice(1)]));
    expect(server.tables).toEqual([]);
  });

  it("a cached answer from before the migration (no category ids) reads them as empty: no loans request, the keyed categories apply", async () => {
    server.answers.get_project = projectAnswer([19_000_000, 18_000_000, 0], false);
    renderWithProviders(<Probe currency="USD" />);
    await waitFor(() => { expect(latest?.forecast).not.toBeNull(); });
    expect(server.tables).toEqual([]);
    // loan-a's escrow has no own category now, so it files to the company's keyed escrow category.
    expect(latest?.forecast?.rows.filter((row) => row.kind === "loan").map((row) => row.key).sort()).toEqual(["avg:cat-escrow", "avg:cat-interest"]);
  });
});

describe("forecastLoansOf (FLOW-1240)", () => {
  async function parsed(answer: unknown): Promise<ProjectDetail> {
    return (await import("@flow/shared")).projectDetailSchema.parse(answer);
  }

  it("gives each loan as the loans read does, and the same payment due next month", async () => {
    const loans = forecastLoansOf(await parsed(projectAnswer([19_000_000, 18_000_000, 0])));
    const old = DB_ROWS.map((row) => {
      const balance = BALANCES.find((entry) => entry.loan_id === row.id);
      return readLoanRow(row, balance == null ? null : { balanceMinor: BigInt(balance.balance_minor), flaggedParts: balance.flagged_parts });
    });
    expect(loans.map(forecastFields)).toEqual(old.map((loan) => {
      const { id, currency, projectId, categoryIds, status, balanceMinor, kind, termMonths, paymentMinor, rates, principalMinor, annualRatePpm, startDate, escrowMinor, interestOnlyMonths, amortizationMonths } = loan;
      return forecastFields({ id, currency, projectId, categoryIds, status, balanceMinor, kind, termMonths, paymentMinor, rates, principalMinor, annualRatePpm, startDate, escrowMinor, interestOnlyMonths, amortizationMonths });
    }));

    const input = { projectId: PROJECT, currency: "USD", month, today, categories: CATEGORIES };
    expect(loanParts({ ...input, loans })).toEqual(loanParts({ ...input, loans: old }));
  });

  it("gives none for a project with no loans, an answer with no loans block, or no project", async () => {
    const { loans: _loans, ...bare } = projectAnswer([]);
    expect(forecastLoansOf(await parsed(bare))).toEqual([]);
    expect(forecastLoansOf(await parsed({ ...bare, loans: [] }))).toEqual([]);
    expect(forecastLoansOf(null)).toEqual([]);
  });
});
