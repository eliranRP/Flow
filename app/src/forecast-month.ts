import type { ForecastOverrideRow } from "@flow/shared";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { dropKeptReads } from "./kept-reads";
import { getSupabase } from "./lib/supabase";
import { forecastScope } from "./forecast-scope";
import { assertNoError, useWrite } from "./use-write";

/**
 * FLOW-141: the month-end forecast's writes and its date helpers; its read is month-forecast-query.ts. Writes
 * are the app's RPCs (set_forecast_item, reset_forecast_month); their undo is the previous state, sent back the
 * same way.
 */

/** The last day of a YYYY-MM month (yyyy-mm-dd): the "עד סוף החודש" choice. */
export function monthEndDay(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year ?? 1970, mon ?? 1, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

/** The Saturday that ends the week of `today` (yyyy-mm-dd), in the same format. */
export function weekEndDay(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  const daysToSaturday = 6 - date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + daysToSaturday);
  return date.toISOString().slice(0, 10);
}

/** The month after a YYYY-MM month (December rolls into the next year). */
export function nextMonth(month: string): string {
  const [year = 1970, mon = 1] = month.split("-").map(Number);
  return mon === 12 ? `${String(year + 1)}-01` : `${String(year)}-${String(mon + 1).padStart(2, "0")}`;
}

/** Days from `today` (yyyy-mm-dd) to the month's last day, the day included in neither. */
export function daysLeftInMonth(today: string, month: string): number {
  const end = monthEndDay(month);
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** One item's change: an amount, a day, "not this month" (moved_out), or reset (Flow's number). */
export type ForecastPatch = { amount_minor?: number | null; due_on?: string | null; moved_out?: boolean; reset?: true };

export type ForecastWrite = { key: string; patch: ForecastPatch; undo: boolean; prior: ForecastOverrideRow | null };

/** The write sets one item; `undo` sends the item's prior state back (the same call, the old values). */
export function useSetForecastItem(month: string) {
  const client = useQueryClient();
  return useWrite<ForecastWrite>({
    onSuccess: () => { afterWrite(client, month); },
    apply: ({ key, patch, prior, undo }) => changeSkips(client, month, (keys) => withSkip(keys, key, skipSet(undo ? priorPatch(prior) : patch))),
    run: async ({ key, patch, prior, undo }) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const body = undo ? priorPatch(prior) : patch;
      const result = await supabase.rpc("set_forecast_item", { p_month: month, p_item_key: key, p_patch: body });
      assertNoError(result);
    },
    // FLOW-1323: no refetch of the month-forecast prefix (the company and project forecasts sit under it): afterWrite reads only the month's overrides and answer.
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

function withSkip(keys: readonly string[], key: string, out: boolean | undefined): readonly string[] {
  if (out == null) return keys;
  if (!out) return keys.filter((item) => item !== key);
  return keys.includes(key) ? keys : [...keys, key];
}

/**
 * FLOW-1214, FLOW-1308, FLOW-1315: a skip, reset or undo moves the skips of the forecasts held for its month (the company's and the
 * project page's), with setQueryData and no read: the month's figures follow the tap, and nothing reads them again after the write
 * (FLOW-1323: see afterWrite). Returns the undo, which takes out the keys this change added and puts back the ones it took out, so a
 * failed write leaves them as the other writes left them.
 */
function changeSkips(client: QueryClient, month: string, change: (keys: readonly string[]) => readonly string[]): () => void {
  watchForecastWrites(client);
  const undoForecast = patchCompanyForecast(client, month, change);
  // Without the project page's patch loaded (nothing has opened a project this session) a project forecast can only be a kept one, which the skip would leave ahead of the books: those of this month are dropped, so the page reads them fresh. The skip is per month: another month's answer is not touched.
  if (projectForecastPatch == null) client.removeQueries({ queryKey: ["month-forecast"], type: "inactive", predicate: (query) => isProjectForecast(query) && query.queryKey[4] === month });
  const undoProject = projectForecastPatch?.(client, month, change);
  // The device's kept rows of the answers this skip changes go too (a cold start would put the pre-skip figures back); the patched answers in memory stay.
  void dropKeptReads(keptForecastOf(month));
  return () => {
    undoForecast();
    undoProject?.();
  };
}

/** The kept reads a skip of `month` makes stale (`null`: all of them): the company's totals that include the month, and the project forecasts of the month. */
function keptForecastOf(month: string | null): (key: readonly unknown[]) => boolean {
  return (key) => key[0] === "month-forecast" && ((key[2] === "company" && key[3] === "totals" && (month == null || answersMonth(key, month))) || (key[2] === "project" && (month == null || key[4] === month)));
}

/** Whether a company forecast's key is for this month: its 'rows' name one, its 'totals' the months asked, joined with a comma. */
const answersMonth = (key: readonly unknown[], month: string): boolean => String(key[5]).split(",").includes(month);

/** The company forecast's answers (FLOW-1308), under "month-forecast": ["month-forecast", preview, "company", "rows" | "totals", day, month(s)]. */
const isCompanyForecast = (query: { queryKey: readonly unknown[] }): boolean => query.queryKey[2] === "company";

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
const isProjectForecast = (query: { queryKey: readonly unknown[] }): boolean => query.queryKey[2] === "project";

/**
 * FLOW-1308: a skip, reset or undo moves the cached company forecast of its month at once (rows, totals and the income note
 * follow the tap, and the cached totals of that month with them); the patch drops the totals it cannot move. Without the patch
 * loaded (no screen has read the forecast this session) only a kept 'totals' can be cached, and it is dropped when it is for this month
 * (a skip is per month: the answers for other months are not touched, FLOW-1323). Returns the undo.
 */
function patchCompanyForecast(client: QueryClient, month: string, change: (keys: readonly string[]) => readonly string[]): () => void {
  if (companyForecastPatch == null) client.removeQueries({ queryKey: ["month-forecast"], type: "inactive", predicate: (query) => isCompanyForecast(query) && answersMonth(query.queryKey, month) });
  return companyForecastPatch?.(client, month, change) ?? (() => undefined);
}

/**
 * FLOW-1323: what a successful skip, reset or undo of `month` reads again: only its overrides and its month_forecast answer, when a
 * screen holds them (the patch at the tap moved the company's and the projects' forecasts, which are not read again: that read is
 * the 102 KB company_forecast, and the write would wait for it). Not awaited, so the month's next write is not queued behind it. The
 * company's multi-month totals that include the month are dropped (the patch cannot move them; the tap dropped those it found, this
 * catches one read since); the card's patched totals stay.
 */
function afterWrite(client: QueryClient, month: string) {
  dropInactiveForecasts(client, month);
  void client.invalidateQueries({ queryKey: ["month-forecast"], predicate: (query) => (query.queryKey[2] === "overrides" || query.queryKey[2] === "answer") && query.queryKey[3] === month });
}

/**
 * FLOW-1308: after a failure (no month) every inactive company and project forecast is dropped, since an undone patch may leave them
 * ahead of the server, and so are their kept rows; with a month (a success) only the company's multi-month answers that include it.
 */
function dropInactiveForecasts(client: QueryClient, month?: string) {
  const all = month == null;
  client.removeQueries({ queryKey: ["month-forecast"], type: "inactive", predicate: (query) => isCompanyForecast(query) && (all || (String(query.queryKey[5]).includes(",") && answersMonth(query.queryKey, month))) });
  if (all) {
    client.removeQueries({ queryKey: ["month-forecast"], type: "inactive", predicate: isProjectForecast });
    void dropKeptReads(keptForecastOf(null));
  }
}

const watchedClients = new WeakSet<QueryClient>();

/**
 * FLOW-1214 (review): a write that fails can leave the cache ahead of the server. An overlapping write's delta is recorded
 * at its tap, so a later undo can remove or restore a key the server never changed, and a restore that fails partway
 * leaves the rows before it on the server. So once every write of a month's scope has settled and one of them failed,
 * the forecasts no screen holds are dropped and the active ones are read again: the cache ends at the server's answer.
 */
function watchForecastWrites(client: QueryClient) {
  if (watchedClients.has(client)) return;
  watchedClients.add(client);
  const failedScopes = new Set<string>();
  client.getMutationCache().subscribe((event) => {
    if (event.type !== "updated") return;
    const { mutation } = event;
    const scope = mutation.options.scope?.id;
    if (scope == null || !scope.startsWith(forecastScope(""))) return;
    if (mutation.state.status === "error") failedScopes.add(scope);
    if (!failedScopes.has(scope) || mutation.state.status === "pending") return;
    const unsettled = client.getMutationCache().findAll({ predicate: (other) => other.options.scope?.id === scope && other.state.status === "pending" });
    if (unsettled.length > 0) return;
    failedScopes.delete(scope);
    dropInactiveForecasts(client);
    void client.invalidateQueries({ queryKey: ["month-forecast"], type: "active", predicate: isCompanyForecast });
    void client.invalidateQueries({ queryKey: ["month-forecast"], type: "active", predicate: isProjectForecast });
  });
}

/** The patch that puts an item back to its prior state (null: Flow's number). */
export function priorPatch(prior: ForecastOverrideRow | null): ForecastPatch {
  if (prior == null) return { reset: true };
  return { amount_minor: prior.amount_minor, due_on: prior.due_on, moved_out: prior.moved_out };
}

export function useResetForecastMonth(month: string) {
  const client = useQueryClient();
  return useWrite({
    onSuccess: () => { afterWrite(client, month); },
    apply: () => changeSkips(client, month, () => []),
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("reset_forecast_month", { p_month: month }));
    },
    // FLOW-1323: no refetch of the month-forecast prefix (the company and project forecasts sit under it): afterWrite reads only the month's overrides and answer.
    keys: [],
    failure: "לא הצלחנו לאפס את הצפי",
    place: "top",
    scope: forecastScope(month),
  });
}

/** The undo of a reset: each override the reset cleared is set back, the same write as a tap. */
export function useRestoreForecast(month: string) {
  const client = useQueryClient();
  return useWrite<ForecastOverrideRow[]>({
    onSuccess: () => { afterWrite(client, month); },
    apply: (rows) => changeSkips(client, month, (keys) => rows.reduce((next, row) => withSkip(next, row.item_key, row.moved_out), keys)),
    run: async (rows) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      for (const row of rows) {
        const patch = { amount_minor: row.amount_minor, due_on: row.due_on, moved_out: row.moved_out };
        assertNoError(await supabase.rpc("set_forecast_item", { p_month: month, p_item_key: row.item_key, p_patch: patch }));
      }
    },
    // FLOW-1323: no refetch of the month-forecast prefix (the company and project forecasts sit under it): afterWrite reads only the month's overrides and answer.
    keys: [],
    failure: "לא הצלחנו להחזיר את הצפי",
    place: "top",
    scope: forecastScope(month),
  });
}
