import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useForecastOverrides } from "./forecast-skip";
import { useSetForecastItem } from "./forecast-month";
import { useMonthForecastQuery } from "./month-forecast-query";
import { QUERY_STALE_MS } from "./query-client";
import { renderWithProviders } from "./test-render";

// FLOW-1341: a burst of skips of one month (the writes of its scope run one after another) reads the month's overrides and its answer once,
// when the last write has settled, not after each write. Invented keys only.
type Answer = { data: unknown; error: unknown };
const server = vi.hoisted(() => ({ calls: [] as string[], writes: [] as Array<(answer: Answer) => void> }));
vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string) => {
      server.calls.push(name);
      if (name === "set_forecast_item") return new Promise<Answer>((resolve) => { server.writes.push(resolve); });
      if (name === "month_forecast") return Promise.resolve({ data: { month: MONTH, base: "ILS", build: { items: [], income: [], expense: [], moved: [], small: [], incomeTotal: 0, expenseTotal: 0, changed: 0 }, overrides: [] }, error: null });
      return Promise.resolve({ data: [], error: null });
    },
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const MONTH = "2026-12";
const KEYS = ["party:expense:power:USD", "party:expense:water:USD", "party:expense:gas:USD"];
const count = (name: string) => server.calls.filter((call) => call === name).length;
const ok: Answer = { data: null, error: null };

function Home() {
  useMonthForecastQuery(MONTH);
  useForecastOverrides(MONTH, true);
  const set = useSetForecastItem(MONTH);
  return <button type="button" onClick={() => { for (const key of KEYS) set.mutate({ key, patch: { moved_out: true }, undo: false, prior: null }); }}>skip three</button>;
}

beforeEach(() => {
  server.calls.length = 0;
  server.writes.length = 0;
});

describe("a burst of skips reads once (FLOW-1341)", () => {
  it("sends one round of forecast_overrides_for and month_forecast after the third write, none after the first two", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_MS } } });
    renderWithProviders(<Home />, { client });
    await waitFor(() => { expect(count("month_forecast")).toBe(1); });
    await waitFor(() => { expect(client.isFetching()).toBe(0); });
    fireEvent.click(screen.getByRole("button", { name: "skip three" }));
    await waitFor(() => { expect(server.writes).toHaveLength(1); });
    server.writes[0]?.(ok);
    await waitFor(() => { expect(server.writes).toHaveLength(2); });
    server.writes[1]?.(ok);
    await waitFor(() => { expect(server.writes).toHaveLength(3); });
    // Two writes are done and the third is out: nothing is read yet.
    expect([count("forecast_overrides_for"), count("month_forecast")]).toEqual([1, 1]);
    server.writes[2]?.(ok);
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    await waitFor(() => { expect([count("forecast_overrides_for"), count("month_forecast")]).toEqual([2, 2]); });
    await waitFor(() => { expect(client.isFetching()).toBe(0); });
    expect([count("forecast_overrides_for"), count("month_forecast")]).toEqual([2, 2]);
  });
});
