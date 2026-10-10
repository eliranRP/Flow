import type { CashCurrencyRow, CashLinesPage, CashMonths } from "@flow/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { cashMonthKey, cashMonthName, cashSummaryRows, cashTitle, shownCashRows, type CashListSide } from "./cash";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { monthPeriod } from "./period";
import { useHomePreview } from "./preview";
import { withPeriodSearch } from "./project-period";
import { cashAmountsText, type CashRow } from "./ui/cash-rows";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-419 (owner's option A "Like Home", decision 0176). A project opens on its cash: this
 * month's תזרים, נכנס and יצא, רווח החודש (the profit page), and the earlier months. A shared bill
 * counts the project's share. The words and rows are Home's (cash.ts); only the paths and the
 * reads are the project's.
 */

/** The project page reads this many months: the current one and three under "חודשים קודמים". */
export const PROJECT_CASH_MONTHS = 4;

/** The page the project used to open on: its profit for a period, with the period pill. */
export function projectProfitPath(projectId: string, search: string): string {
  return `/projects/${projectId}/profit${search}`;
}

/** An earlier month's page for the project: its figure, נכנס, יצא and רווח החודש. */
export function projectCashMonthPath(projectId: string, key: string, search: string): string {
  return `/projects/${projectId}/cash/${key}${search}`;
}

/** The project's lines behind one month's נכנס, יצא or לא נספר ברווח in one currency. */
export function projectCashLinesPath(projectId: string, key: string, side: CashListSide, currency: string, search: string): string {
  return `/projects/${projectId}/cash/${key}/${side}/${currency}${search}`;
}

/** Home's rows under a month's figure, opening the project's lines and the project's profit page on that month. */
export function projectCashSummaryRows(
  projectId: string,
  key: string,
  rows: CashCurrencyRow[],
  search: string,
  now = new Date(),
): CashRow[] {
  const base = rows[0]?.currency ?? "ILS";
  return cashSummaryRows(key, rows, search, now).map((row) => {
    if (row.id === "in" || row.id === "out" || row.id === "kept") return { ...row, href: projectCashLinesPath(projectId, key, row.id, base, search) };
    // The profit page reads its period from the link, so the month travels in the search, not Home's period.
    return { ...row, href: projectProfitPath(projectId, withPeriodSearch(search, monthPeriod(key))), profitMonth: undefined };
  });
}

/** The project's earlier months under "חודשים קודמים": each month's net, opening its own page. */
export function projectEarlierMonthRows(projectId: string, data: NonNullable<CashMonths>, search: string, now = new Date()): CashRow[] {
  return data.months.slice(1).map((month) => {
    const key = cashMonthKey(month.month);
    const net = shownCashRows(month, data.base_currency).map((row) => ({ currency: row.currency, minor: row.net_minor }));
    return {
      id: key,
      label: cashMonthName(key, now),
      tone: "net",
      amounts: net,
      href: projectCashMonthPath(projectId, key, search),
      name: `${cashTitle(key, now)} ${cashAmountsText(net)}`,
    };
  });
}

/** Keys start with "dashboard" and "breakdown-lines", so every write that refreshes Home's cash refreshes the project's. */
export function projectCashMonthsOptions(preview: string, projectId: string) {
  return {
    queryKey: ["dashboard", "project-cash-months", preview, projectId, PROJECT_CASH_MONTHS] as const,
    queryFn: async (): Promise<CashMonths> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("project_cash_months", { p_project: projectId, p_months: PROJECT_CASH_MONTHS });
      if (error) throw error;
      return (await loadReadSchemas()).cashMonthsSchema.parse(data);
    },
  };
}

export function useProjectCashMonthsQuery(projectId: string, active = true) {
  const preview = useHomePreview();
  return useQuery({
    ...projectCashMonthsOptions(preview, projectId),
    enabled: active && preview === "off" && projectId !== "",
    // A read from the last seconds (the prefetch on the row's touch) is not read again (FLOW-804).
    staleTime: 10_000,
  });
}

const LINES_PAGE = 40;

export function useProjectCashLinesQuery(projectId: string, month: string, side: CashListSide, currency: string, active = true) {
  const preview = useHomePreview();
  return useInfiniteQuery({
    queryKey: ["breakdown-lines", "project-cash", preview, projectId, month, side, currency],
    enabled: active && preview === "off" && projectId !== "",
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<CashLinesPage> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("project_cash_month_lines", {
        p_project: projectId,
        p_month: `${month}-01`,
        p_side: side === "kept" ? "not_in_profit" : side,
        p_currency: currency,
        p_limit: LINES_PAGE,
        p_offset: pageParam,
      });
      if (error) throw error;
      return (await loadReadSchemas()).cashLinesSchema.parse(data);
    },
    getNextPageParam: (page, pages) => (page?.has_more === true ? pages.length * LINES_PAGE : undefined),
  });
}
