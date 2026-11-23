import { hashKey, QueryClient, QueryObserver } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDashboard, demoProject, demoUnpaid } from "./demo/model";
import {
  flushKeptReads,
  forgetKeptReads,
  KEPT_MAX_AGE_MS,
  KEPT_MAX_BYTES,
  KEPT_VERSION,
  keepKeptReadsFor,
  keepReadsOf,
  resetKeptReadsForTests,
  restoreKeptReads,
  useKeptState,
} from "./kept-reads";
import { idbKeptStore, type KeptRow, type KeptStore } from "./kept-store";
import { resetShownCompanyForTests, setShownCompany } from "./lib/company-header";
import { projectQueryOptions } from "./use-books";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMPANY_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const COMPANY_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const UNPAID = ["unpaid", "off"] as const;
const DASHBOARD = ["dashboard", "off", { from: null, to: null }] as const;

let store: KeptStore;

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** One read, the way a screen's query makes it: it succeeds and the kept reads see it. */
async function read(client: QueryClient, key: readonly unknown[], data: unknown): Promise<void> {
  await client.query({ queryKey: key, queryFn: () => Promise.resolve(data), staleTime: 0 });
}

/** A row as the store holds it: its id is its key's hash, unless a test says otherwise. */
function row(over: Partial<KeptRow>): KeptRow {
  const key = over.key ?? JSON.stringify(UNPAID);
  return { id: over.id ?? hashKey(JSON.parse(key) as unknown[]), owner: `${USER_A}|${COMPANY_A}`, version: KEPT_VERSION, at: Date.now(), size: 10, key, data: [], ...over };
}

async function kept(): Promise<Set<string>> {
  return new Set((await store.all()).map((item) => item.key));
}

beforeEach(() => {
  const factory = new IDBFactory();
  store = idbKeptStore(() => factory);
  resetKeptReadsForTests(store);
  resetShownCompanyForTests();
  setShownCompany(USER_A, COMPANY_A);
});

afterEach(() => {
  vi.useRealTimers();
  resetKeptReadsForTests();
  resetShownCompanyForTests();
});

describe("kept reads (FLOW-1267)", () => {
  it("puts a read back, bigints and all, for the same user and company: stale, so it is read again", async () => {
    const first = newClient();
    keepReadsOf(first);
    const unpaid = demoUnpaid();
    await read(first, UNPAID, unpaid);
    await read(first, DASHBOARD, demoDashboard(null, null, "invoiced"));
    await flushKeptReads();
    expect([...(await kept())]).toHaveLength(2);

    const next = newClient();
    await restoreKeptReads(next);
    expect(next.getQueryData(UNPAID)).toEqual(unpaid);
    expect(next.getQueryData(DASHBOARD)).toEqual(demoDashboard(null, null, "invoiced"));
    const queryFn = vi.fn(() => Promise.resolve(unpaid));
    const observer = new QueryObserver(next, { queryKey: UNPAID, queryFn, staleTime: 30 * 60_000 });
    expect(observer.getCurrentResult().data).toEqual(unpaid);
    expect(observer.getCurrentResult().isStale).toBe(true);
    const stop = observer.subscribe(() => undefined);
    await vi.waitFor(() => { expect(queryFn).toHaveBeenCalledTimes(1); });
    stop();
  });

  it("starts the page's project query from the kept read, and reads it again", async () => {
    const wire = JSON.parse(JSON.stringify(demoProject("herzl"), (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value))) as unknown;
    const { projectDetailSchema } = await import("@flow/shared");
    const project = projectDetailSchema.parse(wire);
    const first = newClient();
    keepReadsOf(first);
    const options = projectQueryOptions("off", "herzl", null);
    await first.query({ queryKey: options.queryKey, queryFn: () => Promise.resolve(project) });
    await flushKeptReads();
    const next = newClient();
    await restoreKeptReads(next);
    const observer = new QueryObserver(next, { ...options, staleTime: 10_000 });
    expect(observer.getCurrentResult().data).toEqual(project);
    expect(typeof observer.getCurrentResult().data?.income_agorot).toBe("bigint");
    expect(observer.getCurrentResult().isStale).toBe(true);
  });

  it("restores nothing for another company or another user, and drops those rows", async () => {
    const first = newClient();
    keepReadsOf(first);
    await read(first, UNPAID, demoUnpaid());
    await flushKeptReads();
    setShownCompany(USER_A, COMPANY_B);
    const other = newClient();
    await restoreKeptReads(other);
    expect(other.getQueryData(UNPAID)).toBeUndefined();
    expect(await kept()).toEqual(new Set());

    setShownCompany(USER_A, COMPANY_A);
    await store.put([row({ id: "h" })]);
    setShownCompany(USER_B, COMPANY_A);
    const another = newClient();
    await restoreKeptReads(another);
    expect(another.getQueryData(UNPAID)).toBeUndefined();
    expect(await store.all()).toEqual([]);
    // No company shown: nothing is restored and nothing is kept (the session's user then drops the old rows).
    setShownCompany(USER_A, null);
    await store.put([row({ at: 1 })]);
    const none = newClient();
    keepReadsOf(none);
    await restoreKeptReads(none);
    expect(none.getQueryData(UNPAID)).toBeUndefined();
    await read(none, UNPAID, demoUnpaid());
    await flushKeptReads();
    expect(await store.all()).toEqual([row({ at: 1 })]);
  });

  it("keeps a read for the company it began for, not the one shown when it lands", async () => {
    const client = newClient();
    keepReadsOf(client);
    let land: (value: unknown) => void = () => undefined;
    const slow = client.query({ queryKey: UNPAID, queryFn: () => new Promise((resolve) => { land = resolve; }) });
    setShownCompany(USER_A, COMPANY_B);
    land(demoUnpaid());
    await slow;
    await flushKeptReads();
    expect(await store.all()).toEqual([]);
  });

  it("drops a row older than a week, of another version, or that does not fit its read", async () => {
    const now = Date.now();
    const currency = JSON.stringify(["company-currency", "off"]);
    const loans = JSON.stringify(["loan-currency", COMPANY_A]);
    const client = newClient();
    // Each row is sound but for one thing.
    await store.put([row({ at: now - KEPT_MAX_AGE_MS - 1 })]);
    await restoreKeptReads(client, now);
    expect(await store.all()).toEqual([]);
    await store.put([row({ key: currency, data: "USD", version: KEPT_VERSION + 1 })]);
    await restoreKeptReads(client, now);
    expect(await store.all()).toEqual([]);
    await store.put([row({ key: loans, data: "USD", id: "not the key's hash" })]);
    await restoreKeptReads(client, now);
    expect(await store.all()).toEqual([]);
    await store.put([row({ key: "not json", id: "j" }), row({ key: JSON.stringify(["search", "off", "x"]), data: [] })]);
    await restoreKeptReads(client, now);
    expect(await store.all()).toEqual([]);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    // The same rows, sound, are put back.
    await store.put([row({ key: currency, data: "USD" })]);
    await restoreKeptReads(client, now);
    expect(client.getQueryData(["company-currency", "off"])).toBe("USD");
  });

  it("keeps a row just inside the week", async () => {
    const now = Date.now();
    const key = JSON.stringify(UNPAID);
    const first = newClient();
    keepReadsOf(first);
    await read(first, UNPAID, demoUnpaid());
    await flushKeptReads();
    const client = newClient();
    await restoreKeptReads(client, now + KEPT_MAX_AGE_MS - 60_000);
    expect(client.getQueryData(UNPAID)).toBeDefined();
    expect(await kept()).toEqual(new Set([key]));
  });

  it("checks a row against its read's schema and drops the one that fails", async () => {
    const good = newClient();
    keepReadsOf(good);
    await read(good, UNPAID, demoUnpaid());
    await flushKeptReads();
    const [saved] = await store.all();
    if (saved == null) throw new Error("nothing kept");
    // The read's shape changed since: a field the schema needs is gone.
    const broken = (saved.data as Array<Record<string, unknown>>).map(({ id: _id, ...rest }) => rest);
    await store.put([{ ...saved, data: broken }]);
    const client = newClient();
    await restoreKeptReads(client);
    expect(client.getQueryData(UNPAID)).toBeUndefined();
    expect(await store.all()).toEqual([]);
    // A shape-checked read too (the company currency is three capitals).
    await store.put([row({ id: "c", key: JSON.stringify(["company-currency", "off"]), data: "shekel" })]);
    await restoreKeptReads(client);
    expect(client.getQueryData(["company-currency", "off"])).toBeUndefined();
    expect(await store.all()).toEqual([]);
  });

  it("clears every row on sign-out, and a write that was waiting does not land after it", async () => {
    const client = newClient();
    keepReadsOf(client);
    await read(client, UNPAID, demoUnpaid());
    await flushKeptReads();
    await read(client, DASHBOARD, demoDashboard(null, null, "invoiced"));
    // The dashboard read is still waiting for its write when the user signs out.
    await forgetKeptReads();
    await flushKeptReads();
    expect(await store.all()).toEqual([]);
    await vi.waitFor(async () => { expect(await store.all()).toEqual([]); });
  });

  it("clears the rows on a load with no session, and for another user, and drops the cache's kept reads of that user", async () => {
    const first = newClient();
    keepReadsOf(first);
    await read(first, UNPAID, demoUnpaid());
    await flushKeptReads();
    const client = newClient();
    await restoreKeptReads(client);
    expect(client.getQueryData(UNPAID)).toBeDefined();
    // The session turns out to be the same user's: nothing changes.
    await keepKeptReadsFor(client, USER_A);
    expect(client.getQueryData(UNPAID)).toBeDefined();
    expect(await store.all()).toHaveLength(1);
    // Another user signed in.
    await keepKeptReadsFor(client, USER_B);
    expect(client.getQueryData(UNPAID)).toBeUndefined();
    expect(await store.all()).toEqual([]);
    // No session at all.
    await store.put([row({ id: "h" })]);
    await keepKeptReadsFor(client, null);
    expect(await store.all()).toEqual([]);
  });

  it("keeps the store under its cap, the oldest rows going first", async () => {
    const client = newClient();
    keepReadsOf(client);
    const big = "x".repeat(Math.floor(KEPT_MAX_BYTES / 2.5));
    const at = Date.now();
    for (const [index, month] of ["2026-07", "2026-08", "2026-09"].entries()) {
      // The month forecast, padded so three of them pass the cap.
      await client.query({ queryKey: ["month-forecast", "off", month], queryFn: () => Promise.resolve({ month, base: "ILS", build: {}, overrides: [], pad: big }) });
      client.getQueryCache().find({ queryKey: ["month-forecast", "off", month] })?.setState({ dataUpdatedAt: at + index });
      await flushKeptReads();
    }
    const left = (await store.all()).map((item) => (JSON.parse(item.key) as unknown[])[2] as string).sort();
    expect(left).toEqual(["2026-08", "2026-09"]);
  });

  it("does not keep a read that is not on the list, a preview's read, or a hand-written copy", async () => {
    const client = newClient();
    keepReadsOf(client);
    await read(client, ["search", "off", "q"], []);
    await read(client, ["unpaid", "empty"], []);
    client.setQueryData(UNPAID, demoUnpaid());
    await flushKeptReads();
    expect(await store.all()).toEqual([]);
  });

  it("keeps only Review's first page", async () => {
    const client = newClient();
    keepReadsOf(client);
    const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `t${String(index)}` }));
    await read(client, ["review", "off"], rows(50));
    await flushKeptReads();
    expect(await kept()).toEqual(new Set([JSON.stringify(["review", "off"])]));
    // More pages loaded: the first page's copy stays as it was.
    await read(client, ["review", "off"], rows(100));
    await flushKeptReads();
    expect(((await store.all())[0]?.data as unknown[]).length).toBe(50);
    // The list's state beside it comes back idle.
    client.setQueryData(["review-meta", "off", ""], { total: 80, loaded: 50, next: null, failed: false, loading: true });
    await flushKeptReads();
    const next = newClient();
    await restoreKeptReads(next);
    expect(next.getQueryData(["review-meta", "off", ""])).toEqual({ total: 80, loaded: 50, next: null, failed: false, loading: false });
  });

  it("says a read is kept while its fresh read is in flight, and not after", async () => {
    const first = newClient();
    keepReadsOf(first);
    await read(first, UNPAID, demoUnpaid());
    await flushKeptReads();
    const client = newClient();
    await restoreKeptReads(client);
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    const state = renderHook(() => useKeptState(UNPAID), { wrapper });
    expect(state.result.current).toEqual({ kept: true, refreshing: false });
    let land: (value: unknown) => void = () => undefined;
    const fetching = client.query({ queryKey: UNPAID, queryFn: () => new Promise((resolve) => { land = resolve; }), staleTime: 0 });
    await vi.waitFor(() => { expect(state.result.current).toEqual({ kept: true, refreshing: true }); });
    await act(async () => { land(demoUnpaid()); await fetching; });
    expect(state.result.current).toEqual({ kept: false, refreshing: false });
  });
});
