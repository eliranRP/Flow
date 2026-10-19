import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LedgerFocusRefresh, refreshLedger } from "./books-focus";
import { LEDGER_KEYS } from "./ledger-keys";

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

const GAP = 5 * 60_000;
const LOAD = new Date("2026-10-19T09:00:00Z").getTime();

/** Mounts the refresh at LOAD, then moves the clock past the first gap, as a tab left open would. */
function mountPastGap(client: QueryClient) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(LOAD);
  render(
    <QueryClientProvider client={client}>
      <LedgerFocusRefresh />
    </QueryClientProvider>,
  );
  vi.setSystemTime(LOAD + GAP);
}

async function focus() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
  });
}

describe("ledger focus refresh", () => {
  it("invalidates the ledger keys when the window focuses", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    mountPastGap(client);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(invalidate).toHaveBeenCalledTimes(LEDGER_KEYS.length);
    for (const key of LEDGER_KEYS) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["breakdown-lines"] });
  });

  it("refetches once when focus and visibility arrive together", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    mountPastGap(client);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(invalidate).toHaveBeenCalledTimes(LEDGER_KEYS.length);
  });

  it("skips a hidden document and refreshes when it becomes visible", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    mountPastGap(client);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(invalidate).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(invalidate).toHaveBeenCalledTimes(LEDGER_KEYS.length);
  });

  it("does not refresh while the document stays hidden", () => {
    const client = { invalidateQueries: vi.fn() };
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    refreshLedger(client);
    expect(client.invalidateQueries).not.toHaveBeenCalled();
  });

  it("refreshes the reads that stay fresh for 30 minutes, not only the review ones", () => {
    const client = { invalidateQueries: vi.fn(() => Promise.resolve()) };
    expect(refreshLedger(client)).toBe(true);
    for (const key of ["projects-cash", "recurring-schedule", "recurring-changes", "missing-bills", "expected-months", "categories", "company-currency", "loans", "project-forecast-edits"]) {
      expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: [key] });
    }
  });

  it("refetches at most once every 5 minutes, from load, and only marks the reads stale in between", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(LOAD);
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <LedgerFocusRefresh />
      </QueryClientProvider>,
    );
    const refetched = () => invalidate.mock.calls.filter(([filters]) => filters?.refetchType == null).length;
    const marked = () => invalidate.mock.calls.filter(([filters]) => filters?.refetchType === "none").length;
    // Just after load: nothing refetches what was just read, but the next screen reads again.
    await focus();
    expect(refetched()).toBe(0);
    expect(marked()).toBe(LEDGER_KEYS.length);
    for (const key of LEDGER_KEYS) expect(invalidate).toHaveBeenCalledWith({ queryKey: [key], refetchType: "none" });
    vi.setSystemTime(LOAD + GAP);
    await focus();
    expect(refetched()).toBe(LEDGER_KEYS.length);
    vi.setSystemTime(LOAD + 2 * GAP - 1);
    await focus();
    expect(refetched()).toBe(LEDGER_KEYS.length);
    expect(marked()).toBe(LEDGER_KEYS.length * 2);
    vi.setSystemTime(LOAD + 2 * GAP);
    await focus();
    expect(refetched()).toBe(LEDGER_KEYS.length * 2);
  });
});
