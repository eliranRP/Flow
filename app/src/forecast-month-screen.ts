import type { ForecastOverrideRow } from "@flow/shared";
import { useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import { forecastScope } from "./forecast-scope";
import { afterWrite, changeSkips, withSkip } from "./forecast-month";
import { assertNoError, useWrite } from "./use-write";

/**
 * FLOW-1336: what only the lazy forecast screens use (screens/forecast-screen.tsx, forecast-item-page.tsx, forecast-parts.tsx,
 * forecast-categories.ts): the month's date helpers and the reset and its undo. Kept out of forecast-month.ts, which Home's
 * entry imports for the skip path, so they load with those screens' chunks. The shared skip path (changeSkips, afterWrite,
 * withSkip) stays in forecast-month.ts, since a tap on Home runs it synchronously.
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
