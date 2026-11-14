import type { ExpectedMonths } from "@flow/shared";
import { loadReadSchemas } from "./load-read-schemas";
import { readyClient } from "./ready-client";

/**
 * FLOW-1171: the company's expected_months, one read for Home's forecast and the תזרים צפוי screen (month-forecast-query)
 * and the company profit page's next month (company-next-month-query). Both use only `today` and `recurring[]`, and
 * recurring[] does not depend on p_months (forecast_any_month.sql), so both share this one request with one key.
 * FLOW-1193: p_months 0 leaves out months[], which neither reads.
 */
export function expectedMonthsQueryOptions(preview: string) {
  return {
    queryKey: ["expected-months", preview, "company", 0] as const,
    queryFn: async (): Promise<ExpectedMonths> => {
      const supabase = await readyClient();
      const { data, error } = await supabase.rpc("expected_months", { p_months: 0 });
      if (error) throw error;
      return (await loadReadSchemas()).expectedMonthsSchema.parse(data);
    },
  };
}
