import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { useTransferMatchCountQuery } from "./transfer-match-count";

// FLOW-941: Home's row reads the count (count_transfer_matches), never the whole list.
const db = vi.hoisted((): { calls: string[]; data: unknown } => ({ calls: [], data: 3 }));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string) => {
      db.calls.push(name);
      return Promise.resolve({ data: db.data, error: null });
    },
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("useTransferMatchCountQuery", () => {
  it("reads count_transfer_matches, not the list", async () => {
    db.calls = [];
    db.data = 3;
    const { result } = renderHook(() => useTransferMatchCountQuery(), { wrapper });
    await waitFor(() => { expect(result.current.data).toBe(3); });
    expect(db.calls).toEqual(["count_transfer_matches"]);
  });

  it("a reply that is not a count is an error, so Home hides the row", async () => {
    db.data = { matches: [] };
    const { result } = renderHook(() => useTransferMatchCountQuery(), { wrapper });
    await waitFor(() => { expect(result.current.isError).toBe(true); });
  });
});
