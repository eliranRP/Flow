import type { CashLinesPage, CashMonths, CashSide, CashYears } from "@flow/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { CASH_MONTHS, cashMonthKey } from "./cash";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { monthPeriod } from "./period";
import { useHomePreview, type HomePreview } from "./preview";
import type { CashRow } from "./ui/cash-rows";
import { useOptionalBooks } from "./use-books";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-413. The cash reads (decision 0168). Their keys start with "dashboard" and
 * "breakdown-lines", so every write and focus refresh that refetches Home's figures and the
 * breakdown lines refetches the cash view too.
 */

export function useCashMonthsQuery(active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["dashboard", "cash-months", preview, CASH_MONTHS],
    enabled: active && preview === "off",
    queryFn: async (): Promise<CashMonths> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("cash_months", { p_months: CASH_MONTHS });
      if (error) throw error;
      return (await loadReadSchemas()).cashMonthsSchema.parse(data);
    },
  });
}

/** FLOW-416: the net since the first cash month and per year, for the history page. */
export function cashYearsQueryOptions(preview: HomePreview) {
  return {
    queryKey: ["dashboard", "cash-years", preview],
    queryFn: async (): Promise<CashYears> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("cash_years", {});
      if (error) throw error;
      return (await loadReadSchemas()).cashYearsSchema.parse(data);
    },
  };
}

export function useCashYearsQuery(active = true) {
  const preview = useHomePreview();
  return useQuery({ ...cashYearsQueryOptions(preview), enabled: active && preview === "off" });
}

/** FLOW-416: one year's months, in the shape Home's months read (the current year to this month). */
export function cashYearMonthsQueryOptions(preview: HomePreview, year: number) {
  return {
    queryKey: ["dashboard", "cash-year-months", preview, year],
    queryFn: async (): Promise<CashMonths> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("cash_year_months", { p_year: year });
      if (error) throw error;
      return (await loadReadSchemas()).cashMonthsSchema.parse(data);
    },
  };
}

export function useCashYearMonthsQuery(year: number, active = true) {
  const preview = useHomePreview();
  return useQuery({ ...cashYearMonthsQueryOptions(preview, year), enabled: active && preview === "off" });
}

/**
 * The months a month page reads: Home's recent months, or, for an older month (opened from the
 * history), its year's months.
 */
export function useCashMonthData(monthKey: string, active = true) {
  const recent = useCashMonthsQuery(active);
  const older = recent.data != null && !recent.data.months.some((month) => cashMonthKey(month.month) === monthKey);
  const year = useCashYearMonthsQuery(Number(monthKey.slice(0, 4)), active && older);
  return { query: older ? year : recent, recent: !older };
}

const CASH_LINES_PAGE = 40;

/** One month's נכנס or יצא lines in one currency, newest first. */
export function useCashLinesQuery(month: string, side: CashSide, currency: string, active = true) {
  const preview = useHomePreview();
  return useInfiniteQuery({
    queryKey: ["breakdown-lines", "cash", preview, month, side, currency],
    enabled: active && preview === "off",
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<CashLinesPage> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("cash_month_lines", {
        p_month: `${month}-01`,
        p_side: side,
        p_currency: currency,
        p_limit: CASH_LINES_PAGE,
        p_offset: pageParam,
      });
      if (error) throw error;
      return (await loadReadSchemas()).cashLinesSchema.parse(data);
    },
    getNextPageParam: (page, pages) => (page?.has_more === true ? pages.length * CASH_LINES_PAGE : undefined),
  });
}

/** "רווח החודש" opens the profit view on its month: the shared period follows before the tap navigates. */
export function useOpenCashRow(): (row: CashRow) => void {
  const books = useOptionalBooks();
  return (row) => {
    if (row.profitMonth != null) books?.setPeriod(monthPeriod(row.profitMonth));
  };
}
