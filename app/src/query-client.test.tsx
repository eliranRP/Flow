import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectsCashMonth } from "./project-cash";
import { createQueryClient, QUERY_GC_MS, QUERY_STALE_MS } from "./query-client";

const rpc = vi.hoisted(() => ({ calls: [] as Array<{ name: string; args: unknown }> }));

const row = (id: string, name: string) => ({
  id,
  name,
  type: null,
  status: "active",
  is_overhead: false,
  group_id: null,
  created_at: "2026-01-01T00:00:00Z",
  finished_on: null,
  budget_minor: null,
  spent_minor: 0,
  cash: [{ currency: "ILS", in_minor: 100_000, out_minor: 40_000, net_minor: 60_000 }],
  profit_month_minor: 60_000,
  profit_all_minor: 60_000,
  first_month: "2026-01-01",
  pending_count: 0,
  deletable: false,
});

// Invented projects only.
const list = {
  month: "2026-10-01",
  base_currency: "ILS",
  basis: "paid",
  projects: [row("p1", "בית הברוש"), row("p2", "מחסן האלה")],
  unassigned: { count: 0, cash: [] },
};

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args: unknown) => {
      rpc.calls.push({ name, args });
      const project = (args as { p_project?: string }).p_project;
      return Promise.resolve({ data: project == null ? list : { ...list, projects: list.projects.filter((p) => p.id === project) }, error: null });
    },
  }),
}));

beforeEach(() => {
  rpc.calls = [];
});

function wrapper(client: ReturnType<typeof createQueryClient>) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe("the app's query client", () => {
  it("keeps a read fresh for 30 minutes and cached for at least 60", () => {
    const options = createQueryClient().getDefaultOptions().queries;
    expect(QUERY_STALE_MS).toBe(30 * 60_000);
    expect(options?.staleTime).toBe(QUERY_STALE_MS);
    expect(options?.gcTime).toBeGreaterThanOrEqual(60 * 60_000);
    expect(options?.gcTime).toBe(QUERY_GC_MS);
    expect(options?.refetchOnWindowFocus).toBe(false);
  });

  it("marks every cached read stale after a write, without refetching the ones off screen", async () => {
    const client = createQueryClient();
    client.setQueryData(["projects-cash", undefined, undefined], list);
    client.setQueryData(["loans", "c1", "list"], { rows: [] });
    expect(client.getQueryState(["loans", "c1", "list"])?.isInvalidated).toBe(false);
    const { result } = renderHook(() => useMutation({ mutationFn: () => Promise.resolve() }), { wrapper: wrapper(client) });
    await act(async () => { await result.current.mutateAsync(); });
    expect(client.getQueryState(["loans", "c1", "list"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["projects-cash", undefined, undefined])?.isInvalidated).toBe(true);
    expect(rpc.calls).toEqual([]);
  });
});

describe("a project's row on its page", () => {
  it("starts from the Projects list's read, with no read of its own while the list's is fresh", async () => {
    const client = createQueryClient();
    client.setQueryData(["projects-cash", undefined, undefined], list);
    const { result } = renderHook(() => useProjectsCashMonth(undefined, "p2"), { wrapper: wrapper(client) });
    expect(result.current.data?.projects.map((p) => p.name)).toEqual(["מחסן האלה"]);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(rpc.calls).toEqual([]);
  });

  it("paints the list's row at once and reads again when the list's read is old", async () => {
    const client = createQueryClient();
    client.setQueryData(["projects-cash", undefined, undefined], list, { updatedAt: Date.now() - QUERY_STALE_MS - 1_000 });
    const { result } = renderHook(() => useProjectsCashMonth(undefined, "p1"), { wrapper: wrapper(client) });
    expect(result.current.data?.projects.map((p) => p.name)).toEqual(["בית הברוש"]);
    await waitFor(() => { expect(rpc.calls.map((c) => c.name)).toEqual(["projects_cash_month"]); });
    expect((rpc.calls[0]?.args as { p_project?: string }).p_project).toBe("p1");
  });

  it("reads its own row when the list has none", async () => {
    const client = createQueryClient();
    const { result } = renderHook(() => useProjectsCashMonth(undefined, "p1"), { wrapper: wrapper(client) });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => { expect(result.current.data?.projects.map((p) => p.id)).toEqual(["p1"]); });
  });
});
