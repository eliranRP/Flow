import type { ForecastOverrideRow } from "@flow/shared";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
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
    onSuccess: () => { dropInactiveCompanyInputs(client); },
    apply: ({ key, patch, prior, undo }) => changeSkips(client, month, (keys) => withSkip(keys, key, skipSet(undo ? priorPatch(prior) : patch))),
    run: async ({ key, patch, prior, undo }) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const body = undo ? priorPatch(prior) : patch;
      const result = await supabase.rpc("set_forecast_item", { p_month: month, p_item_key: key, p_patch: body });
      assertNoError(result);
    },
    keys: ["month-forecast"],
    // No success toast: the screen's own one carries ביטול, and a later toast would replace it (0182).
    failure: "לא הצלחנו לעדכן את הצפי",
    place: "top",
    scope: forecastScope(month),
  });
}

/** The company inputs' answers carry `skips` (FLOW-1195, FLOW-1202); the same shape as company-next-month-query's. */
type CompanySkips = { skips?: Record<string, string[]> };

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
 * FLOW-1214: moves one month's skip keys in every cached company inputs answer that carries `skips` (the full answer and
 * the slim one), with setQueryData and no read: the month's total follows the tap. Returns the undo, which takes out the
 * keys this change added and puts back the ones it took out, so a failed write leaves the answers as the other writes left them.
 */
function changeSkips(client: QueryClient, month: string, change: (keys: readonly string[]) => readonly string[]): () => void {
  watchForecastWrites(client);
  const touched: Array<{ key: readonly unknown[]; added: string[]; removed: string[] }> = [];
  const queries = client.getQueryCache().findAll({ queryKey: ["project-forecast-edits"], predicate: (query) => query.queryKey[2] === "company" });
  for (const query of queries) {
    const data = client.getQueryData<CompanySkips>(query.queryKey);
    if (data?.skips == null) continue;
    const before = data.skips[month] ?? [];
    const after = change(before);
    const added = after.filter((key) => !before.includes(key));
    const removed = before.filter((key) => !after.includes(key));
    if (added.length === 0 && removed.length === 0) continue;
    client.setQueryData(query.queryKey, { ...data, skips: { ...data.skips, [month]: [...after] } });
    touched.push({ key: query.queryKey, added, removed });
  }
  const undoForecast = patchCompanyForecast(client, month, change);
  return () => {
    undoForecast();
    for (const { key, added, removed } of touched) {
      const data = client.getQueryData<CompanySkips>(key);
      if (data?.skips == null) continue;
      const now = data.skips[month] ?? [];
      const restored = [...now.filter((item) => !added.includes(item)), ...removed.filter((item) => !now.includes(item))];
      client.setQueryData(key, { ...data, skips: { ...data.skips, [month]: restored } });
    }
  };
}

/** The company forecast's answers (FLOW-1308), under "month-forecast": ["month-forecast", preview, "company", "rows" | "totals", day, month(s)]. */
const isCompanyForecast = (query: { queryKey: readonly unknown[] }): boolean => query.queryKey[2] === "company";

type CompanyForecastPatch = (client: QueryClient, month: string, change: (keys: readonly string[]) => readonly string[]) => () => void;
let companyForecastPatch: CompanyForecastPatch | null = null;

/** company-forecast-query.ts (loaded with the screens that read the company forecast) says how a skip moves a month's rows. */
export function setCompanyForecastPatch(patch: CompanyForecastPatch): void {
  companyForecastPatch = patch;
}

/**
 * FLOW-1308: a skip, reset or undo moves the cached company forecast of its month at once (rows, totals and the income note
 * follow the tap, and the cached totals of that month with them); the patch drops the totals it cannot move. Without the patch
 * loaded (no screen has read the forecast this session) only a kept 'totals' can be cached, and it is dropped. Returns the undo.
 */
function patchCompanyForecast(client: QueryClient, month: string, change: (keys: readonly string[]) => readonly string[]): () => void {
  if (companyForecastPatch == null) client.removeQueries({ queryKey: ["month-forecast"], type: "inactive", predicate: isCompanyForecast });
  return companyForecastPatch?.(client, month, change) ?? (() => undefined);
}

/**
 * FLOW-1201, FLOW-1202, FLOW-1214: a skip, reset or undo patches the skips above and reads no company inputs. The inputs
 * no screen holds (Company profit's year views) are dropped, so they load fresh and never show pre-write figures
 * ("project-forecast-edits" is FORECAST_EDITS_KEY, named as text to keep project-next-month-query out of Home's entry).
 * FLOW-1308: the company forecast's cached answers are not dropped here: the patch at the tap already moved or dropped them, and a
 * success must keep the card's patched totals.
 */
function dropInactiveCompanyInputs(client: QueryClient) {
  client.removeQueries({ queryKey: ["month-forecast"], type: "inactive", predicate: (query) => isCompanyForecast(query) && (query.queryKey[5] as string).includes(",") });
  client.removeQueries({ queryKey: ["project-forecast-edits"], type: "inactive", predicate: (query) => query.queryKey[2] === "company" });
}

const watchedClients = new WeakSet<QueryClient>();

/**
 * FLOW-1214 (review): a write that fails can leave the cache ahead of the server. An overlapping write's delta is recorded
 * at its tap, so a later undo can remove or restore a key the server never changed, and a restore that fails partway
 * leaves the rows before it on the server. So once every write of a month's scope has settled and one of them failed,
 * the inputs no screen holds are dropped and the active ones are read again: the cache ends at the server's answer.
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
    dropInactiveCompanyInputs(client);
    void client.invalidateQueries({ queryKey: ["project-forecast-edits"], type: "active", predicate: (query) => query.queryKey[2] === "company" });
    void client.invalidateQueries({ queryKey: ["month-forecast"], type: "active", predicate: isCompanyForecast });
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
    onSuccess: () => { dropInactiveCompanyInputs(client); },
    apply: () => changeSkips(client, month, () => []),
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("reset_forecast_month", { p_month: month }));
    },
    keys: ["month-forecast"],
    failure: "לא הצלחנו לאפס את הצפי",
    place: "top",
    scope: forecastScope(month),
  });
}

/** The undo of a reset: each override the reset cleared is set back, the same write as a tap. */
export function useRestoreForecast(month: string) {
  const client = useQueryClient();
  return useWrite<ForecastOverrideRow[]>({
    onSuccess: () => { dropInactiveCompanyInputs(client); },
    apply: (rows) => changeSkips(client, month, (keys) => rows.reduce((next, row) => withSkip(next, row.item_key, row.moved_out), keys)),
    run: async (rows) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      for (const row of rows) {
        const patch = { amount_minor: row.amount_minor, due_on: row.due_on, moved_out: row.moved_out };
        assertNoError(await supabase.rpc("set_forecast_item", { p_month: month, p_item_key: row.item_key, p_patch: patch }));
      }
    },
    keys: ["month-forecast"],
    failure: "לא הצלחנו להחזיר את הצפי",
    place: "top",
    scope: forecastScope(month),
  });
}
