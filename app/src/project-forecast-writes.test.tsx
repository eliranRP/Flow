import { QueryClient, useQuery } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectForecastOf, type ProjectForecastRead } from "./project-forecast-map";
import { projectForecastKey } from "./project-forecast-query";
import { SAMPLE_MONTH, SAMPLE_TODAY, sampleProjectForecastAnswer } from "./project-forecast-sample";
import { useProjectForecastWrites } from "./project-forecast-writes";
import { renderWithProviders } from "./test-render";
import { TOP_UNDO_MS } from "./ui/top-toast";

const rpc = vi.hoisted(() => vi.fn((_name: string, _args?: unknown) => Promise.resolve<{ data: unknown; error: unknown }>({ data: null, error: null })));
vi.mock("./lib/supabase", () => ({ getSupabase: () => ({ rpc }) }));

afterEach(() => {
  vi.useRealTimers();
  rpc.mockReset();
  rpc.mockImplementation(() => Promise.resolve({ data: null, error: null }));
});

// FLOW-1315: the project's forecast the page holds (project_forecast), which a removal changes at once.
const KEY = projectForecastKey("off", "juniper-ct", SAMPLE_MONTH, SAMPLE_TODAY, null);
const held = () => projectForecastOf(sampleProjectForecastAnswer(), "juniper-ct");

function Probe() {
  const writes = useProjectForecastWrites("juniper-ct", "2026-11");
  const under = useRef<(() => void) | null>(null);
  return (
    <>
      <button type="button" onClick={() => { under.current = writes.mutateUnder({ fn: "set_project_forecast_edit", edit: { row_key: "add:e-1", pace: "month" } }); }}>pace</button>
      <button type="button" onClick={() => { under.current?.(); }}>undo pace</button>
      <button type="button" onClick={() => { writes.mutate({ fn: "remove_project_forecast_row", rowKey: "rec:expense:power", message: "הוסר מהצפי: חשמל ומים" }); }}>remove</button>
      <button type="button" onClick={() => { writes.mutate({ fn: "reset_project_forecast", message: "הצפי חזר לחישוב" }); }}>reset</button>
    </>
  );
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(KEY, held());
  renderWithProviders(<Probe />, { client });
  return client;
}

describe("useProjectForecastWrites (decision 0219)", () => {
  it("takes a removed row off the list before the server answers", async () => {
    rpc.mockImplementation(() => new Promise(() => undefined));
    const client = renderProbe();
    fireEvent.click(screen.getByRole("button", { name: "remove" }));
    await waitFor(() => {
      expect(client.getQueryData<ProjectForecastRead>(KEY)?.forecast.removed.map((row) => row.key)).toEqual(["rec:expense:power"]);
    });
    const after = client.getQueryData<ProjectForecastRead>(KEY);
    // The row leaves the list and the totals; the income and the rest of the rows stay.
    expect(after?.forecast.rows.map((row) => row.key)).toEqual(["rec:income:ortiz", "rec:income:kim", "avg:repairs", "avg:none"]);
    expect([after?.forecast.incomeMinor, after?.forecast.expenseMinor, after?.forecast.netMinor]).toEqual([415_000n, 34_000n, 381_000n]);
    expect(rpc).toHaveBeenCalledWith("remove_project_forecast_row", expect.objectContaining({ p_row_key: "rec:expense:power" }));
  });

  it("puts the row back and says so when the removal fails", async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: "boom" } }));
    const client = renderProbe();
    fireEvent.click(screen.getByRole("button", { name: "remove" }));
    expect(await screen.findByText("לא הצלחנו לעדכן את הצפי")).toBeTruthy();
    expect(client.getQueryData(KEY)).toEqual(held());
  });

  it("keeps a removal's ביטול 5s and a plain note 4s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "remove_project_forecast_row" ? { undo: { drop: ["e-1"], put: [] } } : null, error: null }));
    renderProbe();
    fireEvent.click(screen.getByRole("button", { name: "remove" }));
    await screen.findByText("הוסר מהצפי: חשמל ומים");
    expect(screen.getByRole("button", { name: "ביטול" })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(TOP_UNDO_MS - 500); });
    expect(screen.queryByText("הוסר מהצפי: חשמל ומים")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1500); });
    await waitFor(() => { expect(screen.queryByText("הוסר מהצפי: חשמל ומים")).toBeNull(); });

    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    await screen.findByText("הצפי חזר לחישוב");
    act(() => { vi.advanceTimersByTime(3500); });
    expect(screen.queryByText("הצפי חזר לחישוב")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1500); });
    await waitFor(() => { expect(screen.queryByText("הצפי חזר לחישוב")).toBeNull(); });
  });

  it("hands a write's undo to another toast: none of its own, and the undo is sent once (FLOW-1018)", async () => {
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "set_project_forecast_edit" ? { undo: { drop: ["e-9"], put: [] } } : null, error: null }));
    renderProbe();
    fireEvent.click(screen.getByRole("button", { name: "pace" }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith("set_project_forecast_edit", expect.anything()); });
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(screen.queryByRole("button", { name: "ביטול" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "undo pace" }));
    fireEvent.click(screen.getByRole("button", { name: "undo pace" }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith("undo_project_forecast", { p_project_id: "juniper-ct", p_undo: { drop: ["e-9"], put: [] } }); });
    expect(rpc.mock.calls.filter(([name]) => name === "undo_project_forecast")).toHaveLength(1);
  });

  it("a forecast edit refetches the forecast on screen, not expected_months, which reads no edits (FLOW-1191)", async () => {
    const reads = { forecast: 0, expected: 0 };
    function Reads() {
      useQuery({ queryKey: ["month-forecast", "off", "2026-11"], queryFn: () => { reads.forecast += 1; return Promise.resolve({}); } });
      useQuery({ queryKey: ["expected-months", "off", "project", "juniper-ct", 0], queryFn: () => { reads.expected += 1; return Promise.resolve({}); } });
      return null;
    }
    renderWithProviders(<><Probe /><Reads /></>, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
    await waitFor(() => { expect(reads).toEqual({ forecast: 1, expected: 1 }); });
    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    await waitFor(() => { expect(reads.forecast).toBe(2); });
    expect(reads.expected).toBe(1);
  });
});
