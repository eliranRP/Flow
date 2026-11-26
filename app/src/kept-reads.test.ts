import { reviewRowSchema } from "@flow/shared";
import { hashKey, QueryClient, QueryObserver } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { IDBDatabase, IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDashboard, demoProject, demoUnpaid } from "./demo/model";
import {
  dropKeptReads,
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
/** A month forecast with nothing in it, in the shape the kept rule checks (FLOW-1314). */
const EMPTY_BUILD = { items: [], income: [], expense: [], moved: [], small: [], incomeTotal: 0n, expenseTotal: 0n, changed: 0 };
const DASHBOARD = ["dashboard", "off", { from: null, to: null }] as const;

let store: KeptStore;

/** Review rows as the read parses them. */
function reviewRows(count: number) {
  return Array.from({ length: count }, (_, index) => reviewRowSchema.parse({
    id: `t${String(index)}`,
    transaction_id: `x${String(index)}`,
    description: "קניה",
    doc_date: "2026-11-01",
    amount_net: 1000 + index,
    direction: "expense",
    reason: null,
    project_id: null,
    category_id: null,
    supplier_name: null,
  }));
}

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
    const readAt = first.getQueryState(UNPAID)?.dataUpdatedAt;
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
    // It keeps the time it was read, which the offline line shows; it is stale by being invalidated.
    expect(next.getQueryState(UNPAID)?.dataUpdatedAt).toBe(readAt);
    expect(next.getQueryState(UNPAID)?.isInvalidated).toBe(true);
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
    expect(next.getQueryState(options.queryKey)?.dataUpdatedAt).toBeGreaterThan(0);
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
    const client = newClient();
    // Each row is sound but for one thing.
    await store.put([row({ at: now - KEPT_MAX_AGE_MS - 1 })]);
    await restoreKeptReads(client, now);
    expect(await store.all()).toEqual([]);
    await store.put([row({ key: currency, data: "USD", version: KEPT_VERSION + 1 })]);
    await restoreKeptReads(client, now);
    expect(await store.all()).toEqual([]);
    await store.put([row({ key: currency, data: "USD", id: "not the key's hash" })]);
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

  it("keeps the company currency under its one key, and no longer keeps a loan currency read (FLOW-1298)", async () => {
    const now = Date.now();
    await store.put([row({ key: JSON.stringify(["loan-currency", COMPANY_A]), data: "USD" })]);
    const old = newClient();
    await restoreKeptReads(old, now);
    expect(old.getQueryData(["loan-currency", COMPANY_A])).toBeUndefined();
    expect(await store.all()).toEqual([]);
    const first = newClient();
    keepReadsOf(first);
    await read(first, ["company-currency", "off"], "USD");
    await flushKeptReads();
    expect(await kept()).toEqual(new Set([JSON.stringify(["company-currency", "off"])]));
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
      await client.query({ queryKey: ["month-forecast", "off", "answer", month], queryFn: () => Promise.resolve({ month, base: "ILS", build: EMPTY_BUILD, overrides: [], pad: big }) });
      client.getQueryCache().find({ queryKey: ["month-forecast", "off", "answer", month] })?.setState({ dataUpdatedAt: at + index });
      await flushKeptReads();
    }
    const left = (await store.all()).map((item) => (JSON.parse(item.key) as unknown[])[3] as string).sort();
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

  it("keeps only Review's first page, with the list's state read beside it", async () => {
    const client = newClient();
    keepReadsOf(client);
    const meta = { total: 80, loaded: 50, next: null, failed: false, loading: true };
    // The page writes the state from inside the list's read, as use-review.ts does.
    const list = (count: number) => client.query({
      queryKey: ["review", "off"],
      queryFn: () => {
        client.setQueryData(["review-meta", "off", ""], meta);
        return Promise.resolve(reviewRows(count));
      },
      staleTime: 0,
    });
    await list(50);
    await flushKeptReads();
    expect(await kept()).toEqual(new Set([JSON.stringify(["review", "off"]), JSON.stringify(["review-meta", "off", ""])]));
    // More pages loaded: the first page's copy stays as it was.
    await list(100);
    await flushKeptReads();
    const saved = (await store.all()).find((item) => item.key.startsWith('["review",'));
    expect((saved?.data as unknown[]).length).toBe(50);
    // The list's state beside it comes back idle.
    const next = newClient();
    await restoreKeptReads(next);
    expect(next.getQueryData(["review-meta", "off", ""])).toEqual({ ...meta, loading: false });
    expect((next.getQueryData(["review", "off"]) as unknown[]).length).toBe(50);
  });

  it("does not keep a read that began before a forget, when it lands after it", async () => {
    const client = newClient();
    keepReadsOf(client);
    let land: (value: unknown) => void = () => undefined;
    const slow = client.query({ queryKey: UNPAID, queryFn: () => new Promise((resolve) => { land = resolve; }) });
    await forgetKeptReads();
    land(demoUnpaid());
    await slow;
    await flushKeptReads();
    expect(await store.all()).toEqual([]);
  });

  it("does not keep Review's list or its state for the company shown when the read lands, if it began for another", async () => {
    const client = newClient();
    keepReadsOf(client);
    let land: (value: unknown) => void = () => undefined;
    const slow = client.query({
      queryKey: ["review", "off"],
      queryFn: () => new Promise((resolve) => { land = resolve; }).then((rows) => {
        // A company switch does not stop the read, which writes its state when it ends.
        client.setQueryData(["review-meta", "off", ""], { total: 3, loaded: 3, next: null, failed: false, loading: false });
        return rows;
      }),
    });
    setShownCompany(USER_A, COMPANY_B);
    land(reviewRows(3));
    await slow;
    await flushKeptReads();
    expect(await store.all()).toEqual([]);
    // A hand-written state with no read under way is not kept either.
    client.setQueryData(["review-meta", "off", ""], { total: 1, loaded: 1, next: null, failed: false, loading: false });
    await flushKeptReads();
    expect(await store.all()).toEqual([]);
  });

  it("drops a Review row that no longer fits its schema", async () => {
    const good = newClient();
    keepReadsOf(good);
    await read(good, ["review", "off"], reviewRows(2));
    await flushKeptReads();
    const [saved] = await store.all();
    if (saved == null) throw new Error("nothing kept");
    const broken = (saved.data as Array<Record<string, unknown>>).map(({ direction: _direction, ...rest }) => rest);
    await store.put([{ ...saved, data: broken }]);
    const client = newClient();
    await restoreKeptReads(client);
    expect(client.getQueryData(["review", "off"])).toBeUndefined();
    expect(await store.all()).toEqual([]);
    // The sound rows are put back.
    await store.put([saved]);
    await restoreKeptReads(client);
    expect(client.getQueryData(["review", "off"])).toEqual(reviewRows(2));
  });

  it("reads again a mounted query whose own read failed before the kept read came back, and leaves one in flight alone", async () => {
    const first = newClient();
    keepReadsOf(first);
    await read(first, UNPAID, demoUnpaid());
    await flushKeptReads();
    const client = newClient();
    const queryFn = vi.fn(() => Promise.reject<unknown>(new Error("offline")));
    const observer = new QueryObserver(client, { queryKey: UNPAID, queryFn, retry: false });
    const stop = observer.subscribe(() => undefined);
    await vi.waitFor(() => { expect(client.getQueryState(UNPAID)?.status).toBe("error"); });
    await restoreKeptReads(client);
    await vi.waitFor(() => { expect(queryFn).toHaveBeenCalledTimes(2); });
    stop();
    // A read still in flight is not cancelled by the put-back.
    const busy = newClient();
    let calls = 0;
    const slow = new QueryObserver(busy, { queryKey: UNPAID, queryFn: () => { calls += 1; return new Promise(() => undefined); } });
    const stopSlow = slow.subscribe(() => undefined);
    await restoreKeptReads(busy);
    expect(calls).toBe(1);
    stopSlow();
  });

  it("counts a row's size in bytes (Hebrew is two a letter), and counts rows it did not put back", async () => {
    const client = newClient();
    keepReadsOf(client);
    await read(client, ["company-currency", "off"], "USD");
    await read(client, ["month-forecast", "off", "answer", "2026-11"], { month: "2026-11", base: "ILS", build: EMPTY_BUILD, overrides: [], note: "א".repeat(100) });
    await flushKeptReads();
    const saved = await store.all();
    const forecast = saved.find((item) => item.key.includes("month-forecast"));
    expect(forecast?.size).toBe(new TextEncoder().encode(JSON.stringify(forecast?.data, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value))).length);
    expect(forecast?.size).toBeGreaterThan(200);
  });

  it("keeps Profit's overhead project only as a project with an id and a name, and never an unset one (FLOW-1278)", async () => {
    const key = ["company-overhead", "off"];
    const first = newClient();
    keepReadsOf(first);
    await read(first, key, { id: "p1", name: "כללי" });
    await flushKeptReads();
    const client = newClient();
    await restoreKeptReads(client);
    expect(client.getQueryData(key)).toEqual({ id: "p1", name: "כללי" });
    // No overhead project set (null) is never kept; a row of another shape is dropped.
    const none = newClient();
    keepReadsOf(none);
    await read(none, key, null);
    await flushKeptReads();
    await store.put([row({ key: JSON.stringify(key), data: { id: 5 } })]);
    const next = newClient();
    await restoreKeptReads(next);
    expect(next.getQueryData(key)).toBeUndefined();
    expect(await kept()).not.toContain(JSON.stringify(key));
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

  it("starts client.query from a kept read with a fresh read, and keeps the saved time offline (the profit page's readAt)", async () => {
    const { yearsRange } = await import("./company-years");
    const { useCompanyYears } = await import("./company-years-query");
    const { MemoryRouter } = await import("react-router-dom");
    const today = "2026-11-23";
    const { from, to } = yearsRange(today);
    const key = ["profit-months", "off", "company", from, to];
    const months = { basis: "invoiced", from: null, to: null, months: [], by_currency: [] };
    const savedAt = Date.now() - 3_600_000;
    await store.put([row({ key: JSON.stringify(key), data: months, at: savedAt })]);
    const client = newClient();
    await restoreKeptReads(client);
    expect(client.getQueryState(key)?.dataUpdatedAt).toBe(savedAt);
    // client.query (startHomeReads) treats it as stale and reads again.
    const queryFn = vi.fn(() => Promise.reject(new Error("offline")));
    await client.query({ queryKey: key, queryFn }).catch(() => undefined);
    expect(queryFn).toHaveBeenCalledTimes(1);
    // The page's reader, offline: the refresh on mount fails, and it still says when the figures were read.
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, children));
    const page = renderHook(() => useCompanyYears(today, true), { wrapper });
    await vi.waitFor(() => { expect(page.result.current.failed).toBe(true); });
    expect(page.result.current.readAt).toBe(savedAt);
  });

  // FLOW-1323: a write drops the kept rows of the answers it changes, found by id, with no row's data read.
  it("dropKeptReads deletes the stored rows whose key matches and leaves the others; ids that are not keys are left alone", async () => {
    const mine = ["month-forecast", "off", "project", "p1", "2026-12", "2026-11-24", "company"];
    const other = ["month-forecast", "off", "project", "p1", "2027-01", "2026-11-24", "company"];
    await store.put([row({ key: JSON.stringify(mine) }), row({ key: JSON.stringify(other) }), row({ id: "not-a-key", key: JSON.stringify(UNPAID) })]);
    const all = vi.spyOn(store, "all");
    await dropKeptReads((key) => key[4] === "2026-12");
    expect(all).not.toHaveBeenCalled();
    expect(await store.all().then((rows) => rows.map((item) => item.id).sort())).toEqual([hashKey(other), "not-a-key"].sort());
  });

  it("dropKeptReads also drops a read still waiting to be written, so a later flush does not keep it", async () => {
    const client = newClient();
    keepReadsOf(client);
    const key = ["month-forecast", "off", "project", "p1", "2026-12", "2026-11-24", "company"];
    const kept = ["month-forecast", "off", "project", "p1", "2027-01", "2026-11-24", "company"];
    await read(client, key, {});
    await read(client, kept, {});
    await dropKeptReads((candidate) => candidate[4] === "2026-12");
    await flushKeptReads();
    expect((await store.all()).map((item) => item.id)).toEqual([hashKey(kept)]);
  });

  // FLOW-1341: once the put-back has indexed the rows, a drop does not read the store first: no transaction when nothing matches, one write when something does.
  it("dropKeptReads opens no transaction when no kept row matches, and a single write when some do", async () => {
    const mine = ["month-forecast", "off", "overrides", "2026-12"];
    const other = ["month-forecast", "off", "overrides", "2027-01"];
    await store.put([row({ key: JSON.stringify(mine) }), row({ key: JSON.stringify(other) })]);
    await restoreKeptReads(newClient());
    const open = vi.spyOn(IDBDatabase.prototype, "transaction");
    await dropKeptReads((key) => key[3] === "2030-01");
    expect(open).not.toHaveBeenCalled();
    await dropKeptReads((key) => key[3] === "2026-12");
    expect(open.mock.calls.map((call) => call[1])).toEqual(["readwrite"]);
    open.mockRestore();
    expect((await store.all()).map((item) => item.id)).toEqual([hashKey(other)]);
  });
});
