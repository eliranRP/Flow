import type { ForecastOverrideRow } from "@flow/shared";
import { useQueryClient, type Query, type QueryClient } from "@tanstack/react-query";
import { dropKeptReads } from "./kept-reads";
import { getSupabase } from "./lib/supabase";
import type { Settled } from "./forecast-month-settle";
import { forecastScope } from "./forecast-scope";
import { assertNoError, useWrite } from "./use-write";

/**
 * FLOW-141: the month-end forecast's writes; its read is month-forecast-query.ts. Writes are the app's RPCs
 * (set_forecast_item, reset_forecast_month); their undo is the previous state, sent back the same way. The reset,
 * its undo and the date helpers the forecast screens use are in forecast-month-screen.ts (FLOW-1336).
 */

/** One item's change: an amount, a day, "not this month" (moved_out), or reset (Flow's number). */
export type ForecastPatch = { amount_minor?: number | null; due_on?: string | null; moved_out?: boolean; reset?: true };

export type ForecastWrite = { key: string; patch: ForecastPatch; undo: boolean; prior: ForecastOverrideRow | null };

/** The write sets one item; `undo` sends the item's prior state back (the same call, the old values). */
export function useSetForecastItem(month: string) {
  const client = useQueryClient();
  return useWrite<ForecastWrite>({
    apply: ({ key, patch, prior, undo }) => changeSkips(client, month, (keys) => withSkip(keys, key, skipSet(undo ? priorPatch(prior) : patch))),
    run: async ({ key, patch, prior, undo }) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const body = undo ? priorPatch(prior) : patch;
      const result = await supabase.rpc("set_forecast_item", { p_month: month, p_item_key: key, p_patch: body });
      assertNoError(result);
    },
    // FLOW-1323: no refetch of the month-forecast prefix (the company and project forecasts sit under it): the month's writes, once settled, read only its overrides and answer (forecast-month-settle.ts).
    keys: [],
    // No success toast: the screen's own one carries ביטול, and a later toast would replace it (0182).
    failure: "לא הצלחנו לעדכן את הצפי",
    place: "top",
    scope: forecastScope(month),
  });
}

/** The skip a write sets: true takes the item out of the month, false puts it back, undefined leaves the skip alone (an amount or a day). */
function skipSet(patch: ForecastPatch): boolean | undefined {
  if (patch.reset === true) return false;
  return patch.moved_out;
}

export function withSkip(keys: readonly string[], key: string, out: boolean | undefined): readonly string[] {
  if (out == null) return keys;
  if (!out) return keys.filter((item) => item !== key);
  return keys.includes(key) ? keys : [...keys, key];
}

/**
 * FLOW-1214, FLOW-1308, FLOW-1315: a skip, reset or undo moves the skips of the forecasts held for its month (the company's and the
 * project page's), with setQueryData and no read: the month's figures follow the tap, and nothing reads them again after the write
 * (FLOW-1323, FLOW-1341: forecast-month-settle.ts). Returns the undo, which takes out the keys this change added and puts back the ones it took out, so a
 * failed write leaves them as the other writes left them.
 */
export function changeSkips(client: QueryClient, month: string, change: (keys: readonly string[]) => readonly string[]): () => void {
  const scope = forecastScope(month);
  touch(client, scope);
  void loadSettle().then((settle) => { settle.watchWrites(client); });
  // A read of this month's forecast under way would land the pre-skip answer over the patch: it is stopped (its cancel puts the state it started from back, a moment later, so the patch is made again then) and noted, to be read again once the month's writes have settled.
  const reading = client.getQueryCache().findAll({ queryKey: ["month-forecast"], predicate: (query) => isForecastOf(query.queryKey, month) && query.state.fetchStatus === "fetching" });
  const patch = (): (() => void) => {
    // Without a patch loaded (nothing has opened the company's forecast or a project this session) a forecast of this month can only be a kept one, which the skip would leave ahead of the books: it is dropped, so the page reads it fresh. The skip is per month: another month's answer is not touched.
    client.removeQueries({ queryKey: ["month-forecast"], type: "inactive", predicate: (query) => (query.queryKey[2] === "company" ? companyForecastPatch == null : projectForecastPatch == null) && isForecastOf(query.queryKey, month) });
    const undos = [companyForecastPatch?.(client, month, change), projectForecastPatch?.(client, month, change)];
    return () => { for (const undo of undos) undo?.(); };
  };
  for (const query of reading) touch(client, scope, query.queryKey);
  const cancelled = client.cancelQueries({ queryKey: ["month-forecast"], predicate: (query) => reading.includes(query) });
  const undo = patch();
  let again: () => void = () => undefined;
  if (reading.length > 0) void cancelled.then(() => { again = patch(); });
  // The device's kept rows of the answers this skip changes go too (a cold start would put the pre-skip figures back); the patched answers in memory stay, and are kept again once the month's writes have settled (FLOW-1341).
  void dropKeptReads(keptForecastOf(month));
  return () => {
    again();
    undo();
  };
}

/** The company's or a project's forecast answer that holds `month` (company 'rows' name one month, 'totals' the months asked, joined with a comma; a project's key has its month at 4). */
export function isForecastOf(key: readonly unknown[], month: string): boolean {
  return key[0] === "month-forecast" && ((key[2] === "company" && answersMonth(key, month)) || (key[2] === "project" && key[4] === month));
}

/**
 * The kept reads a skip of `month` makes stale (`null`, after a failure: the company's totals and project forecasts of any month): the company's totals
 * that include the month, the project forecasts of the month and, FLOW-1341, the month's own `answer` and `overrides`, which no screen may hold
 * at the skip (one from the project page), so a cold Home start would draw the pre-skip forecast row.
 */
export function keptForecastOf(month: string | null): (key: readonly unknown[]) => boolean {
  const stale = (key: readonly unknown[]) => key[2] === "project" || key[3] === "totals";
  // Under a month's key, the answer's and the overrides' are the only ones that have the month at 3.
  return (key) => key[0] === "month-forecast" && (month == null || isForecastOf(key, month) ? stale(key) : key[3] === month);
}

/** Whether a company forecast's key is for this month: its 'rows' name one, its 'totals' the months asked, joined with a comma. */
export const answersMonth = (key: readonly unknown[], month: string): boolean => String(key[5]).split(",").includes(month);

type CompanyForecastPatch = (client: QueryClient, month: string, change: (keys: readonly string[]) => readonly string[]) => () => void;
let companyForecastPatch: CompanyForecastPatch | null = null;

/** company-forecast-query.ts (loaded with the screens that read the company forecast) says how a skip moves a month's rows. */
export function setCompanyForecastPatch(patch: CompanyForecastPatch): void {
  companyForecastPatch = patch;
}

/** FLOW-1315: the same for the project page's forecast (project-forecast-query.ts, ["month-forecast", preview, "project", ...]); none held before it loads. */
let projectForecastPatch: CompanyForecastPatch | null = null;
export function setProjectForecastPatch(patch: CompanyForecastPatch): void {
  projectForecastPatch = patch;
}

let settleModule: Promise<typeof import("./forecast-month-settle")> | null = null;
/** The code that runs once a month's writes have settled (its own chunk, off Home's entry): started at the first tap, so it is here when the write answers. */
const loadSettle = () => (settleModule ??= import("./forecast-month-settle").catch((error: unknown) => { settleModule = null; throw error; }));

/**
 * FLOW-1214 (review): a write that fails can leave the cache ahead of the server. An overlapping write's delta is recorded
 * at its tap, so a later undo can remove or restore a key the server never changed, and a restore that fails partway
 * leaves the rows before it on the server. So once every write of a month's scope has settled and one of them failed,
 * the forecasts no screen holds are dropped and the active ones are read again: the cache ends at the server's answer.
 *
 * FLOW-1323: a forecast read of the month that was under way at a tap, or that begins while one of the month's writes is out,
 * may carry the pre-skip answer over the patch, and nothing reads the forecast after a skip. Those queries are noted
 * (`touch`), and when the scope settles each is read again if a screen holds it and dropped, with its kept row, if none does.
 *
 * FLOW-1341: the writes of a scope make one burst, which settles once, when the scope has no write out (forecast-month-settle.ts,
 * which watches the writes): the month's overrides and answer are read again once, not after each write.
 */
const burstsByClient = new WeakMap<QueryClient, Map<string, Settled>>();

/** A client's open bursts, by scope; the first call starts noting the forecast reads that begin while a write of the month is out. */
export function burstsOf(client: QueryClient): Map<string, Settled> {
  const known = burstsByClient.get(client);
  if (known != null) return known;
  const bursts = new Map<string, Settled>();
  burstsByClient.set(client, bursts);
  const mutations = client.getMutationCache();
  const prefix = forecastScope("");
  client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "fetch") return;
    const key = (event.query as Query).queryKey;
    for (const write of mutations.findAll({ predicate: (other) => other.state.status === "pending" })) {
      const scope = write.options.scope?.id;
      if (scope?.startsWith(prefix) === true && isForecastOf(key, scope.slice(prefix.length))) touch(client, scope, key);
    }
  });
  return bursts;
}

/** Starts the scope's burst (a tap) or notes a forecast query of the scope's month, whose key is given. */
function touch(client: QueryClient, scope: string, key?: readonly unknown[]): void {
  const bursts = burstsOf(client);
  const burst = bursts.get(scope) ?? { held: undefined, ok: false, failed: false, since: Date.now() };
  bursts.set(scope, burst);
  if (key != null) burst.held = (burst.held ?? new Set<string>()).add(JSON.stringify(key));
}

/** The patch that puts an item back to its prior state (null: Flow's number). */
export function priorPatch(prior: ForecastOverrideRow | null): ForecastPatch {
  if (prior == null) return { reset: true };
  return { amount_minor: prior.amount_minor, due_on: prior.due_on, moved_out: prior.moved_out };
}
