import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectForecastEdit } from "./project-next-month";
import { FORECAST_EDITS_KEY } from "./project-next-month-query";
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

const KEY = [FORECAST_EDITS_KEY, "off", "juniper-ct", "2026-11"];

function Probe() {
  const writes = useProjectForecastWrites("juniper-ct", "2026-11");
  return (
    <>
      <button type="button" onClick={() => { writes.mutate({ fn: "remove_project_forecast_row", rowKey: "avg:power", message: "הוסר מהצפי: חשמל ומים" }); }}>remove</button>
      <button type="button" onClick={() => { writes.mutate({ fn: "reset_project_forecast", message: "הצפי חזר לחישוב" }); }}>reset</button>
    </>
  );
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<ProjectForecastEdit[]>(KEY, []);
  renderWithProviders(<Probe />, { client });
  return client;
}

describe("useProjectForecastWrites (decision 0219)", () => {
  it("takes a removed row off the list before the server answers", async () => {
    rpc.mockImplementation(() => new Promise(() => undefined));
    const client = renderProbe();
    fireEvent.click(screen.getByRole("button", { name: "remove" }));
    await waitFor(() => {
      expect(client.getQueryData<ProjectForecastEdit[]>(KEY)?.map((edit) => [edit.kind, edit.row_key])).toEqual([["remove", "avg:power"]]);
    });
  });

  it("puts the row back and says so when the removal fails", async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: "boom" } }));
    const client = renderProbe();
    fireEvent.click(screen.getByRole("button", { name: "remove" }));
    expect(await screen.findByText("לא הצלחנו לעדכן את הצפי")).toBeTruthy();
    expect(client.getQueryData(KEY)).toEqual([]);
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
});
