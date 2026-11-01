import type { ForecastBuild, ForecastOverrideRow } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { readStoredCurrency } from "./company-currency";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { useHomePreview } from "./preview";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-141: the month-end forecast's data. Four reads (expected months, open invoices, the month's overrides and,
 * FLOW-1005, the projects' forecast edits of the month) go through the shared builder. FLOW-1007: Home's forecast
 * row and the תזרים צפוי screen read this same query, so they show one number. It sits apart from the screen's
 * writes (forecast-month.ts), and the builder loads with its reads, so neither is in Home's entry.
 */

export type MonthForecast = {
  month: string;
  /** The company's currency (0147): the forecast counts its items and its cash. */
  base: string;
  build: ForecastBuild;
  overrides: ForecastOverrideRow[];
};

export function useMonthForecastQuery(month: string, active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["month-forecast", preview, month],
    enabled: active && preview === "off",
    queryFn: async (): Promise<MonthForecast> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const [expected, unpaid, overrides, edits, base] = await Promise.all([
        supabase.rpc("expected_months", { p_months: 1 }),
        supabase.rpc("list_unpaid", {}),
        supabase.rpc("forecast_overrides_for", { p_month: month }),
        supabase.rpc("company_forecast_edits_for", { p_month: month }),
        // A failed read fails the forecast: counting a dollar company in shekels would show nothing due.
        readStoredCurrency(),
      ]);
      if (expected.error) throw expected.error;
      if (unpaid.error) throw unpaid.error;
      if (overrides.error) throw overrides.error;
      if (edits.error) throw edits.error;
      const [schemas, { buildMonthForecast, parseMonthEdits }] = await Promise.all([loadReadSchemas(), import("./month-forecast-build")]);
      const projectEdits = parseMonthEdits(edits.data);
      const rows = schemas.unpaidRowSchema.array().parse(unpaid.data ?? []);
      const current = (overrides.data ?? []) as ForecastOverrideRow[];
      return {
        month,
        base,
        overrides: current,
        build: buildMonthForecast({
          base,
          expected: schemas.expectedMonthsSchema.parse(expected.data),
          unpaid: rows,
          overrides: current,
          edits: projectEdits.edits,
          overheadProjectId: projectEdits.overheadProjectId,
        }),
      };
    },
  });
}
