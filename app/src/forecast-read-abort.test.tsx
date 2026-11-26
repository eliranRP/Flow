import { QueryClient } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCompanyForecastRows, useCompanyForecastTotals } from "./company-forecast-query";
import { useMonthForecastQuery } from "./month-forecast-query";
import { useProjectForecast } from "./project-forecast-query";
import { renderWithProviders } from "./test-render";

// FLOW-1341: a forecast read that React Query cancels (a skip's tap, a screen that goes) stops its request: the read's abort signal goes to
// the Supabase call, so a cancelled 102 KB company_forecast does not keep downloading. Invented keys only.
const sent = vi.hoisted(() => ({ signals: new Map<string, AbortSignal>() }));
vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    // A request that never answers: only its signal says anything.
    rpc: (name: string, args?: { p_detail?: string }) => ({
      abortSignal: (signal: AbortSignal) => {
        sent.signals.set(args?.p_detail == null ? name : `${name}:${args.p_detail}`, signal);
        return new Promise(() => undefined);
      },
    }),
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const TODAY = "2026-11-24";
const MONTH = "2026-12";

function Reads() {
  useCompanyForecastRows(TODAY, MONTH, true);
  useCompanyForecastTotals(TODAY, [MONTH], true);
  useMonthForecastQuery(MONTH);
  useProjectForecast("p1", MONTH, TODAY, null, true);
  return null;
}

describe("a cancelled forecast read aborts its request (FLOW-1341)", () => {
  it("passes each read's signal to the call, and aborts it when the read is cancelled", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithProviders(<Reads />, { client });
    const names = ["company_forecast:rows", "company_forecast:totals", "month_forecast", "project_forecast"];
    await waitFor(() => { expect([...sent.signals.keys()].sort()).toEqual([...names].sort()); });
    expect([...sent.signals.values()].map((signal) => signal.aborted)).toEqual([false, false, false, false]);
    await client.cancelQueries({ queryKey: ["month-forecast"] });
    expect([...sent.signals.values()].map((signal) => signal.aborted)).toEqual([true, true, true, true]);
  });
});
