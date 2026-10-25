import type { WeeklySummary } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-517: one week for the weekly summary sheet (`weekly_summary`). The key starts with
 * "dashboard", so a write or focus refresh that refetches Home's figures refetches it too.
 */
export function useWeeklySummaryQuery(weekStart: string | null) {
  return useQuery({
    queryKey: ["dashboard", "weekly-summary", weekStart],
    enabled: weekStart != null,
    queryFn: async (): Promise<WeeklySummary> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("weekly_summary", { p_week_start: weekStart ?? "" });
      if (error) throw error;
      return (await loadReadSchemas()).weeklySummarySchema.parse(data);
    },
  });
}
