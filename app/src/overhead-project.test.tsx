import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOverheadProject } from "./overhead-project";

type Answer = { data: unknown; error: unknown };
const read = vi.hoisted(() => ({ answer: (): Promise<Answer> => Promise.resolve({ data: null, error: null }), tables: [] as string[], rpcs: [] as string[] }));

// Invented projects only.
const company = (id: string | null, name?: string) => ({ overhead_project_id: id, overhead: id == null ? null : { id, name } });

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string) => { read.rpcs.push(name); return Promise.resolve({ data: null, error: new Error("unexpected") }); },
    from: (table: string) => ({ select: () => ({ maybeSingle: () => { read.tables.push(table); return read.answer(); } }) }),
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  read.tables.length = 0;
  read.rpcs.length = 0;
});
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;

describe("useOverheadProject (owner 21/10)", () => {
  it("is undefined while the read loads, then the company's overhead project's id and name, from its own row", async () => {
    read.answer = () => Promise.resolve({ data: company("p9", "הנהלה ומשרד"), error: null });
    const { result } = renderHook(() => useOverheadProject(true), { wrapper });
    expect(result.current.project).toBeUndefined();
    await waitFor(() => { expect(result.current.project).toEqual({ id: "p9", name: "הנהלה ומשרד" }); });
    expect(result.current.failed).toBe(false);
    expect(read.tables).toEqual(["companies"]);
    expect(read.rpcs).toEqual([]);
  });

  it("is null when the company has no overhead project", async () => {
    read.answer = () => Promise.resolve({ data: company(null), error: null });
    const { result } = renderHook(() => useOverheadProject(true), { wrapper });
    await waitFor(() => { expect(result.current.project).toBeNull(); });
  });

  it("a failed first read is a failure, never a silent כללי", async () => {
    read.answer = () => Promise.resolve({ data: null, error: new Error("down") });
    const { result } = renderHook(() => useOverheadProject(true), { wrapper });
    await waitFor(() => { expect(result.current.failed).toBe(true); });
    expect(result.current.project).toBeUndefined();
  });

  it("no readable company is a failure too, not 'none set'", async () => {
    read.answer = () => Promise.resolve({ data: null, error: null });
    const { result } = renderHook(() => useOverheadProject(true), { wrapper });
    await waitFor(() => { expect(result.current.failed).toBe(true); });
    expect(result.current.project).toBeUndefined();
  });

  it("a failed refetch keeps the last answer", async () => {
    read.answer = () => Promise.resolve({ data: company("p9", "הנהלה ומשרד"), error: null });
    const { result, rerender } = renderHook(() => useOverheadProject(true), { wrapper });
    await waitFor(() => { expect(result.current.project?.id).toBe("p9"); });
    read.answer = () => Promise.resolve({ data: null, error: new Error("down") });
    await act(async () => { await client.refetchQueries({ queryKey: ["company-overhead"] }); });
    await waitFor(() => { expect(client.getQueryState(["company-overhead", "off"])?.status).toBe("error"); });
    rerender();
    expect(result.current.project).toEqual({ id: "p9", name: "הנהלה ומשרד" });
    expect(result.current.failed).toBe(false);
  });

  it("takes the embedded project as a one-row list too", async () => {
    read.answer = () => Promise.resolve({ data: { overhead_project_id: "p9", overhead: [{ id: "p9", name: "כללי" }] }, error: null });
    const { result } = renderHook(() => useOverheadProject(true), { wrapper });
    await waitFor(() => { expect(result.current.project).toEqual({ id: "p9", name: "כללי" }); });
  });

  it("a set id whose project did not come back is a failure", async () => {
    read.answer = () => Promise.resolve({ data: { overhead_project_id: "p9", overhead: null }, error: null });
    const { result } = renderHook(() => useOverheadProject(true), { wrapper });
    await waitFor(() => { expect(result.current.failed).toBe(true); });
  });

  it("reads nothing when off", () => {
    const { result } = renderHook(() => useOverheadProject(false), { wrapper });
    expect(result.current.project).toBeNull();
    expect(read.tables).toEqual([]);
  });
});
