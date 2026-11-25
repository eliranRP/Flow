import { onlineManager, QueryClient } from "@tanstack/react-query";
import { fireEvent, screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { companyCurrencyQueryOptions } from "../company-currency";
import { MY_COMPANIES_KEY } from "../company-role-cache";
import { QUERY_STALE_MS } from "../query-client";
import { renderWithProviders } from "../test-render";
import { myCompaniesFor, TEST_COMPANY_ID } from "../team-test-support";
import { israelToday } from "../ui/date-math";
import { readLoanList } from "./loan-list";
import { LOANS_ERROR_TITLE } from "./loans-host";
import { LoansScreen } from "./loans-screen";

// The live Loans tab: the company from what the app holds, the list's three reads at once, and its outlooks (FLOW-1316) in one request.

type Pending = { table: string; resolve: (value: { data: unknown; error: null }) => void };

const db = vi.hoisted(() => ({
  pending: [] as Pending[],
  rpc: [] as string[],
  // The company's currency, when a test answers the currency read (null: it never answers).
  currency: null as string | null,
  hold: false,
  selects: [] as Array<{ table: string; columns: string }>,
  // FLOW-1316: loan_outlooks: its calls with their arguments, what it answers, and whether it fails.
  outlookCalls: [] as unknown[],
  outlooks: [] as unknown[],
  outlooksFail: false,
}));

let answers: Record<string, unknown> = {};

function query(table: string) {
  const result = () => {
    if (!db.hold) return Promise.resolve({ data: answers[table] ?? [], error: null });
    return new Promise<{ data: unknown; error: null }>((resolve) => { db.pending.push({ table, resolve }); });
  };
  const next = {
    select: (columns?: string) => {
      if (columns != null) db.selects.push({ table, columns });
      return next;
    },
    eq: () => next,
    in: () => next,
    order: () => result(),
    then: (onFulfilled: (value: { data: unknown; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) =>
      result().then(onFulfilled, onRejected),
  };
  return next;
}

const supabase = vi.hoisted(() => ({
  from: (table: string) => query(table),
  // get_dashboard never answers: the list must not wait for it.
  rpc: (name: string, args?: unknown) => {
    db.rpc.push(name);
    if (name === "loan_outlooks") {
      db.outlookCalls.push(args);
      return Promise.resolve(db.outlooksFail ? { data: null, error: { message: "boom" } } : { data: db.outlooks, error: null });
    }
    if (name === "mcp_company_loan_currency" && db.currency != null) return Promise.resolve({ data: db.currency, error: null });
    return new Promise(() => undefined);
  },
}));

vi.mock("../lib/supabase", () => ({ getSupabase: () => supabase }));

const loanRow = (id: string, name: string, projectId: string | null) => ({
  id,
  company_id: TEST_COMPANY_ID,
  name,
  currency: "ILS",
  principal_minor: 5_000_000,
  annual_rate_ppm: 50_000,
  term_months: 120,
  start_date: "2026-01-01",
  payment_minor: null,
  escrow_minor: 0,
  kind: "amortizing",
  interest_only_months: null,
  amortization_months: null,
  status: "open",
  closed_on: null,
  project_id: projectId,
  interest_category_id: null,
  escrow_category_id: null,
  principal_category_id: null,
  fees_category_id: null,
  loan_rates: [],
});

beforeEach(() => {
  db.pending = [];
  db.rpc = [];
  db.currency = null;
  db.hold = false;
  db.selects = [];
  db.outlookCalls = [];
  db.outlooks = [];
  db.outlooksFail = false;
  answers = {
    loans: [loanRow("l1", "הלוואת גשר", "p1"), loanRow("l2", "הלוואת ציוד", null)],
    loan_balances: [{ loan_id: "l1", balance_minor: 4_000_000, flagged_parts: 0, currency: "ILS" }],
    projects: [{ id: "p1", name: "בית הברוש" }],
  };
});

/** The cache as the app holds it after list_my_companies (no session in a test: the user key is null). */
function withCompanies(ownerId: string | null) {
  // The app's own freshness (query-client.ts): with none, the band's observer, enabled when the currency answers, would read the outlooks again.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_MS } } });
  client.setQueryData([MY_COMPANIES_KEY, null], myCompaniesFor("u1", ownerId));
  return client;
}

describe("live Loans tab", () => {
  it("sends the loans, balances and project names reads together, before any answers, and no schedule or unsplit-payments read", async () => {
    db.hold = true;
    const read = readLoanList(TEST_COMPANY_ID);
    await Promise.resolve();
    expect(db.pending.map((p) => p.table).sort()).toEqual(["loan_balances", "loans", "projects"]);
    for (const p of db.pending) p.resolve({ data: answers[p.table] ?? [], error: null });
    const list = await read;
    expect(list.rows.map((row) => [row.name, row.projectName, row.balanceMinor])).toEqual([
      ["הלוואת גשר", "בית הברוש", 4_000_000n],
      ["הלוואת ציוד", null, 5_000_000n],
    ]);
    // Rows carry no next payment or late mark: those come from loan_outlooks.
    expect(list.rows.every((row) => row.next == null && row.lateOn == null)).toBe(true);
  });

  it("reads the loans without the rates and the day each was added: nothing on the list draws them (FLOW-1316)", async () => {
    await readLoanList(TEST_COMPANY_ID);
    const loans = db.selects.find((select) => select.table === "loans");
    expect(loans?.columns).not.toContain("loan_rates");
    expect(loans?.columns).not.toContain("created_at");
  });

  it("asks loan_outlooks once, with today in Israel, for the list and the band together (FLOW-1316)", async () => {
    answers.loans = [{ ...loanRow("l1", "הלוואת גשר", "p1"), payment_minor: 60_000 }, loanRow("l2", "הלוואת ציוד", null)];
    db.currency = "ILS";
    db.outlooks = [{ loan_id: "l1", next: { due_date: "2026-12-01", interest_minor: 16_000, escrow_minor: 0, principal_minor: 44_000, amount_minor: 60_000 }, ahead_minor: 720_000, late_on: "2026-11-01" }];
    renderWithProviders(<LoansScreen />, { route: "/loans", client: withCompanies("u1") });
    const row = await screen.findByRole("button", { name: /^הלוואת גשר, / });
    expect(row).toBeInTheDocument();
    // The next payment is the answer's, and the band reads the same query.
    expect(await screen.findByText(/התשלום הבא · הלוואת גשר/)).toBeInTheDocument();
    expect(db.outlookCalls).toEqual([{ p_today: israelToday() }]);
  });

  it("shows the usual failed state with retry when loan_outlooks fails, and the list when it answers again (FLOW-1316)", async () => {
    db.outlooksFail = true;
    renderWithProviders(<LoansScreen />, { route: "/loans", client: withCompanies("u1") });
    expect(await screen.findByText(LOANS_ERROR_TITLE)).toBeInTheDocument();
    db.outlooksFail = false;
    fireEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    expect(await screen.findByRole("button", { name: /^הלוואת גשר, / })).toBeInTheDocument();
    expect(db.outlookCalls).toHaveLength(2);
  });

  it("offline on a new day, with the list kept and no outlooks for today, draws the loans and the offline line, never the empty state (FLOW-1337)", async () => {
    const client = withCompanies("u1");
    // Yesterday's outlooks sit under yesterday's key: today's read has no data and, offline, never starts.
    await client.prefetchQuery({ queryKey: ["loans", TEST_COMPANY_ID, "list"], queryFn: () => readLoanList(TEST_COMPANY_ID) });
    onlineManager.setOnline(false);
    try {
      renderWithProviders(<LoansScreen />, { route: "/loans", client });
      expect(await screen.findByRole("button", { name: /^הלוואת גשר, / })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^הלוואת ציוד, / })).toBeInTheDocument();
      expect(screen.queryByText(/אין הלוואות/)).not.toBeInTheDocument();
      expect(screen.queryByText(LOANS_ERROR_TITLE)).not.toBeInTheDocument();
      expect(screen.getByText(/אין חיבור/)).toBeInTheDocument();
      expect(db.outlookCalls).toEqual([]);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("shows each loan in its own currency, read from the loan and not from its balance (FLOW-1261)", async () => {
    answers.loans = [{ ...loanRow("l1", "הלוואת גשר", "p1"), currency: "USD" }, loanRow("l2", "הלוואת ציוד", null)];
    answers.loan_balances = [{ loan_id: "l1", balance_minor: 4_000_000, flagged_parts: 0 }];
    const list = await readLoanList(TEST_COMPANY_ID);
    expect(list.rows.map((row) => [row.name, row.currency])).toEqual([["הלוואת גשר", "USD"], ["הלוואת ציוד", "ILS"]]);
    const balances = db.selects.find((select) => select.table === "loan_balances");
    expect(balances?.columns).not.toContain("currency");
  });

  it("reads the company currency once for Home and Loans: a visit after Home sends no currency request (FLOW-1298)", async () => {
    db.currency = "USD";
    const client = withCompanies("u1");
    // Home's read, under its own key.
    await client.query(companyCurrencyQueryOptions("off"));
    renderWithProviders(<LoansScreen />, { route: "/loans", client });
    expect(await screen.findByRole("button", { name: /^הלוואת גשר, / })).toBeInTheDocument();
    expect(db.rpc.filter((name) => name === "mcp_company_loan_currency")).toHaveLength(1);
  });

  it("lists the loans with the company the app holds, without waiting for get_dashboard", async () => {
    renderWithProviders(<LoansScreen />, { route: "/loans", client: withCompanies("u1") });
    expect(await screen.findByRole("button", { name: /^הלוואת גשר, / })).toHaveTextContent("בית הברוש");
    expect(screen.getByRole("button", { name: /^הלוואת ציוד, / })).toBeInTheDocument();
  });

  it("goes to Settings when list_my_companies says there is no company", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/settings" element={<h1>הגדרות</h1>} />
        <Route path="/loans" element={<LoansScreen />} />
      </Routes>,
      { route: "/loans", client: withCompanies(null) },
    );
    expect(await screen.findByRole("heading", { name: "הגדרות" })).toBeInTheDocument();
  });
});
