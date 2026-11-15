import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeEdge } from "./edge";
import { renderWithProviders } from "./test-render";
import { REFRESH_CALL_CAP, REFRESH_DONE, useSumitRefresh } from "./use-sumit-refresh";

vi.mock("./edge", async (original) => ({ ...(await original<typeof import("./edge")>()), invokeEdge: vi.fn() }));

function Probe() {
  const refresh = useSumitRefresh();
  return (
    <button type="button" disabled={refresh.isPending} onClick={() => { refresh.mutate(); }}>
      {refresh.isPending ? "busy" : "refresh"}
    </button>
  );
}

const edge = vi.mocked(invokeEdge);
const partial = { ok: true, partial: true, documents: 10, sumit_reads: 3 };
const complete = { ok: true, documents: 4, sumit_reads: 2 };

afterEach(() => {
  edge.mockReset();
});

// FLOW-1163: a long SUMIT window is pulled over several runs; one tap goes on while the answer is partial.
describe("the SUMIT refresh", () => {
  it("calls again, forced, while the answer is partial, and says finished once, after the complete one", async () => {
    edge.mockResolvedValueOnce(partial).mockResolvedValueOnce(partial).mockResolvedValueOnce(partial).mockResolvedValueOnce(complete);
    renderWithProviders(<Probe />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(REFRESH_DONE)).toBeTruthy();
    expect(edge).toHaveBeenCalledTimes(4);
    for (const call of edge.mock.calls) expect(call).toEqual(["sumit-sync", { force: true }]);
    expect(screen.getAllByText(REFRESH_DONE)).toHaveLength(1);
  });

  it("stays busy for the whole loop, so a second tap does nothing", async () => {
    let release: (value: unknown) => void = () => undefined;
    edge.mockResolvedValueOnce(partial).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    renderWithProviders(<Probe />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => { expect(edge).toHaveBeenCalledTimes(2); });
    const button = screen.getByRole<HTMLButtonElement>("button");
    expect(button.textContent).toBe("busy");
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(edge).toHaveBeenCalledTimes(2);
    await act(() => { release(complete); return Promise.resolve(); });
    expect(await screen.findByText(REFRESH_DONE)).toBeTruthy();
  });

  it("stops at once on an error in the second call, with the usual failure", async () => {
    edge.mockResolvedValueOnce(partial).mockRejectedValueOnce(new Error("sync_failed")).mockResolvedValue(complete);
    renderWithProviders(<Probe />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(/הרענון נכשל/)).toBeTruthy();
    expect(edge).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(REFRESH_DONE)).toBeNull();
  });

  it("calls at most REFRESH_CALL_CAP times in one tap, then shows the finished toast: the pull goes on at the next sync", async () => {
    edge.mockResolvedValue(partial);
    renderWithProviders(<Probe />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(REFRESH_DONE)).toBeTruthy();
    expect(edge).toHaveBeenCalledTimes(REFRESH_CALL_CAP);
  });

  it("stops between calls when the screen is left", async () => {
    let release: (value: unknown) => void = () => undefined;
    edge.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; })).mockResolvedValue(partial);
    const view = renderWithProviders(<Probe />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => { expect(edge).toHaveBeenCalledTimes(1); });
    view.unmount();
    await act(() => { release(partial); return Promise.resolve(); });
    expect(edge).toHaveBeenCalledTimes(1);
  });

  it("a run that answers once and complete is one call, as before", async () => {
    edge.mockResolvedValueOnce(complete);
    renderWithProviders(<Probe />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(REFRESH_DONE)).toBeTruthy();
    expect(edge).toHaveBeenCalledTimes(1);
  });
});
