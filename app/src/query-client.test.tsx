import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectsCashMonth } from "./project-cash";
import { useInvalidateBooks } from "./use-books";
import { createQueryClient, QUERY_GC_MS, QUERY_STALE_MS } from "./query-client";

const rpc = vi.hoisted(() => ({ calls: [] as Array<{ name: string; args: unknown }> }));

const row = (id: string, name: string) => ({
  id,
  name,
  type: null,
  status: "active",
  is_overhead: false,
  created_at: "2026-01-01T00:00:00Z",
  finished_on: null,
  budget_minor: null,
  spent_minor: 0,
  cash: [{ currency: "ILS", in_minor: 100_000, out_minor: 40_000, net_minor: 60_000 }],
  profit_all_minor: 60_000,
  first_month: "2026-01-01",
});

// Invented projects only.
const list = {
  base_currency: "ILS",
  projects: [row("p1", "בית הברוש"), row("p2", "מחסן האלה")],
  unassigned: { count: 0, cash: [] },
};

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args: unknown) => {
      rpc.calls.push({ name, args });
      const project = (args as { p_project?: string }).p_project;
      // The server's answer for one project carries the menu's two figures; the list's has neither (FLOW-1204).
      return Promise.resolve({ data: project == null ? list : { ...list, projects: list.projects.filter((p) => p.id === project).map((p) => ({ ...p, pending_count: 2, deletable: true })) }, error: null });
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
  it("paints the Projects list's row at once and reads its own row, which has the menu's figures (FLOW-1204)", async () => {
    const client = createQueryClient();
    client.setQueryData(["projects-cash", undefined, undefined], list);
    const { result } = renderHook(() => useProjectsCashMonth(undefined, "p2"), { wrapper: wrapper(client) });
    expect(result.current.data?.projects.map((p) => p.name)).toEqual(["מחסן האלה"]);
    expect(result.current.data?.projects[0]?.pending_count).toBeUndefined();
    await waitFor(() => { expect(rpc.calls.map((c) => c.name)).toEqual(["projects_cash_month"]); });
    expect((rpc.calls[0]?.args as { p_project?: string }).p_project).toBe("p2");
    await waitFor(() => { expect(result.current.data?.projects[0]).toMatchObject({ pending_count: 2, deletable: true }); });
  });

  it("reads its own row at once, though the list's read is recent or a write marked it stale", async () => {
    const client = createQueryClient();
    client.setQueryData(["projects-cash", undefined, undefined], list);
    // A write that saves through Supabase directly and refreshes only "dashboard" (as upsert_project does).
    const write = renderHook(() => useInvalidateBooks(), { wrapper: wrapper(client) });
    await act(async () => { await write.result.current(["dashboard"]); });
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

  it("reads the list with no project, once", async () => {
    const client = createQueryClient();
    const { result } = renderHook(() => useProjectsCashMonth(), { wrapper: wrapper(client) });
    await waitFor(() => { expect(result.current.data?.projects).toHaveLength(2); });
    expect((rpc.calls[0]?.args as { p_project?: string }).p_project).toBeUndefined();
    expect(rpc.calls).toHaveLength(1);
  });
});

describe("a write outside useWrite", () => {
  it("leaves an unrelated read stale, so its next mount reads again", async () => {
    const client = createQueryClient();
    const first = renderHook(() => useProjectsCashMonth(), { wrapper: wrapper(client) });
    await waitFor(() => { expect(first.result.current.data).toBeDefined(); });
    first.unmount();
    expect(rpc.calls).toHaveLength(1);
    // Within the 30 minutes, a remount reads nothing.
    const again = renderHook(() => useProjectsCashMonth(), { wrapper: wrapper(client) });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(rpc.calls).toHaveLength(1);
    again.unmount();
    const write = renderHook(() => useInvalidateBooks(), { wrapper: wrapper(client) });
    await act(async () => { await write.result.current(["dashboard"]); });
    expect(rpc.calls).toHaveLength(1);
    renderHook(() => useProjectsCashMonth(), { wrapper: wrapper(client) });
    await waitFor(() => { expect(rpc.calls).toHaveLength(2); });
  });
});

