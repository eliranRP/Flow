import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { SKELETON_DELAY_MS } from "../ui/skeleton";
import { CompanyProfitScreen } from "./company-profit-screen";

// FLOW-1322: in December there is no month left in the year, so the year view's rest-of-year card is nothing to wait
// for: no skeleton stays and no company_forecast read goes out. In any other month the card still loads. Invented data only.
type Calls = { names: string[]; args: Record<string, unknown[]>; answer: Record<string, unknown> };
const calls = vi.hoisted((): Calls => ({ names: [], args: {}, answer: {} }));
const clock = vi.hoisted(() => ({ today: "2026-12-10" }));

vi.mock("../ui/date-math", async (importOriginal) => ({ ...(await importOriginal<typeof import("../ui/date-math")>()), israelToday: () => clock.today }));
vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: Record<string, unknown>) => {
      calls.names.push(name);
      (calls.args[name] ??= []).push(args);
      if (!(name in calls.answer)) return Promise.resolve({ data: null, error: new Error(`unmocked ${name}`) });
      const answer = calls.answer[name];
      return Promise.resolve({ data: typeof answer === "function" ? (answer as (args?: Record<string, unknown>) => unknown)(args) : answer, error: null });
    },
    from: (table: string) => ({
      select: () => ({
        maybeSingle: () => {
          calls.names.push(`from:${table}`);
          return Promise.resolve({ data: { overhead_project_id: null, overhead: null }, error: null });
        },
      }),
    }),
  }),
}));
vi.mock("../wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

/** company_forecast's 'totals' for the months asked (FLOW-1307's shape): one project's expected month each. */
function forecastTotals(args?: Record<string, unknown>) {
  const facts = { rows: 1, recurring: 1, rent: 1 };
  const months = (args?.p_months as string[]).map((month) => ({ month, income_minor: 300000, expense_minor: 120000, net_minor: 180000, cash_only_minor: 0, projects: 1, general: false, income: facts }));
  return { today: args?.p_today, currency: "USD", months, income: facts };
}

/** get_profit_months since the start: the year views draw from it (FLOW-1191). */
function profitMonths() {
  const row = { currency: "USD", income_minor: 150000, expense_minor: 120000, profit_minor: 30000 };
  return {
    basis: "cash", from: "2006-12-01", to: "2026-12-10", by_currency: [row],
    months: [{ month: "2026-12", from: "2026-12-01", to: "2026-12-10", open: true, by_currency: [row] }],
  };
}

/** Lets the delayed skeleton's timer run out, and the render after it, so a skeleton that stays is drawn. */
async function afterSkeletonDelay() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, SKELETON_DELAY_MS * 3)); });
}

beforeEach(() => {
  calls.names.length = 0;
  calls.args = {};
  clock.today = "2026-12-10";
  calls.answer = { get_profit_months: profitMonths, company_forecast: forecastTotals };
});

describe("CompanyProfitScreen in December (FLOW-1322)", () => {
  it.each(["year", "all"])("the %s view draws its figures with no skeleton left and asks for no company_forecast", async (period) => {
    renderWithProviders(<CompanyProfitScreen />, { route: `/profit?period=${period}` });
    expect(await screen.findByText(/נספר לפי/)).toBeInTheDocument();
    await afterSkeletonDelay();
    expect(document.querySelector(".ui-fc-card")).toBeNull();
    expect(document.querySelector(".ui-skeleton-bar")).toBeNull();
    expect(calls.names).toContain("get_profit_months");
    expect(calls.names).not.toContain("company_forecast");
  });

  it("the year view in November still loads its card from the one month left", async () => {
    clock.today = "2026-11-24";
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?period=year" });
    expect(await screen.findByText("סוף 2026")).toBeInTheDocument();
    await waitFor(() => { expect(calls.names).toContain("company_forecast"); });
    expect(calls.args.company_forecast).toEqual([{ p_months: ["2026-12"], p_detail: "totals", p_today: "2026-11-24" }]);
  });
});
