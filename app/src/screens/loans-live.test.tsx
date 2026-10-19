import { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MY_COMPANIES_KEY } from "../company-role-cache";
import { renderWithProviders } from "../test-render";
import { myCompaniesFor, TEST_COMPANY_ID } from "../team-test-support";
import { readLoanList } from "./loan-list";
import { LoansScreen } from "./loans-screen";

// The live Loans tab: the company from what the app holds, and the list's three reads at once.

type Pending = { table: string; resolve: (value: { data: unknown; error: null }) => void };

const db = vi.hoisted(() => ({
  pending: [] as Pending[],
  rpc: [] as string[],
  hold: false,
}));

let answers: Record<string, unknown> = {};

function query(table: string) {
  const result = () => {
    if (!db.hold) return Promise.resolve({ data: answers[table] ?? [], error: null });
    return new Promise<{ data: unknown; error: null }>((resolve) => { db.pending.push({ table, resolve }); });
  };
  const next = {
    select: () => next,
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
  rpc: (name: string) => {
    db.rpc.push(name);
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
  db.hold = false;
  answers = {
    loans: [loanRow("l1", "הלוואת גשר", "p1"), loanRow("l2", "הלוואת ציוד", null)],
    loan_balances: [{ loan_id: "l1", balance_minor: 4_000_000, flagged_parts: 0, currency: "ILS" }],
    projects: [{ id: "p1", name: "בית הברוש" }],
  };
});

/** The cache as the app holds it after list_my_companies (no session in a test: the user key is null). */
function withCompanies(ownerId: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData([MY_COMPANIES_KEY, null], myCompaniesFor("u1", ownerId));
  return client;
}

describe("live Loans tab", () => {
  it("sends the loans, balances and project names reads together, before any answers", async () => {
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
