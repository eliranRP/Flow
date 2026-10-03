import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LEDGER_FOCUS_KEYS, LedgerFocusRefresh, refreshLedger } from "./books-focus";

afterEach(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

describe("ledger focus refresh", () => {
  it("invalidates the ledger keys when the window focuses", () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <LedgerFocusRefresh />
      </QueryClientProvider>,
    );
    window.dispatchEvent(new Event("focus"));
    expect(invalidate).toHaveBeenCalledTimes(LEDGER_FOCUS_KEYS.length);
    for (const key of LEDGER_FOCUS_KEYS) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
  });

  it("skips a hidden document and refreshes when it becomes visible", () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    render(
      <QueryClientProvider client={client}>
        <LedgerFocusRefresh />
      </QueryClientProvider>,
    );
    window.dispatchEvent(new Event("focus"));
    expect(invalidate).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(invalidate).toHaveBeenCalledTimes(LEDGER_FOCUS_KEYS.length);
  });

  it("does not refresh while the document stays hidden", () => {
    const client = { invalidateQueries: vi.fn() };
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    refreshLedger(client);
    expect(client.invalidateQueries).not.toHaveBeenCalled();
  });
});
