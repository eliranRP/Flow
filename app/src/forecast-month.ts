import { buildMonthForecast, type ForecastBuild, type ForecastOverrideRow } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { useHomePreview } from "./preview";
import { assertNoError, useWrite } from "./use-write";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-141: the month-end forecast's data. Three reads (expected months, open invoices, the
 * month's overrides) go through the shared builder, so the screen and Home's number agree. Writes
 * are the app's RPCs (set_forecast_item, reset_forecast_month); their undo is the previous state,
 * sent back the same way.
 */

export type MonthForecast = {
  month: string;
  build: ForecastBuild;
  overrides: ForecastOverrideRow[];
};

/** The last day of a YYYY-MM month (yyyy-mm-dd): the "עד סוף החודש" choice. */
export function monthEndDay(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year ?? 1970, mon ?? 1, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

/** Days from `today` (yyyy-mm-dd) to the month's last day, the day included in neither. */
export function daysLeftInMonth(today: string, month: string): number {
  const end = monthEndDay(month);
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

export function useMonthForecastQuery(month: string, active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["month-forecast", preview, month],
    enabled: active && preview === "off",
    queryFn: async (): Promise<MonthForecast> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const [expected, unpaid, overrides] = await Promise.all([
        supabase.rpc("expected_months", { p_months: 1 }),
        supabase.rpc("list_unpaid", {}),
        supabase.rpc("forecast_overrides_for", { p_month: month }),
      ]);
      if (expected.error) throw expected.error;
      if (unpaid.error) throw unpaid.error;
      if (overrides.error) throw overrides.error;
      const schemas = await loadReadSchemas();
      const rows = schemas.unpaidRowSchema.array().parse(unpaid.data ?? []);
      const current = (overrides.data ?? []) as ForecastOverrideRow[];
      return {
        month,
        overrides: current,
        build: buildMonthForecast({
          base: "ILS",
          expected: schemas.expectedMonthsSchema.parse(expected.data),
          unpaid: rows,
          overrides: current,
        }),
      };
    },
  });
}

/** One item's change: an amount, a day, "not this month" (moved_out), or reset (Flow's number). */
export type ForecastPatch = { amount_minor?: number | null; due_on?: string | null; moved_out?: boolean; reset?: true };

export type ForecastWrite = { key: string; patch: ForecastPatch; undo: boolean; prior: ForecastOverrideRow | null };

/** The write sets one item; `undo` sends the item's prior state back (the same call, the old values). */
export function useSetForecastItem(month: string) {
  return useWrite<ForecastWrite>({
    run: async ({ key, patch, prior, undo }) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const body = undo ? priorPatch(prior) : patch;
      const result = await supabase.rpc("set_forecast_item", { p_month: month, p_item_key: key, p_patch: body });
      assertNoError(result);
    },
    keys: ["month-forecast"],
    success: "הצפי עודכן",
    failure: "לא הצלחנו לעדכן את הצפי",
  });
}

/** The patch that puts an item back to its prior state (null: Flow's number). */
export function priorPatch(prior: ForecastOverrideRow | null): ForecastPatch {
  if (prior == null) return { reset: true };
  return { amount_minor: prior.amount_minor, due_on: prior.due_on, moved_out: prior.moved_out };
}

export function useResetForecastMonth(month: string) {
  return useWrite({
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("reset_forecast_month", { p_month: month }));
    },
    keys: ["month-forecast"],
    success: "הצפי חזר למספרים של Flow",
    failure: "לא הצלחנו לאפס את הצפי",
  });
}
