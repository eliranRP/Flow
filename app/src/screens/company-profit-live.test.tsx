import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { CompanyProfitScreen } from "./company-profit-screen";

// The page's live path for a past month (owner 21/10): the reads answer from a mocked client. Invented data only.
type Calls = { names: string[]; answer: Record<string, unknown>; company: { data: unknown; error: unknown } };
const calls = vi.hoisted((): Calls => ({ names: [], answer: {}, company: { data: null, error: null } }));

vi.mock("../ui/date-math", async (importOriginal) => ({ ...(await importOriginal<typeof import("../ui/date-math")>()), israelToday: () => "2026-10-20" }));
vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: Record<string, unknown>) => {
      calls.names.push(name);
      const key = name === "get_breakdown" ? `${name}:${String(args?.p_group_by)}:${String(args?.p_direction)}` : name;
      return Promise.resolve(key in calls.answer ? { data: calls.answer[key], error: null } : { data: null, error: new Error(`unmocked ${key}`) });
    },
    from: (table: string) => ({
      select: () => ({
        maybeSingle: () => {
          calls.names.push(`from:${table}`);
          return Promise.resolve(calls.company);
        },
      }),
    }),
  }),
}));
vi.mock("../wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

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
  calls.names.length = 0;
  calls.answer = {
    mcp_company_loan_currency: "USD",
    get_dashboard: dashboard,
  };
  calls.company = { data: { overhead_project_id: OVERHEAD, overhead: { id: OVERHEAD, name: "כללי" } }, error: null };
});

function answerBreakdowns() {
  // July: the overhead-role costs under `overhead`, the overhead project's own income under its id.
  calls.answer["get_breakdown:project:expense"] = breakdown("expense", [
    { key: "overhead", name: null, amount: 60000, count: 8 },
    { key: PROJECT, name: "בית הדקל", amount: 60000, count: 2 },
  ]);
  calls.answer["get_breakdown:project:income"] = breakdown("income", [
    { key: PROJECT, name: "בית הדקל", amount: 120000, count: 1 },
    { key: OVERHEAD, name: "כללי", amount: 30000, count: 6 },
  ]);
  calls.answer["get_breakdown:category:expense"] = { ...breakdown("expense", []), group_by: "category" };
  calls.answer["get_breakdown:category:income"] = { ...breakdown("income", []), group_by: "category" };
}

describe("CompanyProfitScreen live, a past month (owner 21/10)", () => {
  it("July by project: the overhead project's id group and the general costs are one row under its name", async () => {
    answerBreakdowns();
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07" });
    const rows = await waitFor(() => {
      const found = [...document.querySelectorAll(".ui-cp-list .ui-cp-row")];
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    const named = rows.filter((row) => row.textContent.includes("כללי"));
    expect(named).toHaveLength(1);
    expect(named[0]?.querySelector("a")?.getAttribute("href")).toBe(`/projects/${OVERHEAD}/profit?from=profit`);
  });

  it("reads the overhead project from the company's row, never the Projects list's heavy read", async () => {
    answerBreakdowns();
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07" });
    await screen.findAllByText("כללי");
    expect(calls.names).toContain("from:companies");
    expect(calls.names).not.toContain("projects_cash_month");
  });

  it("with no overhead project set, the general costs are an untappable כללי row and the project keeps its own row", async () => {
    answerBreakdowns();
    calls.company = { data: { overhead_project_id: null, overhead: null }, error: null };
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07" });
    await waitFor(() => { expect(document.querySelectorAll(".ui-cp-list .ui-cp-row").length).toBe(3); });
    const general = [...document.querySelectorAll(".ui-cp-list .ui-cp-row")].filter((row) => row.querySelector("a") == null);
    expect(general.map((row) => row.querySelector(".ui-cp-name")?.textContent)).toEqual(["כללי"]);
  });

  it("a company read with no row is the page's error with a retry, never a silent split", async () => {
    answerBreakdowns();
    calls.company = { data: null, error: null };
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-07" });
    expect(await screen.findByRole("button", { name: "נסו שוב" })).toBeTruthy();
    expect(document.querySelectorAll(".ui-cp-list .ui-cp-row")).toHaveLength(0);
  });

  it("the current month merges the same way", async () => {
    answerBreakdowns();
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit" });
    const named = await waitFor(() => {
      const found = [...document.querySelectorAll(".ui-cp-list .ui-cp-row")].filter((row) => row.textContent.includes("כללי"));
      expect(found).toHaveLength(1);
      return found;
    });
    expect(named[0]?.querySelector("a")?.getAttribute("href")).toBe(`/projects/${OVERHEAD}/profit?from=profit`);
  });
});
