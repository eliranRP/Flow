import type { ProjectsCashMonth } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectsCashMonthOptions, useProjectsCashMonth } from "./project-cash";

const rpc = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown }[],
}));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return Promise.resolve({ data: { base_currency: "ILS", projects: [{ id: "p1", name: "Oak Ridge", status: "active", is_overhead: false, type: null, created_at: "2026-01-01T00:00:00Z", finished_on: null, budget_minor: null, spent_minor: 0, cash: [], profit_all_minor: 0, first_month: null, pending_count: 3, deletable: true }], unassigned: { count: 0, cash: [] } }, error: null });
    },
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: "t" } }, error: null }),
    },
  }),
}));

/** The Projects list's row for p1, as the list holds it: no menu figures (FLOW-1204). */
const listRow = { id: "p1", name: "Oak Ridge", status: "active", is_overhead: false, type: null, created_at: "2026-01-01T00:00:00Z", finished_on: null, budget_minor: null, spent_minor: 0, cash: [], profit_all_minor: 0, first_month: null };

function makeClient(seeded: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30 * 60_000 }, mutations: { retry: false } } });
  if (seeded) {
    client.setQueryData<ProjectsCashMonth>(["projects-cash", undefined, undefined], { base_currency: "ILS", projects: [listRow as never], unassigned: { count: 0, cash: [] } } as never);
  }
  return client;
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  rpc.calls.length = 0;
});

describe("useProjectsCashMonth's project read (FLOW-1212)", () => {
  it("with a list seed, defers the project's read until after the first paint, and paints the seed meanwhile", async () => {
    const client = makeClient(true);
    const { result } = renderHook(() => useProjectsCashMonth(undefined, "p1"), { wrapper: wrapper(client) });
    // The seed paints at once, with no menu figures, and no read is sent before the page has drawn.
    expect(result.current.data?.projects[0]?.id).toBe("p1");
    expect(result.current.data?.projects[0]?.pending_count).toBeUndefined();
    expect(result.current.dataUpdatedAt).toBe(0);
    expect(rpc.calls).toHaveLength(0);
    // After the idle moment the read goes out, once, and lands.
    await waitFor(() => { expect(rpc.calls).toHaveLength(1); });
    expect(rpc.calls[0]?.name).toBe("projects_cash_month");
    expect((rpc.calls[0]?.args as { p_project: string }).p_project).toBe("p1");
    await waitFor(() => { expect(result.current.data?.projects[0]?.pending_count).toBe(3); });
    expect(result.current.data?.projects[0]?.deletable).toBe(true);
  });

  it("with no list seed (a deep link), reads at mount, as before", async () => {
    const client = makeClient(false);
    const { result } = renderHook(() => useProjectsCashMonth(undefined, "p1"), { wrapper: wrapper(client) });
    await waitFor(() => { expect(result.current.data?.projects[0]?.pending_count).toBe(3); });
    expect(rpc.calls).toHaveLength(1);
    expect((rpc.calls[0]?.args as { p_project: string }).p_project).toBe("p1");
  });

  it("starts the deferred read at once when its menu opens (urgent) before the idle moment", async () => {
    const client = makeClient(true);
    const { result, rerender } = renderHook(({ urgent }) => useProjectsCashMonth(undefined, "p1", { urgent }), {
      wrapper: wrapper(client),
      initialProps: { urgent: false },
    });
    expect(rpc.calls).toHaveLength(0);
    // The menu opens: its read goes out now, and the seed keeps painting until it lands.
    rerender({ urgent: true });
    await waitFor(() => { expect(rpc.calls).toHaveLength(1); });
    expect(result.current.data?.projects[0]?.id).toBe("p1");
    await waitFor(() => { expect(result.current.dataUpdatedAt).toBeGreaterThan(0); });
    // The idle moment that follows does not read it again.
    await new Promise((resolve) => { setTimeout(resolve, 200); });
    expect(rpc.calls).toHaveLength(1);
  });

  it("never defers the list's own read, which has no project", async () => {
    const client = makeClient(false);
    renderHook(() => useProjectsCashMonth(), { wrapper: wrapper(client) });
    await waitFor(() => { expect(rpc.calls).toHaveLength(1); });
    expect((rpc.calls[0]?.args as { p_project?: string }).p_project).toBeUndefined();
  });

  it("with a warm read under the menu's key and no urgent read (the after-paint path), makes exactly one read in total", async () => {
    const client = makeClient(true);
    // An earlier read under the same key (the menu's own, or a previous mount of the page).
    await client.query({ ...projectsCashMonthOptions(undefined, "p1"), staleTime: 60_000, retry: false }).catch(() => undefined);
    expect(rpc.calls).toHaveLength(1);
    const { result } = renderHook(() => useProjectsCashMonth(undefined, "p1"), { wrapper: wrapper(client) });
    // The page's deferred read finds the warm row fresh: it lands at once and no second read goes out.
    expect(result.current.data?.projects[0]?.pending_count).toBe(3);
    await new Promise((resolve) => { setTimeout(resolve, 200); });
    expect(rpc.calls).toHaveLength(1);
  });
});
