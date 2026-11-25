import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { companyCashForecast } from "./company-next-month";
import { useCompanyMonthRows } from "./company-forecast-query";
import { useSetForecastItem } from "./forecast-month";
import { QUERY_STALE_MS } from "./query-client";
import { renderWithProviders } from "./test-render";

// FLOW-1323: a skip patches the company forecast at the tap and reads only the month's overrides afterwards: no company_forecast or
// project_forecast read, and the write does not wait for one. Invented keys only.
type Answer = { data: unknown; error: unknown };
const rpc = vi.hoisted(() => ({ calls: [] as string[], hang: false }));
vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string) => {
      rpc.calls.push(name);
      if (name === "company_forecast" || name === "project_forecast") return rpc.hang ? new Promise<Answer>(() => undefined) : Promise.resolve({ data: ROWS, error: null });
      return Promise.resolve({ data: name === "forecast_overrides_for" ? [] : null, error: null });
    },
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const TODAY = "2026-11-24";
const MONTH = "2026-12";
const POWER = "party:expense:power:USD";
const FACTS = { rows: 1, recurring: 1, rent: 1, name: "Example Tenant" };
const row = (key: string, name: string, minor: number, extra: Record<string, unknown> = {}) => ({ key, kind: "recurring", direction: minor > 0 ? "income" : "expense", name, date: `${MONTH}-05`, minor, ...extra });
const ROWS = {
  today: TODAY, currency: "USD",
  months: [{
    month: MONTH, income_minor: 100_000, expense_minor: 18_600, net_minor: 81_400, cash_only_minor: 0, projects: 1, general: false, income: FACTS,
    parts: [{ cash_only_minor: 0, average_months: 3, removed: [], arrived: [], loan_cash: [], project_id: "p1", income_minor: 100_000, expense_minor: 18_600, rows: [row("rec:income:t1", "Example Tenant", 100_000, { category_id: "c-rent" }), row("rec:expense:power", "Power", -18_600)] }],
    skipped: [],
  }],
  income: FACTS, split_keys: [],
};

function Band() {
  const read = useCompanyMonthRows(TODAY, MONTH, true, true);
  const set = useSetForecastItem(MONTH);
  const cash = read.answer == null ? null : companyCashForecast(read.answer.forecast);
  return (
    <>
      <p data-testid="band">{cash == null ? "loading" : `${String(cash.netMinor)} ${String(cash.expenseMinor)}`}</p>
      <button type="button" onClick={() => { set.mutate({ key: POWER, patch: { moved_out: true }, undo: false, prior: null }); }}>skip</button>
    </>
  );
}

const count = (name: string) => rpc.calls.filter((call) => call === name).length;

beforeEach(() => {
  rpc.calls.length = 0;
  rpc.hang = false;
});

describe("a skip reads only the overrides (FLOW-1323)", () => {
  it("sends no company_forecast read, resolves without waiting for one, keeps the patched figures, and reads the month's overrides again", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_MS } } });
    renderWithProviders(<Band />, { route: "/", client });
    await waitFor(() => { expect(screen.getByTestId("band").textContent).toBe("81400 18600"); });
    await waitFor(() => { expect(count("forecast_overrides_for")).toBe(1); });
    // Were a company_forecast read sent now, it would hang: the write must not wait for it.
    rpc.hang = true;
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(screen.getByTestId("band").textContent).toBe("100000 0"); });
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    await waitFor(() => { expect(count("forecast_overrides_for")).toBe(2); });
    expect(count("company_forecast")).toBe(1);
    expect(count("project_forecast")).toBe(0);
    expect(screen.getByTestId("band").textContent).toBe("100000 0");
  });
});
