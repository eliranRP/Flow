import { cleanup, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushKeptReads, keepReadsOf, resetKeptReadsForTests, restoreKeptReads } from "../kept-reads";
import { idbKeptStore } from "../kept-store";
import { resetShownCompanyForTests, setShownCompany } from "../lib/company-header";
import { renderWithProviders } from "../test-render";
import { CompanyProfitScreen } from "./company-profit-screen";

// FLOW-1278: a repeat visit to Profit. The month's reads were kept on the device; the next visit puts them back and
// reads them again behind the figures. Nothing the page draws may fall back to a skeleton while that refresh is out.
// Invented data only. `hang` makes every read wait for ever: the refresh is in flight for the whole assertion.
const calls = vi.hoisted((): { hang: boolean; started: string[] } => ({ hang: false, started: [] }));
const answers = vi.hoisted((): { rpc: Record<string, unknown>; company: unknown } => ({ rpc: {}, company: null }));

vi.mock("../ui/date-math", async (importOriginal) => ({ ...(await importOriginal<typeof import("../ui/date-math")>()), israelToday: () => "2026-10-20" }));
vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: Record<string, unknown>) => {
      const key = name === "get_breakdown" ? `${name}:${String(args?.p_group_by)}:${String(args?.p_direction)}` : name;
      calls.started.push(key);
      if (calls.hang) return new Promise(() => undefined);
      return Promise.resolve(key in answers.rpc ? { data: answers.rpc[key], error: null } : { data: null, error: new Error(`unmocked ${key}`) });
    },
    from: (table: string) => ({
      select: () => ({
        maybeSingle: () => {
          calls.started.push(`from:${table}`);
          return calls.hang ? new Promise(() => undefined) : Promise.resolve({ data: answers.company, error: null });
        },
      }),
    }),
  }),
}));
vi.mock("../wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OVERHEAD = "00000000-0000-4000-8000-0000000000aa";
const PROJECT = "00000000-0000-4000-8000-0000000000bb";

function breakdown(direction: "income" | "expense", groups: Array<{ key: string; name: string | null; amount: number; count: number }>) {
  return {
    direction, basis: "cash", group_by: "project", from: "2026-07-01", to: "2026-07-31",
    totals: [{ currency: "USD", amount_minor: groups.reduce((sum, group) => sum + group.amount, 0), count: groups.reduce((sum, group) => sum + group.count, 0) }],
    groups: groups.map((group) => ({ currency: "USD", amount_minor: group.amount, count: group.count, key: group.key, name: group.name, shared: false, projects: 1 })),
    excluded: [], review_count: 0,
  };
}

const dashboard = {
  company_id: null, name: null, vat_registered: false, basis: "cash", from: "2026-07-01", to: "2026-07-31",
  income_agorot: 0, direct_agorot: 0, shared_agorot: 0, overhead_agorot: 0, expense_agorot: 0, net_profit_agorot: 0,
  prev_income_agorot: null, prev_expense_agorot: null, prev_net_agorot: null, active_projects: 2, review_count: 0, projects: [],
  by_currency: [{ currency: "USD", income_minor: 150000, direct_minor: 60000, shared_minor: 0, overhead_minor: 60000, expense_minor: 120000, net_profit_minor: 30000, count: 17 }], base_currency: "USD",
};

beforeEach(() => {
  resetKeptReadsForTests(idbKeptStore(() => new IDBFactory()));
  resetShownCompanyForTests();
  setShownCompany(USER, COMPANY);
  calls.hang = false;
  calls.started.length = 0;
  answers.rpc = {
    mcp_company_loan_currency: "USD",
    get_dashboard: dashboard,
    "get_breakdown:project:expense": breakdown("expense", [{ key: PROJECT, name: "בית הדקל", amount: 60000, count: 2 }]),
    "get_breakdown:project:income": breakdown("income", [{ key: PROJECT, name: "בית הדקל", amount: 120000, count: 1 }]),
  };
  answers.company = { overhead_project_id: OVERHEAD, overhead: { id: OVERHEAD, name: "כללי" } };
});

afterEach(() => {
  cleanup();
  resetKeptReadsForTests();
  resetShownCompanyForTests();
});

describe("CompanyProfitScreen, a repeat visit with kept reads (FLOW-1278)", () => {
  it("draws the kept figures and rows at once and shows no skeleton while every read is refreshing", async () => {
    // The first visit: every read lands and is kept on the device.
    const first = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    keepReadsOf(first);
    const visit = renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07", client: first });
    await waitFor(() => { expect(document.querySelectorAll(".ui-cp-list .ui-cp-row").length).toBeGreaterThan(0); });
    await waitFor(() => { expect(first.isFetching()).toBe(0); });
    await flushKeptReads();
    visit.unmount();

    // The repeat visit: a new cache gets the kept reads back; every refresh stays in flight.
    const second = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await restoreKeptReads(second);
    calls.hang = true;
    calls.started.length = 0;
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07", client: second });
    await waitFor(() => { expect(second.isFetching()).toBeGreaterThan(0); });
    expect(document.querySelector(".ui-cp-figure .ui-num")).not.toBeNull();
    expect(document.querySelectorAll(".ui-cp-list .ui-cp-row").length).toBeGreaterThan(0);
    expect(document.querySelector("[aria-busy='true']")).toBeNull();
    expect(screen.queryByRole("button", { name: "נסו שוב" })).toBeNull();
    // The company's row is read again behind the figures too (the overhead project is kept with them).
    expect(calls.started).toContain("from:companies");
  });
});
