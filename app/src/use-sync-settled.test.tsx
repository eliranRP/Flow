import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { LEDGER_KEYS } from "./ledger-keys";
import { ToastProvider } from "./ui/toast";
import { useSyncSettled } from "./use-sync-settled";

describe("a sync that settles in another tab", () => {
  it("refetches every ledger read, the 30-minute ones included", () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
    );
    const { rerender } = renderHook(
      ({ syncing }: { syncing: boolean }) => {
        useSyncSettled({ syncing, pending: false, lastSyncAt: syncing ? "2026-10-19T08:00:00Z" : "2026-10-19T08:05:00Z", lastError: null, success: "הרענון הסתיים." });
      },
      { wrapper, initialProps: { syncing: true } },
    );
    expect(invalidate).not.toHaveBeenCalled();
    rerender({ syncing: false });
    for (const key of LEDGER_KEYS) expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    for (const key of ["projects-cash", "recurring-schedule", "recurring-changes", "missing-bills", "expected-months", "categories", "company-currency", "loans", "project-forecast-edits"]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
  });
});
