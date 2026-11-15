import { QueryClient, useQuery } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useResetForecastMonth, useSetForecastItem } from "./forecast-month";
import { renderWithProviders } from "./test-render";
import { FORECAST_EDITS_KEY } from "./project-next-month-query";

// FLOW-1191: the month forecast's writes change forecast_overrides, which expected_months does not read, so a write
// refetches the month forecast on screen and not expected_months. FLOW-1201: a write does not refetch the company
// inputs either (the year view's skips are read only on Company profit's year views, which are never on screen
// when a skip is written). The write drops those inputs while no screen holds them, so the year view loads fresh and
// never shows the pre-write figures. Invented keys only.
const rpc = vi.hoisted(() => vi.fn((_name: string, _args?: unknown) => Promise.resolve<{ data: unknown; error: unknown }>({ data: null, error: null })));
vi.mock("./lib/supabase", () => ({ getSupabase: () => ({ rpc }) }));

const reads = { forecast: 0, expected: 0, inputs: 0 };
const INPUTS_KEY = [FORECAST_EDITS_KEY, "off", "company", "2026-11-14", true];

function Probe() {
  const set = useSetForecastItem("2026-11");
  const reset = useResetForecastMonth("2026-11");
  useQuery({ queryKey: ["month-forecast", "off", "2026-11"], queryFn: () => { reads.forecast += 1; return Promise.resolve({}); } });
  useQuery({ queryKey: ["expected-months", "off", "company", 0], queryFn: () => { reads.expected += 1; return Promise.resolve({}); } });
  useQuery({ queryKey: INPUTS_KEY, queryFn: () => { reads.inputs += 1; return Promise.resolve({}); } });
  return (
    <>
      <button type="button" onClick={() => { set.mutate({ key: "party:expense:power:USD", patch: { moved_out: true }, undo: false, prior: null }); }}>set</button>
      <button type="button" onClick={() => { reset.mutate(); }}>reset</button>
    </>
  );
}

function WriteOnly() {
  const set = useSetForecastItem("2026-11");
  return <button type="button" onClick={() => { set.mutate({ key: "party:expense:power:USD", patch: { moved_out: true }, undo: false, prior: null }); }}>set</button>;
}

function CompanyInputsOnly() {
  useQuery({ queryKey: INPUTS_KEY, queryFn: () => { reads.inputs += 1; return Promise.resolve({}); } });
  return null;
}

describe("the month forecast's writes (FLOW-1191, FLOW-1201)", () => {
  it.each(["set", "reset"])("%s refetches the month forecast, not expected_months or a mounted company inputs read", async (name) => {
    reads.forecast = 0;
    reads.expected = 0;
    reads.inputs = 0;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithProviders(<Probe />, { client });
    await waitFor(() => { expect(reads).toEqual({ forecast: 1, expected: 1, inputs: 1 }); });
    fireEvent.click(screen.getByRole("button", { name }));
    await waitFor(() => { expect(reads.forecast).toBe(2); });
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    expect(reads.inputs).toBe(1);
    expect(reads.expected).toBe(1);
  });

  it("a write marks the company inputs stale, so they refetch when they mount again", async () => {
    reads.inputs = 0;
    reads.forecast = 0;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderWithProviders(<Probe />, { client });
    await waitFor(() => { expect(reads.inputs).toBe(1); });
    fireEvent.click(screen.getByRole("button", { name: "set" }));
    await waitFor(() => { expect(reads.forecast).toBe(2); });
    expect(client.getQueryState(INPUTS_KEY)?.isInvalidated).toBe(true);
    view.unmount();
    renderWithProviders(<CompanyInputsOnly />, { client });
    await waitFor(() => { expect(reads.inputs).toBe(2); });
  });

  it("a write drops company inputs no screen holds, so the year view never shows the pre-write figures", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(INPUTS_KEY, { stale: true });
    renderWithProviders(<WriteOnly />, { client });
    fireEvent.click(screen.getByRole("button", { name: "set" }));
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    await waitFor(() => { expect(client.getQueryData(INPUTS_KEY)).toBeUndefined(); });
  });
});
