import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjectCashMonthLinesQuery } from "./project-cash";

const rpc = vi.hoisted(() => ({ calls: [] as { name: string; args: Record<string, unknown> }[] }));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      rpc.calls.push({ name, args });
      return Promise.resolve({ data: { rows: [], has_more: false }, error: null });
    },
  }),
}));

afterEach(() => { rpc.calls = []; });

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe("useProjectCashMonthLinesQuery's currency (FLOW-1270)", () => {
  it("keeps the read off for an empty currency, which the server would not fill in", async () => {
    const { result } = renderHook(() => useProjectCashMonthLinesQuery("p1", "2026-11", ""), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.fetchStatus).toBe("idle");
    expect(rpc.calls).toEqual([]);
  });

  it("reads with no p_currency for null and with it for a currency", async () => {
    const none = renderHook(() => useProjectCashMonthLinesQuery("p1", "2026-11", null), { wrapper });
    await waitFor(() => { expect(none.result.current.data).toBeDefined(); });
    expect(rpc.calls.every((call) => !("p_currency" in call.args))).toBe(true);
    rpc.calls = [];
    const some = renderHook(() => useProjectCashMonthLinesQuery("p1", "2026-11", "USD"), { wrapper });
    await waitFor(() => { expect(some.result.current.data).toBeDefined(); });
    expect(rpc.calls.every((call) => call.args.p_currency === "USD")).toBe(true);
  });
});
