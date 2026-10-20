import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOverheadProject } from "./project-cash";

const rpc = vi.hoisted(() => ({ answer: (): Promise<{ data: unknown; error: unknown }> => Promise.resolve({ data: null, error: null }) }));

// Invented projects only.
const row = (id: string, name: string, overhead: boolean) => ({
  id, name, type: null, status: "active", is_overhead: overhead, group_id: null, created_at: "2026-01-01T00:00:00Z", finished_on: null,
  budget_minor: null, spent_minor: 0, cash: [], profit_month_minor: 0, profit_all_minor: 0, first_month: null, pending_count: 0, deletable: false,
});
const list = (projects: ReturnType<typeof row>[]) => ({ month: "2026-10-01", base_currency: "USD", basis: "paid", projects, unassigned: { count: 0, cash: [] } });

vi.mock("./lib/supabase", () => ({ getSupabase: () => ({ rpc: () => rpc.answer() }) }));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

let client: QueryClient;
beforeEach(() => { client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;

describe("useOverheadProject (owner 20/10)", () => {
  it("is undefined while the read loads, then the is_overhead row's id and name", async () => {
    rpc.answer = () => Promise.resolve({ data: list([row("p1", "בית הדקל", false), row("p9", "הנהלה ומשרד", true)]), error: null });
    const { result } = renderHook(() => useOverheadProject(true), { wrapper });
    expect(result.current.project).toBeUndefined();
    await waitFor(() => { expect(result.current.project).toEqual({ id: "p9", name: "הנהלה ומשרד" }); });
    expect(result.current.failed).toBe(false);
  });

  it("is null when the company has no overhead project", async () => {
    rpc.answer = () => Promise.resolve({ data: list([row("p1", "בית הדקל", false)]), error: null });
    const { result } = renderHook(() => useOverheadProject(true), { wrapper });
    await waitFor(() => { expect(result.current.project).toBeNull(); });
  });

  it("a failed first read is a failure, never a silent כללי", async () => {
    rpc.answer = () => Promise.resolve({ data: null, error: new Error("down") });
    const { result } = renderHook(() => useOverheadProject(true), { wrapper });
    await waitFor(() => { expect(result.current.failed).toBe(true); });
    expect(result.current.project).toBeUndefined();
  });

  it("a failed refetch keeps the last answer", async () => {
    rpc.answer = () => Promise.resolve({ data: list([row("p9", "הנהלה ומשרד", true)]), error: null });
    const { result, rerender } = renderHook(() => useOverheadProject(true), { wrapper });
    await waitFor(() => { expect(result.current.project?.id).toBe("p9"); });
    rpc.answer = () => Promise.resolve({ data: null, error: new Error("down") });
    await act(async () => { await client.refetchQueries({ queryKey: ["projects-cash"] }); });
    await waitFor(() => { expect(client.getQueryState(["projects-cash", undefined, undefined])?.status).toBe("error"); });
    rerender();
    expect(result.current.project).toEqual({ id: "p9", name: "הנהלה ומשרד" });
    expect(result.current.failed).toBe(false);
  });

  it("reads nothing when off", () => {
    const { result } = renderHook(() => useOverheadProject(false), { wrapper });
    expect(result.current.project).toBeNull();
  });
});
