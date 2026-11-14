import type { CashToDay } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { loadReadSchemas } from "./load-read-schemas";
import { useHomePreview, type HomePreview } from "./preview";
import { readyClient } from "./ready-client";

/**
 * FLOW-364. One month's נכנס and יצא up to a day of it (cash_month_to_day, decision 0168's cash
 * basis). Home's change pills compare the current month to the previous one up to the same day.
 * monthKey is YYYY-MM. Its key starts with "dashboard", so the cash refreshes refetch it too.
 */
export function cashToDayQueryOptions(preview: HomePreview, monthKey: string, day: number) {
  return {
    queryKey: ["dashboard", "cash-to-day", preview, monthKey, day],
    queryFn: async (): Promise<CashToDay> => {
      const supabase = await readyClient();
      const { data, error } = await supabase.rpc("cash_month_to_day", { p_month: `${monthKey}-01`, p_day: day });
      if (error) throw error;
      return (await loadReadSchemas()).cashToDaySchema.parse(data);
    },
  };
}

export function useCashToDayQuery(monthKey: string, day: number, active = true) {
  const preview = useHomePreview();
  return useQuery({ ...cashToDayQueryOptions(preview, monthKey, day), enabled: active && preview === "off" });
}
