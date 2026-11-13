import type { ExpectedMonths } from "@flow/shared";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-1171: the company's expected_months, one read for Home's forecast and the תזרים צפוי screen (month-forecast-query)
 * and the company profit page's next month (company-next-month-query). Both use only `today` and `recurring[]`, and
 * recurring[] does not depend on p_months (forecast_any_month.sql), so both share this one request with one key.
 */
export function expectedMonthsQueryOptions(preview: string) {
  return {
    queryKey: ["expected-months", preview, "company", 1] as const,
    queryFn: async (): Promise<ExpectedMonths> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("expected_months", { p_months: 1 });
      if (error) throw error;
      return (await loadReadSchemas()).expectedMonthsSchema.parse(data);
    },
  };
}
