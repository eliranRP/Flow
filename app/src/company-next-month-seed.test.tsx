import { QueryClient } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompanyNextMonth } from "./company-next-month-query";
import { QUERY_STALE_MS } from "./query-client";
import { FORECAST_EDITS_KEY } from "./project-next-month-query";
import { renderWithProviders } from "./test-render";
import { israelToday } from "./ui/date-math";

// FLOW-1191: the slim company_next_month_inputs (no p_rest) starts from the full answer cached for the same day: the
// full one holds every field of the slim one, plus rest_edits. Invented answers only.
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
const next = `${today.slice(0, 7)}-next`;
const slimKey = [FORECAST_EDITS_KEY, "off", "company", today, false];
const fullKey = [FORECAST_EDITS_KEY, "off", "company", today, true];
const seeded = { month: next, overhead_project_id: null, projects: [], general: [], edits: [], rest_edits: [] };

function Probe() {
  useCompanyNextMonth("ILS", today, true);
  return null;
}

function inputCalls() {
  return rpc.calls.filter((call) => call.name === "company_next_month_inputs");
}

beforeEach(() => {
  rpc.calls.length = 0;
  rpc.answers = {
    mcp_company_loan_currency: "ILS",
    expected_months: { today, project_id: null, months: [], recurring: [] },
    forecast_overrides_for: [],
    list_unpaid: [],
    company_next_month_inputs: { month: next, overhead_project_id: null, projects: [], general: [], edits: [] },
  };
});

describe("the slim company inputs start from the full answer (FLOW-1191)", () => {
  it("a fresh full answer for the same day serves the slim read: it holds the full data and sends no request", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_MS } } });
    client.setQueryData(fullKey, seeded);
    renderWithProviders(<Probe />, { route: "/", client });
    await waitFor(() => { expect(rpc.calls.some((call) => call.name === "forecast_overrides_for")).toBe(true); });
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(client.getQueryData(slimKey)).toEqual(seeded);
    expect(inputCalls()).toHaveLength(0);
  });

  it("a stale full answer shows at once and the slim read still goes out, its answer replacing it", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_MS } } });
    client.setQueryData(fullKey, seeded, { updatedAt: Date.now() - QUERY_STALE_MS - 1000 });
    renderWithProviders(<Probe />, { route: "/", client });
    await waitFor(() => { expect(inputCalls()).toHaveLength(1); });
    expect(inputCalls()[0]?.args).toEqual({ p_today: today, p_rest: false });
    await waitFor(() => { expect(client.getQueryData(slimKey)).not.toHaveProperty("rest_edits"); });
  });
});
