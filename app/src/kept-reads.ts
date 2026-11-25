import { hashKey, useQueryClient, type Query, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { shownCompanyId, shownCompanyUser } from "./lib/company-header";
import { loadReadSchemas } from "./load-read-schemas";
import { idbKeptStore, type KeptRow, type KeptStore } from "./kept-store";
import { keptRuleOf, type KeptRule } from "./kept-rules";

/**
 * FLOW-1267 (decision 0271): the main screens' first reads are kept on the device (IndexedDB) and put
 * back into the query cache before the first frame, so a repeat visit draws at once and the fresh read
 * runs behind it. It replaces the project page's own saved read (FLOW-804).
 *
 * - Which reads: kept-rules.ts. Each is written after a successful read, a moment later, in one batch.
 * - Whose: every row names the user and the shown company it was read for. A row of another user or
 *   company is never put back (and is deleted); sign-out and a basis change drop every row; rows older
 *   than a week go; the store holds about 5 MB and drops the oldest rows first.
 * - A put-back read keeps its real time as dataUpdatedAt (the offline line needs it) and is invalidated, so it is stale: the screen draws it and its query reads again at once.
 *   `useKeptState` says so while it is drawn.
 * - A rule may trim what it keeps (`save`, FLOW-1296): the trimmed data is what is stored and counted.
 * - A row is checked against its read's schema (or shape) first, and dropped when it fails. Bump
 *   KEPT_VERSION when a read's shape changes on purpose: rows of another version are dropped.
 */
export const KEPT_VERSION = 1;
export const KEPT_MAX_AGE_MS = 7 * 86_400_000;
export const KEPT_MAX_BYTES = 5_000_000;
/** A write waits this long, so a burst of reads (Home's) is one transaction. */
const FLUSH_MS = 400;

let store: KeptStore = idbKeptStore();
let generation = 0;
let hydrating = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<unknown> = Promise.resolve();
/** The user and company the cache's kept reads were put back for, if any. */
let restoredFor: string | null = null;
let checkedFor: string | null | undefined;
const showing = new Set<string>();
const pending = new Map<string, Omit<KeptRow, "version" | "size">>();
const startedFor = new Map<string, string>();
const index = new Map<string, { at: number; size: number }>();

/** Who a read may be kept for now: the signed-in user and the company the app shows. */
function ownerNow(): string | null {
  const user = shownCompanyUser();
  const company = shownCompanyId();
  return user == null || company == null ? null : `${user}|${company}`;
}

function toJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJson(item)]));
  return value;
}

/** The bytes the row's data takes as text (Hebrew is two bytes a letter), the cap's measure. */
function sizeOf(data: unknown): number {
  return new TextEncoder().encode(JSON.stringify(toJson(data))).length;
}

function enqueue(work: () => Promise<unknown>): Promise<unknown> {
  queue = queue.then(work).catch(() => undefined);
  return queue;
}

/** The ids to drop so the kept rows fit the cap, oldest first. */
function overCap(): string[] {
  let total = 0;
  for (const row of index.values()) total += row.size;
  const drop: string[] = [];
  for (const [id, row] of [...index.entries()].sort((a, b) => a[1].at - b[1].at)) {
    if (total <= KEPT_MAX_BYTES) break;
    total -= row.size;
    drop.push(id);
  }
  for (const id of drop) index.delete(id);
  return drop;
}

/** Writes what was read since the last write. A sign-out in between drops it. */
export function flushKeptReads(): Promise<unknown> {
  if (timer != null) clearTimeout(timer);
  timer = null;
  const batch = [...pending.values()];
  pending.clear();
  const started = generation;
  return enqueue(async () => {
    const owner = ownerNow();
    const rows = batch
      .filter((row) => row.owner === owner)
      .map((row) => ({ ...row, version: KEPT_VERSION, size: sizeOf(row.data) }));
    if (started !== generation || rows.length === 0) return;
    for (const row of rows) index.set(row.id, { at: row.at, size: row.size });
    const evicted = overCap();
    await store.put(rows);
    if (evicted.length > 0) await store.remove(evicted);
  });
}

function schedule(): void {
  timer ??= setTimeout(() => { void flushKeptReads(); }, FLUSH_MS);
}

/** Puts the kept reads of this user and company back in the cache, stale; drops the rows that do not belong or do not fit. Nothing is put back before its check. */
export async function restoreKeptReads(client: QueryClient, now = Date.now()): Promise<void> {
  const owner = ownerNow();
  // No user and company yet (a signed-out start, a preview): nothing to put back, and the store is not opened.
  // The session, once known, drops the rows of everyone else (keepKeptReadsFor).
  if (owner == null) return;
  // The schemas load (one chunk, the slow part on a phone) beside the store's read; the app needs them for its first read anyway.
  const [rows, schemas] = await Promise.all([store.all(), loadReadSchemas().catch(() => null)]);
  const drop: string[] = [];
  const fits: Array<{ row: KeptRow; key: QueryKey; rule: KeptRule }> = [];
  for (const row of rows) {
    const key = parseKey(row.key);
    const rule = key == null ? null : keptRuleOf(key);
    if (key != null && rule != null && row.owner === owner && row.version === KEPT_VERSION && now - row.at <= KEPT_MAX_AGE_MS && hashKey(key) === row.id) {
      fits.push({ row, key, rule });
    } else {
      drop.push(row.id);
    }
  }
  for (const { row, key, rule } of fits) {
    // The user or company changed while the rows were read: not these rows'. They stay in the store, and count in the cap.
    if (ownerNow() !== owner) { index.set(row.id, { at: row.at, size: row.size }); continue; }
    index.set(row.id, { at: row.at, size: row.size });
    if (!rule.valid(schemas, toJson(row.data))) {
      // A schema that cannot load keeps the row for next time.
      if (schemas != null) { drop.push(row.id); index.delete(row.id); }
      continue;
    }
    const query = client.getQueryCache().find({ queryKey: key, exact: true });
    if (query?.state.data !== undefined) continue;
    showing.add(row.id);
    // The read keeps the time it came in (the offline line says how old the figures are), and is marked invalid, so
    // it counts as stale: the next observer, and client.query, read it again. Our own write is not kept again.
    hydrating = true;
    try {
      client.setQueryData(key, rule.restore == null ? row.data : rule.restore(row.data), { updatedAt: row.at });
      void client.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
    } finally {
      hydrating = false;
    }
    restoredFor = owner;
    // A mounted query whose own read already failed (error, no data) is idle: nothing else reads it until focus or a
    // remount. One that is fetching is left alone.
    const hydrated = client.getQueryCache().find({ queryKey: key, exact: true });
    if (hydrated?.isActive() === true && hydrated.state.fetchStatus !== "fetching") {
      void client.refetchQueries({ queryKey: key, exact: true, type: "active" });
    }
  }
  if (drop.length > 0) await store.remove(drop);
}

function parseKey(json: string): QueryKey | null {
  try {
    const key: unknown = JSON.parse(json);
    return Array.isArray(key) ? (key as unknown[]) : null;
  } catch {
    return null;
  }
}

/** Starts keeping each allowed read as it succeeds. Returns the stop. */
export function keepReadsOf(client: QueryClient): () => void {
  return client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || hydrating) return;
    const { query, action } = event;
    const key = query.queryKey as readonly unknown[];
    const rule = keptRuleOf(key);
    if (rule == null) return;
    const hash = query.queryHash;
    if (action.type === "fetch") {
      const owner = ownerNow();
      if (owner == null) startedFor.delete(hash);
      else startedFor.set(hash, owner);
      return;
    }
    // A read that failed is no longer under way: a hand-written copy beside it is not kept for it.
    if (action.type === "error") {
      startedFor.delete(hash);
      return;
    }
    if (action.type !== "success") return;
    const manual = "manual" in action && action.manual === true;
    if (manual && rule.manual !== true) return;
    const owner = ownerNow();
    // A read that began for another company, or before one was shown, is not this one's.
    // A hand-written copy (Review's list state) is kept only beside the read it belongs to, begun for the same owner.
    const readFor = manual ? (rule.pair == null ? owner : (startedFor.get(hashKey(rule.pair(key))) ?? null)) : (startedFor.get(hash) ?? null);
    if (!manual) startedFor.delete(hash);
    const data: unknown = query.state.data;
    const { dataUpdatedAt } = query.state;
    if (owner == null || readFor !== owner || data == null || dataUpdatedAt === 0) return;
    if (rule.keep != null && !rule.keep(data)) return;
    pending.set(hash, { id: hash, owner, at: dataUpdatedAt, key: JSON.stringify(key), data: rule.save == null ? data : rule.save(data) });
    schedule();
  });
}

/**
 * At launch, before the first render: keeps reads from now on and starts putting the kept ones back. The render does
 * not wait for it: measured at CPU x4 on 4G, the store's read takes about 60 to 125 ms and the schemas' chunk about
 * 230 ms more, so a first render that waited would be late by that and still draw its first frame without the data
 * (waiting up to 250 ms delayed the project page's figures by 200 to 450 ms). The put-back lands about 300 ms after
 * the first render, and before any lazy screen opens; the query cache tells the screen that is open.
 */
export function startKeptReads(client: QueryClient): Promise<void> {
  keepReadsOf(client);
  return restoreKeptReads(client).catch(() => undefined);
}

function forgetPending(): void {
  generation += 1;
  pending.clear();
  index.clear();
  // A read that began before this and lands after it is not kept.
  startedFor.clear();
  if (timer != null) clearTimeout(timer);
  timer = null;
}

/** Sign-out, a user switch and a basis change: every kept read goes. */
export function forgetKeptReads(): Promise<unknown> {
  forgetPending();
  return enqueue(() => store.clear());
}

/**
 * FLOW-1323: a write that changes some answers drops their kept rows (whether or not the cache still holds them; found by id), so a cold start
 * does not put the pre-write figures back. A read still waiting for its write-out goes too.
 */
export function dropKeptReads(match: (key: readonly unknown[]) => boolean): Promise<unknown> {
  for (const [hash, row] of pending) if (match(parseKey(row.key) ?? [])) pending.delete(hash);
  return enqueue(async () => {
    // The id is the key's hash (its JSON): the ids are read without the rows' data, and an id that is not a key is left alone.
    const ids = (await store.ids()).filter((id) => { const key = parseKey(id); return key != null && match(key); });
    if (ids.length === 0) return;
    for (const id of ids) index.delete(id);
    await store.remove(ids);
  });
}

/** A kept read in the cache that no fresh read has replaced yet. */
function isKept(query: Query): boolean {
  return showing.has(query.queryHash) && query.state.isInvalidated && query.state.data !== undefined;
}

/**
 * The session is known: a load with no user, or another one than the reads were kept for, drops them (as the saved
 * role does, FLOW-603), and the cache shows none of them. The same user again does nothing.
 */
export function keepKeptReadsFor(client: QueryClient, userId: string | null): Promise<unknown> {
  if (restoredFor != null && restoredFor.split("|")[0] !== userId) {
    const cache = client.getQueryCache();
    for (const query of cache.findAll({ predicate: isKept })) cache.remove(query);
    showing.clear();
    restoredFor = null;
  }
  if (userId === checkedFor) return queue;
  checkedFor = userId;
  if (userId == null) return forgetKeptReads();
  return enqueue(async () => {
    const stale = (await store.all()).filter((row) => row.owner.split("|")[0] !== userId).map((row) => row.id);
    for (const id of stale) index.delete(id);
    if (stale.length > 0) await store.remove(stale);
  });
}

/**
 * FLOW-1268's hint: whether the query's data is a kept read (not yet replaced by a fresh one), and whether its fresh
 * read is in flight. A kept read that could not be refreshed (offline) stays kept and not refreshing.
 * Used by tests only until the hint draws it.
 * @forTests
 */
export function useKeptState(key: QueryKey): { kept: boolean; refreshing: boolean } {
  const cache = useQueryClient().getQueryCache();
  const read = (): number => {
    const query = cache.find({ queryKey: key, exact: true });
    if (query == null || !isKept(query)) return 0;
    return query.state.fetchStatus === "fetching" ? 2 : 1;
  };
  const state = useSyncExternalStore((onChange) => cache.subscribe(onChange), read, read);
  return { kept: state > 0, refreshing: state === 2 };
}

/**
 * Tests: a fresh store, and no state left from the last test.
 * @forTests
 */
export function resetKeptReadsForTests(next: KeptStore = idbKeptStore()): void {
  store = next;
  forgetPending();
  queue = Promise.resolve();
  restoredFor = null;
  hydrating = false;
  checkedFor = undefined;
  showing.clear();
  startedFor.clear();
}
