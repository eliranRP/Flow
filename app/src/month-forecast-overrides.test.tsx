import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useForecastOverrides } from "./forecast-skip";
import { useMonthForecastQuery } from "./month-forecast-query";
import { renderWithProviders } from "./test-render";
import { israelToday } from "./ui/date-math";

// FLOW-1191: the month forecast reads the month's overrides through the one overrides query, so the project page and
// the recurring screen (useForecastOverrides) share the request. Invented answers only.
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
  useForecastOverrides(month, true);
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

describe("the month's overrides are read once for the month forecast and its other readers (FLOW-1191)", () => {
  it("one forecast_overrides_for request serves both, with the month as its argument", async () => {
    renderWithProviders(<Probe />, { route: "/" });
    await waitFor(() => { expect(rpc.calls.some((call) => call.name === "company_forecast_edits_for")).toBe(true); });
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    const overrides = rpc.calls.filter((call) => call.name === "forecast_overrides_for");
    expect(overrides).toHaveLength(1);
    expect(overrides[0]?.args).toEqual({ p_month: month });
  });
});
