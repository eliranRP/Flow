import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompanyNextMonth } from "./company-next-month-query";
import { useMonthForecastQuery } from "./month-forecast-query";
import { renderWithProviders } from "./test-render";
import { israelToday } from "./ui/date-math";

// FLOW-1171: Home's forecast (useMonthForecastQuery) and the profit page's next month (useCompanyNextMonth) read
// expected_months once between them. Invented answers only.
const rpc = vi.hoisted((): { calls: Array<{ name: string; args: unknown }>; answers: Record<string, unknown> } => ({
  calls: [],
  answers: {},
}));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return Promise.resolve({ data: rpc.answers[name] ?? null, error: null });
    },
    from: () => ({
      select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
    }),
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const today = israelToday();
const month = today.slice(0, 7);

function Probe() {
  useMonthForecastQuery(month);
  useCompanyNextMonth("ILS", today, true);
  return null;
}

beforeEach(() => {
  rpc.calls.length = 0;
  rpc.answers = {
    mcp_company_loan_currency: "ILS",
    expected_months: { today, project_id: null, months: [], recurring: [] },
    company_forecast_edits_for: { month, overhead_project_id: null, edits: [] },
    forecast_overrides_for: [],
    list_unpaid: [],
  };
});

describe("expected_months is read once for Home's forecast and the company card (FLOW-1171)", () => {
  it("one request serves both, with the same key and arguments", async () => {
    renderWithProviders(<Probe />, { route: "/" });
    // The forecast's reads and the company's inputs have gone out; the shared read's call follows a tick behind.
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "forecast_overrides_for")).toBe(true);
      expect(rpc.calls.some((call) => call.name === "company_next_month_inputs")).toBe(true);
    });
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    const expected = rpc.calls.filter((call) => call.name === "expected_months");
    expect(expected).toHaveLength(1);
    expect(expected[0]?.args).toEqual({ p_months: 0 });
  });
});
