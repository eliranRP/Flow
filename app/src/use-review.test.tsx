import type { ReviewRow } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jevQueueQueryKey, resetJevScopeMemory } from "./screens/jev-connector-scope";
import { reviewCacheUpdates, reviewListKey, useReviewDeepLink, useReviewPaging, useReviewQuery } from "./use-review";

type Args = { p_limit: number; p_after_id?: string; p_project?: string; p_item?: string };

/** A server with `size` open items, `r001` first. It honours the limit like list_review_page does. */
const server = vi.hoisted(() => ({
  size: 0,
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  failNext: false,
  gone: new Set<string>(),
}));

function rowOf(n: number) {
  const id = `r${String(n).padStart(3, "0")}`;
  return {
    id,
    transaction_id: `t-${id}`,
    company_id: "co-1",
    description: `ספק ${id}`,
    doc_date: "2026-09-01",
    amount_net: -10_000,
    direction: "expense",
    reason: null,
    project_id: null,
    category_id: null,
    supplier_name: `ספק ${id}`,
  };
}

function page(args: Args) {
  const open = Array.from({ length: server.size }, (_, index) => index + 1).filter((n) => !server.gone.has(rowOf(n).id));
  if (args.p_item != null) {
    const found = open.find((n) => rowOf(n).id === args.p_item);
    return { items: found == null ? [] : [rowOf(found)], total: open.length, next: null };
  }
  const after = args.p_after_id == null ? 0 : Number(args.p_after_id.slice(1));
  const rest = open.filter((n) => n > after);
  const taken = rest.slice(0, args.p_limit);
  const last = taken[taken.length - 1];
  return {
    items: taken.map(rowOf),
    total: open.length,
    next: rest.length > taken.length && last != null ? { doc_date: "2026-09-01", created_at: "2026-09-02T00:00:00+00:00", id: rowOf(last).id } : null,
  };
}

const supabase = {
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "u-1" } } } }) },
  from: () => {
    const builder = {
      select: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: { id: "co-1" }, error: null }),
    };
    return builder;
  },
  // Like supabase-js's query builder: nothing is sent until it is awaited, and every await sends it again.
  rpc: (name: string, args: Record<string, unknown>) => ({
    then<A, B = never>(onFulfilled?: (value: { data: unknown; error: unknown }) => A | PromiseLike<A>, onRejected?: (reason: unknown) => B | PromiseLike<B>) {
      server.calls.push({ name, args });
      let answer: { data: unknown; error: unknown } = { data: null, error: null };
      if (name === "list_review_page") {
        if (server.failNext) {
          server.failNext = false;
          answer = { data: null, error: { message: "db down" } };
        } else {
          answer = { data: page(args as Args), error: null };
        }
      }
      return Promise.resolve(answer).then(onFulfilled, onRejected);
    },
  }),
};

vi.mock("./lib/supabase", () => ({ getSupabase: () => supabase }));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const jev = vi.hoisted(() => ({ loaded: [] as string[][] }));
vi.mock("./screens/jev-review", () => ({
  JEV_QUEUE_STALLED: "stalled",
  fetchJevConnector: () => Promise.resolve(true),
  loadJevSuggestions: (ids: string[]) => {
    jev.loaded.push(ids);
    return Promise.resolve({ connectorOn: true, byId: {} });
  },
}));

function setup(project: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  const view = renderHook(() => {
    const query = useReviewQuery(true, project);
    const rows: ReviewRow[] = query.data ?? [];
    const paging = useReviewPaging(rows.length, project);
    return { query, rows, paging };
  }, { wrapper });
  return { client, view };
}

beforeEach(() => {
  server.size = 120;
  server.calls = [];
  server.failNext = false;
  server.gone = new Set();
  jev.loaded = [];
  resetJevScopeMemory();
});

afterEach(() => {
  vi.clearAllMocks();
});

const reads = () => server.calls.filter((call) => call.name === "list_review_page");

describe("FLOW-984: the review queue in pages", () => {
  it("reads the first page of 50 and counts the open items from the server", async () => {
    const { view } = setup();
    await waitFor(() => { expect(view.result.current.rows).toHaveLength(50); });
    expect(reads()).toHaveLength(1);
    expect(reads()[0]?.args).toEqual({ p_limit: 50 });
    expect(view.result.current.paging).toMatchObject({ total: 120, more: true, loading: false, failed: false });
  });

  it("loads the next page after the cursor, adds it to the same flat list and keeps the count", async () => {
    const { client, view } = setup();
    await waitFor(() => { expect(view.result.current.rows).toHaveLength(50); });
    act(() => { view.result.current.paging.loadMore(); });
    await waitFor(() => { expect(view.result.current.rows).toHaveLength(100); });
    expect(reads()[1]?.args).toEqual({
      p_limit: 50,
      p_after_date: "2026-09-01",
      p_after_created: "2026-09-02T00:00:00+00:00",
      p_after_id: "r050",
    });
    expect(Array.isArray(client.getQueryData(reviewListKey("off", null)))).toBe(true);
    expect(view.result.current.rows.map((row) => row.id).slice(48, 52)).toEqual(["r049", "r050", "r051", "r052"]);
    act(() => { view.result.current.paging.loadMore(); });
    await waitFor(() => { expect(view.result.current.rows).toHaveLength(120); });
    expect(view.result.current.paging).toMatchObject({ total: 120, more: false });
    const before = reads().length;
    act(() => { view.result.current.paging.loadMore(); });
    expect(reads()).toHaveLength(before);
  });

  it("an approval lowers the count at once, and a refresh reads the same number of cards back", async () => {
    const { client, view } = setup();
    await waitFor(() => { expect(view.result.current.rows).toHaveLength(50); });
    act(() => { view.result.current.paging.loadMore(); });
    await waitFor(() => { expect(view.result.current.rows).toHaveLength(100); });
    // The tapped card leaves the list at once, as useWrite's optimistic update does.
    act(() => {
      for (const { key, update } of reviewCacheUpdates("off", null, (old) => (Array.isArray(old) ? (old as ReviewRow[]).filter((row) => row.id !== "r001") : old))) {
        client.setQueryData(key, update);
      }
    });
    await waitFor(() => { expect(view.result.current.paging.total).toBe(119); });
    server.gone.add("r001");
    await act(async () => { await client.invalidateQueries({ queryKey: ["review"] }); });
    await waitFor(() => { expect(view.result.current.paging.total).toBe(119); });
    // 99 cards were on screen; the refresh asks for as many (the first page is the least it asks for).
    expect(reads().at(-1)?.args).toEqual({ p_limit: 99 });
    expect(view.result.current.rows).toHaveLength(99);
    expect(view.result.current.rows[0]?.id).toBe("r002");
  });

  it("a failed page leaves the list and says so; the retry loads it", async () => {
    const { view } = setup();
    await waitFor(() => { expect(view.result.current.rows).toHaveLength(50); });
    server.failNext = true;
    act(() => { view.result.current.paging.loadMore(); });
    await waitFor(() => { expect(view.result.current.paging.failed).toBe(true); });
    expect(view.result.current.rows).toHaveLength(50);
    // A failed page is not tried again by itself.
    const failedReads = reads().length;
    act(() => { view.result.current.paging.loadMore(); });
    expect(reads()).toHaveLength(failedReads);
    act(() => { view.result.current.paging.retry(); });
    await waitFor(() => { expect(view.result.current.rows).toHaveLength(100); });
    expect(view.result.current.paging.failed).toBe(false);
  });

  it("a project filter reads that project's items through the project argument, page after page", async () => {
    const { client, view } = setup("p-1");
    await waitFor(() => { expect(view.result.current.rows).toHaveLength(50); });
    act(() => { view.result.current.paging.loadMore(); });
    await waitFor(() => { expect(view.result.current.rows).toHaveLength(100); });
    expect(reads().map((call) => call.args.p_project)).toEqual(["p-1", "p-1"]);
    expect(client.getQueryData(reviewListKey("off", "p-1"))).toHaveLength(100);
    expect(client.getQueryData(reviewListKey("off", null))).toBeUndefined();
  });

  it("starts Jev's scope prefetch for each page, with that page's cards", async () => {
    const { client, view } = setup();
    await waitFor(() => { expect(view.result.current.rows).toHaveLength(50); });
    const first = view.result.current.rows.map((row) => row.transaction_id);
    await waitFor(() => { expect(client.getQueryData(jevQueueQueryKey(first))).toBeDefined(); });
    act(() => { view.result.current.paging.loadMore(); });
    await waitFor(() => { expect(view.result.current.rows).toHaveLength(100); });
    const second = view.result.current.rows.slice(50).map((row) => row.transaction_id);
    await waitFor(() => { expect(client.getQueryData(jevQueueQueryKey(second))).toBeDefined(); });
    expect(jev.loaded.map((ids) => ids.length)).toEqual([50, 50]);
  });
});

describe("FLOW-984: a link to a card the pages have not reached", () => {
  function linked(item: string) {
    const { client, view } = setup();
    const link = renderHook(() => useReviewDeepLink(item, view.result.current.rows, view.result.current.query.isSuccess), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
      ),
    });
    return { client, view, link };
  }

  it("reads that one row and adds it to the list", async () => {
    const { view, link } = linked("r090");
    await waitFor(() => { expect(view.result.current.rows.some((row) => row.id === "r090")).toBe(true); });
    expect(reads().some((call) => call.args.p_item === "r090" && call.args.p_limit === 1)).toBe(true);
    expect(view.result.current.rows).toHaveLength(51);
    // The row added by the link is counted: the open total is still 120.
    expect(view.result.current.paging.total).toBe(120);
    expect(link.result.current.reading).toBe(false);
    // The page that holds it later brings it once, in its place.
    act(() => { view.result.current.paging.loadMore(); });
    await waitFor(() => { expect(view.result.current.rows).toHaveLength(100); });
    expect(view.result.current.rows.filter((row) => row.id === "r090")).toHaveLength(1);
    expect(view.result.current.rows.map((row) => row.id).indexOf("r090")).toBe(89);
  });

  it("is reading until the answer lands, and a card that is gone is not added", async () => {
    server.gone.add("r090");
    const { view, link } = linked("r090");
    await waitFor(() => { expect(view.result.current.rows).toHaveLength(50); });
    await waitFor(() => { expect(link.result.current.reading).toBe(false); });
    expect(view.result.current.rows).toHaveLength(50);
  });

  it("does not read a card when every page is loaded", async () => {
    server.size = 30;
    const { view } = linked("r099");
    await waitFor(() => { expect(view.result.current.rows).toHaveLength(30); });
    expect(reads().every((call) => call.args.p_item == null)).toBe(true);
  });
});
