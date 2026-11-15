import { QueryClient } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompanyNextMonth } from "./company-next-month-query";
import { QUERY_STALE_MS } from "./query-client";
import { renderWithProviders } from "./test-render";

// FLOW-1195: the year view (withRest) takes every month's skips from company_next_month_inputs' `skips`, so it sends
// no forecast_overrides_for at all, in January (eleven months left) as in November. FLOW-1202: so do next month's own
// card (the slim answer carries next month's skips) and a later month's page (skips[month]); only a page that can skip
// a row reads the month's override rows, for the skip's undo. Invented answers only; "today" is 2026-01-15, so next
// month is February.
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
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const today = "2026-01-15";
const POWER = "party:expense:power:ILS";
const power = {
  direction: "expense",
  party_id: "power",
  name: "Example Power",
  currency: "ILS",
  typical_amount_minor: -18_600,
  typical_day: 5,
  months_seen: 6,
  seen_this_month: true,
  project_id: null,
  category_id: null,
  pace: "month",
  next_due_month: "2026-02",
  pays_loan: false,
};
const inputs = { month: "2026-02", overhead_project_id: null, projects: [], general: [], edits: [] };

let seen: ReturnType<typeof useCompanyNextMonth> | undefined;

function Year() {
  seen = useCompanyNextMonth("ILS", today, true, undefined, undefined, true);
  return null;
}

function Next() {
  seen = useCompanyNextMonth("ILS", today, true);
  return null;
}

function Month({ month, withOverrides = false }: { month: string; withOverrides?: boolean }) {
  seen = useCompanyNextMonth("ILS", today, true, undefined, month, false, withOverrides);
  return null;
}

function calls(name: string) {
  return rpc.calls.filter((call) => call.name === name);
}

beforeEach(() => {
  rpc.calls.length = 0;
  seen = undefined;
  rpc.answers = {
    // The lean form of expected_months: no months[] (FLOW-1193).
    expected_months: { today, project_id: null, recurring: [power] },
    list_categories: [],
    forecast_overrides_for: [{ item_key: POWER, amount_minor: null, due_on: null, moved_out: true }],
    company_next_month_inputs: { ...inputs, rest_edits: [], skips: { "2026-03": [POWER] } },
  };
});

describe("the year view reads the skips once, with the answer (FLOW-1195)", () => {
  it("sends one company_next_month_inputs and no forecast_overrides_for, and counts each month's skips", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_MS } } });
    renderWithProviders(<Year />, { route: "/", client });
    await waitFor(() => { expect(seen?.rest).not.toBeNull(); });
    expect(calls("forecast_overrides_for")).toHaveLength(0);
    expect(calls("company_next_month_inputs")).toHaveLength(1);
    expect(calls("company_next_month_inputs")[0]?.args).toEqual({ p_today: today, p_rest: true });
    // February counts the charge; March (a skip in its list) does not; April counts it again.
    expect(seen?.rest?.months.slice(0, 3).map((month) => [month.month, month.expenseMinor])).toEqual([
      ["2026-02", 18_600n],
      ["2026-03", 0n],
      ["2026-04", 18_600n],
    ]);
    expect(seen?.input?.skips).toEqual([]);
  });

  it("next month's own card sends no forecast_overrides_for and counts the skip from its first answer (FLOW-1202)", async () => {
    rpc.answers.company_next_month_inputs = { ...inputs, skips: { "2026-02": [POWER] } };
    renderWithProviders(<Next />, { route: "/", client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
    await waitFor(() => { expect(seen?.forecast).not.toBeNull(); });
    // The first figure it draws is the final one: it never counted the charge before the skips arrived.
    expect(seen?.forecast?.expenseMinor).toBe(0n);
    expect(seen?.input?.skips).toEqual([POWER]);
    expect(calls("forecast_overrides_for")).toHaveLength(0);
    expect(calls("company_next_month_inputs")).toHaveLength(1);
    expect(calls("company_next_month_inputs")[0]?.args).toEqual({ p_today: today, p_rest: false });
  });

  it("next month's card with no skip in its answer counts the charge", async () => {
    rpc.answers.company_next_month_inputs = { ...inputs, skips: {} };
    renderWithProviders(<Next />, { route: "/", client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
    await waitFor(() => { expect(seen?.forecast).not.toBeNull(); });
    expect(seen?.forecast?.expenseMinor).toBe(18_600n);
    expect(calls("forecast_overrides_for")).toHaveLength(0);
  });

  it("a later month's page sends no forecast_overrides_for and counts skips[month]", async () => {
    rpc.answers.company_next_month_inputs = { ...inputs, rest_edits: [], skips: { "2026-03": [POWER] } };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithProviders(<Month month="2026-03" />, { route: "/", client });
    await waitFor(() => { expect(seen?.forecast).not.toBeNull(); });
    expect(seen?.forecast?.month).toBe("2026-03");
    expect(seen?.forecast?.expenseMinor).toBe(0n);
    expect(calls("forecast_overrides_for")).toHaveLength(0);
    expect(calls("company_next_month_inputs")[0]?.args).toEqual({ p_today: today, p_rest: true });
  });

  it("a later month's page that can skip a row reads that month's override rows for the undo, and still counts from skips", async () => {
    rpc.answers.company_next_month_inputs = { ...inputs, rest_edits: [], skips: { "2026-03": [POWER] } };
    renderWithProviders(<Month month="2026-03" withOverrides />, { route: "/", client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
    await waitFor(() => { expect(seen?.overrides).not.toBeNull(); });
    expect(calls("forecast_overrides_for").map((call) => call.args)).toEqual([{ p_month: "2026-03" }]);
    expect(seen?.forecast?.expenseMinor).toBe(0n);
  });

  it("the slim read seeded from a cached full answer uses its skips, with no request", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_MS } } });
    client.setQueryData(["project-forecast-edits", "off", "company", today, true], { ...inputs, rest_edits: [], skips: { "2026-02": [POWER], "2026-03": [] } });
    renderWithProviders(<Next />, { route: "/", client });
    await waitFor(() => { expect(seen?.forecast).not.toBeNull(); });
    expect(seen?.forecast?.expenseMinor).toBe(0n);
    expect(calls("company_next_month_inputs")).toHaveLength(0);
    expect(calls("forecast_overrides_for")).toHaveLength(0);
  });
});
