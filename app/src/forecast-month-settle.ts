import type { Mutation, QueryClient } from "@tanstack/react-query";
import { answersMonth, burstsOf, isForecastOf, keptForecastOf } from "./forecast-month";
import { forecastScope } from "./forecast-scope";
import { dropKeptReads, ownerNow, queueRead } from "./kept-reads";
import { keptRuleOf } from "./kept-rules";

/**
 * FLOW-1341: what happens once every write of a month's scope has settled (a skip, reset or undo, or a burst of them). It loads on its own,
 * from the first tap (forecast-month.ts), so Home's entry does not carry it; the tap's patch does not wait for it.
 */
export type Settled = {
  /** The forecast reads of the month noted while its writes were out (their keys as JSON). */
  held: Set<string> | undefined;
  /** At least one write of the burst was accepted. */
  ok: boolean;
  /** At least one write of the burst was refused. */
  failed: boolean;
  /** When the burst's first tap was made: what was written to the cache since is the patch's or a later read's. */
  since: number;
};

/** The company forecast's answers (FLOW-1308), under "month-forecast": ["month-forecast", preview, "company", "rows" | "totals", day, month(s)]; the project's are ["month-forecast", preview, "project", ...]. */
const isCompanyForecast = (query: { queryKey: readonly unknown[] }): boolean => query.queryKey[2] === "company";
const isProjectForecast = (query: { queryKey: readonly unknown[] }): boolean => query.queryKey[2] === "project";

const watching = new WeakSet<QueryClient>();

/**
 * Watches the client's forecast writes (the first tap loads this, and calls it at each tap): a burst settles when the last write of its scope has
 * answered. The writes already out when this loads are looked at too (a write can answer before the chunk is here).
 */
export function watchWrites(client: QueryClient): void {
  if (watching.has(client)) return;
  watching.add(client);
  const bursts = burstsOf(client);
  const mutations = client.getMutationCache();
  const prefix = forecastScope("");
  const pendingIn = (scope: string) => mutations.findAll({ predicate: (other) => other.options.scope?.id === scope && other.state.status === "pending" });
  const onWrite = (mutation: Mutation): void => {
    const scope = mutation.options.scope?.id;
    const { status } = mutation.state;
    const burst = scope == null ? undefined : bursts.get(scope);
    if (scope == null || burst == null || !scope.startsWith(prefix) || status === "idle") return;
    if (status === "error") burst.failed = true;
    if (status === "success") burst.ok = true;
    if (status === "pending" || pendingIn(scope).length > 0) return;
    bursts.delete(scope);
    settleForecastWrites(client, scope.slice(prefix.length), burst);
  };
  mutations.subscribe((event) => { if (event.type === "updated") onWrite(event.mutation as Mutation); });
  for (const mutation of mutations.getAll()) onWrite(mutation);
}

function settleForecastWrites(client: QueryClient, month: string, settled: Settled): void {
  if (settled.held != null) readAgain(client, settled.held);
  if (settled.ok) afterWrite(client, month);
  if (settled.failed) {
    dropInactiveForecasts(client);
    void client.invalidateQueries({ queryKey: ["month-forecast"], type: "active", predicate: (query) => isCompanyForecast(query) || isProjectForecast(query) });
    return;
  }
  if (settled.ok) keepPatched(client, month, settled);
}

/**
 * FLOW-1323, FLOW-1341: what a settled burst of skips, resets and undos of `month` reads again, once: only its overrides and its month_forecast
 * answer, where a screen holds them (the patch at each tap moved the company's and the projects' forecasts, which are not read again: that read is
 * the 102 KB company_forecast). One that no screen holds is dropped, since its pre-skip figures would flash before its read. The
 * company's multi-month totals that include the month are dropped (the patch cannot move them; the tap dropped those it found, this
 * catches one read since); the card's patched totals stay.
 */
function afterWrite(client: QueryClient, month: string): void {
  dropInactiveForecasts(client, month);
  const own = (query: { queryKey: readonly unknown[] }) => (query.queryKey[2] === "overrides" || query.queryKey[2] === "answer") && query.queryKey[3] === month;
  client.removeQueries({ queryKey: ["month-forecast"], type: "inactive", predicate: own });
  void client.invalidateQueries({ queryKey: ["month-forecast"], predicate: own });
}

/**
 * FLOW-1308: after a failure (no month) every inactive company and project forecast is dropped, since an undone patch may leave them
 * ahead of the server, and so are their kept rows; with a month (a success) only the company's multi-month answers that include it.
 */
function dropInactiveForecasts(client: QueryClient, month?: string): void {
  const all = month == null;
  client.removeQueries({ queryKey: ["month-forecast"], type: "inactive", predicate: (query) => (all ? isCompanyForecast(query) || isProjectForecast(query) : isCompanyForecast(query) && String(query.queryKey[5]).includes(",") && answersMonth(query.queryKey, month)) });
  if (all) void dropKeptReads(keptForecastOf(null));
}

/** FLOW-1323: the noted queries: read again where a screen holds one, removed where none does; their kept rows go either way. */
function readAgain(client: QueryClient, hashes: ReadonlySet<string>): void {
  void dropKeptReads((key) => hashes.has(JSON.stringify(key)));
  for (const hash of hashes) {
    const queryKey = JSON.parse(hash) as readonly unknown[];
    client.removeQueries({ queryKey, exact: true, type: "inactive" });
    void client.invalidateQueries({ queryKey, exact: true });
  }
}

/**
 * FLOW-1341: the tap deleted the device's copies of the answers it changes (the company's totals of the month, the month's project forecasts),
 * so a cold start would draw the pre-skip figures. The ones the cache holds were patched at the tap (written since the burst began, and not under a
 * read; every write marks them stale, so they read again when a screen next opens), and they are what the screens drew: they are kept again, now that the server has accepted the writes. A read noted
 * while the writes were out is kept by its own success, and a company total of several months cannot be patched, so it is not kept.
 */
function keepPatched(client: QueryClient, month: string, settled: Settled): void {
  const owner = ownerNow();
  const patched = (key: readonly unknown[]) => isForecastOf(key, month) && (key[2] === "project" || (key[3] === "totals" && key[5] === month)) && settled.held?.has(JSON.stringify(key)) !== true;
  for (const query of client.getQueryCache().findAll({ queryKey: ["month-forecast"], predicate: (item) => patched(item.queryKey) })) {
    const rule = keptRuleOf(query.queryKey);
    const { data, dataUpdatedAt, fetchStatus } = query.state;
    if (owner != null && rule != null && data != null && dataUpdatedAt >= settled.since && fetchStatus === "idle") queueRead(query, rule, owner);
  }
}
