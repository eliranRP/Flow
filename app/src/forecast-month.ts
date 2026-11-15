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
    onSuccess: () => { void refreshCompanyInputs(client); },
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

/**
 * FLOW-1201, FLOW-1202: the company inputs carry the skips, which Home's next-month card and the overhead project's
 * totals count. A write refetches the inputs a screen shows, so those counts follow the skip, and drops the ones no
 * screen holds (Company profit's year views), so they load fresh and never show pre-write figures
 * ("project-forecast-edits" is FORECAST_EDITS_KEY, named as text to keep project-next-month-query out of Home's entry).
 */
function refreshCompanyInputs(client: QueryClient) {
  const company = (query: { queryKey: readonly unknown[] }) => query.queryKey[2] === "company";
  client.removeQueries({ queryKey: ["project-forecast-edits"], type: "inactive", predicate: company });
  return client.invalidateQueries({ queryKey: ["project-forecast-edits"], type: "active", predicate: company });
}

/** The patch that puts an item back to its prior state (null: Flow's number). */
export function priorPatch(prior: ForecastOverrideRow | null): ForecastPatch {
  if (prior == null) return { reset: true };
  return { amount_minor: prior.amount_minor, due_on: prior.due_on, moved_out: prior.moved_out };
}

export function useResetForecastMonth(month: string) {
  const client = useQueryClient();
  return useWrite({
    onSuccess: () => { void refreshCompanyInputs(client); },
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
    onSuccess: () => { void refreshCompanyInputs(client); },
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
