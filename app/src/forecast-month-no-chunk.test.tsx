import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompanyMonthRows } from "./company-forecast-query";
import { useSetForecastItem } from "./forecast-month";
import { useForecastOverrides } from "./forecast-skip";
import { useMonthForecastQuery } from "./month-forecast-query";
import { QUERY_STALE_MS } from "./query-client";
import { renderWithProviders } from "./test-render";

// FLOW-1341 (review): the settle chunk cannot load (a tab on an old build, its files gone). An accepted skip must still end with the month's
// overrides, answer and the company forecast read again, and nothing unhandled. Invented keys only.
vi.mock("./forecast-month-settle", () => { throw new Error("chunk gone"); });
type Answer = { data: unknown; error: unknown };
const server = vi.hoisted(() => ({ calls: [] as string[], write: [] as Array<(answer: Answer) => void> }));
vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string) => {
      server.calls.push(name);
      if (name === "set_forecast_item") return new Promise<Answer>((resolve) => { server.write.push(resolve); });
      if (name === "month_forecast") return Promise.resolve({ data: { month: MONTH, base: "ILS", build: { items: [], income: [], expense: [], moved: [], small: [], incomeTotal: 0, expenseTotal: 0, changed: 0 }, overrides: [] }, error: null });
      if (name === "company_forecast") return Promise.resolve({ data: { today: TODAY, currency: "USD", months: [], income: { rows: 0, recurring: 0, rent: 0, name: null }, split_keys: [] }, error: null });
      return Promise.resolve({ data: [], error: null });
    },
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const TODAY = "2026-11-24";
const MONTH = "2026-12";
const count = (name: string) => server.calls.filter((call) => call === name).length;

function Home() {
  useMonthForecastQuery(MONTH);
  useForecastOverrides(MONTH, true);
  useCompanyMonthRows(TODAY, MONTH, true, false);
  const set = useSetForecastItem(MONTH);
  return <button type="button" onClick={() => { set.mutate({ key: "party:expense:power:USD", patch: { moved_out: true }, undo: false, prior: null }); }}>skip</button>;
}

beforeEach(() => { server.calls.length = 0; server.write.length = 0; });

describe("a skip when the settle chunk cannot load (FLOW-1341)", () => {
  it("reads the month's overrides, answer and the company forecast again once the write is accepted", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_MS } } });
    renderWithProviders(<Home />, { client });
    await waitFor(() => { expect(client.isFetching()).toBe(0); });
    expect(count("company_forecast")).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(server.write).toHaveLength(1); });
    expect(count("month_forecast")).toBe(1);
    server.write[0]?.({ data: null, error: null });
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    await waitFor(() => { expect([count("forecast_overrides_for"), count("month_forecast"), count("company_forecast")]).toEqual([2, 2, 2]); });
  });
});
