import { QueryClient, useQuery } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useResetForecastMonth, useSetForecastItem } from "./forecast-month";
import { renderWithProviders } from "./test-render";

// FLOW-1191: the month forecast's writes change forecast_overrides, which expected_months does not read, so a write
// refetches the month forecast on screen and not expected_months. (FLOW-1308 and FLOW-1315 moved the company's and the project's
// forecasts to their own reads, which the writes patch at the tap: company-forecast-skip.test.tsx, project-forecast-skip.test.tsx.)
// Invented keys only.
const rpc = vi.hoisted(() => vi.fn((_name: string, _args?: unknown) => Promise.resolve<{ data: unknown; error: unknown }>({ data: null, error: null })));
vi.mock("./lib/supabase", () => ({ getSupabase: () => ({ rpc }) }));

const reads = { forecast: 0, expected: 0, other: 0 };

function Probe() {
  const set = useSetForecastItem("2026-11");
  const reset = useResetForecastMonth("2026-11");
  useQuery({ queryKey: ["month-forecast", "off", "answer", "2026-11"], queryFn: () => { reads.forecast += 1; return Promise.resolve({}); } });
  useQuery({ queryKey: ["month-forecast", "off", "answer", "2026-12"], queryFn: () => { reads.other += 1; return Promise.resolve({}); } });
  useQuery({ queryKey: ["expected-months", "off", "company", 0], queryFn: () => { reads.expected += 1; return Promise.resolve({}); } });
  return (
    <>
      <button type="button" onClick={() => { set.mutate({ key: "party:expense:power:USD", patch: { moved_out: true }, undo: false, prior: null }); }}>set</button>
      <button type="button" onClick={() => { reset.mutate(); }}>reset</button>
    </>
  );
}

describe("the month forecast's writes (FLOW-1191, FLOW-1201)", () => {
  it.each(["set", "reset"])("%s refetches the written month's forecast answer on screen, and not expected_months or another month's", async (name) => {
    reads.forecast = 0;
    reads.expected = 0;
    reads.other = 0;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithProviders(<Probe />, { client });
    await waitFor(() => { expect(reads).toEqual({ forecast: 1, expected: 1, other: 1 }); });
    fireEvent.click(screen.getByRole("button", { name }));
    await waitFor(() => { expect(reads.forecast).toBe(2); });
    await waitFor(() => { expect(client.isFetching()).toBe(0); });
    expect(reads.forecast).toBe(2);
    expect(reads.expected).toBe(1);
    // FLOW-1323: only the written month's answer is read again, not another month's.
    expect(reads.other).toBe(1);
  });
});
