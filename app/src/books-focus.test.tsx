import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LEDGER_FOCUS_KEYS, LedgerFocusRefresh, refreshLedger } from "./books-focus";

afterEach(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

describe("ledger focus refresh", () => {
  it("invalidates the ledger keys when the window focuses", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <LedgerFocusRefresh />
      </QueryClientProvider>,
    );
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(invalidate).toHaveBeenCalledTimes(LEDGER_FOCUS_KEYS.length);
    for (const key of LEDGER_FOCUS_KEYS) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
    // Home's breakdown (FLOW-301) shows the same figures as Home.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["breakdown"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["breakdown-lines"] });
  });

  it("refetches once when focus and visibility arrive together", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <LedgerFocusRefresh />
      </QueryClientProvider>,
    );
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(invalidate).toHaveBeenCalledTimes(LEDGER_FOCUS_KEYS.length);
  });

  it("skips a hidden document and refreshes when it becomes visible", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    render(
      <QueryClientProvider client={client}>
        <LedgerFocusRefresh />
      </QueryClientProvider>,
    );
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
    expect(invalidate).toHaveBeenCalledTimes(LEDGER_FOCUS_KEYS.length);
  });

  it("does not refresh while the document stays hidden", () => {
    const client = { invalidateQueries: vi.fn() };
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    refreshLedger(client);
    expect(client.invalidateQueries).not.toHaveBeenCalled();
  });
});
