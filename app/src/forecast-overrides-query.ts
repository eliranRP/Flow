import type { ForecastOverrideRow } from "@flow/shared";
import { readyClient } from "./ready-client";

/**
 * A month's overrides (forecast_overrides_for). Under "month-forecast", so the skip's write refreshes it. The month
 * forecast (month-forecast-query), a month to come on Home, the charge's page and the project page read it through
 * this one query, so a month's overrides go out once (FLOW-1191).
 */
export function overridesQuery(month: string, preview: string, enabled: boolean) {
  return {
    queryKey: ["month-forecast", preview, "overrides", month],
    enabled: enabled && preview === "off",
    queryFn: async (): Promise<ForecastOverrideRow[]> => {
      const supabase = await readyClient();
      const { data, error } = await supabase.rpc("forecast_overrides_for", { p_month: month });
      if (error) throw error;
      return (data ?? []) as ForecastOverrideRow[];
    },
  };
}
