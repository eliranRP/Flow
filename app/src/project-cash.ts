import type { CashCurrencyRow, CashLine, CashMonths, ProjectsCashMonth } from "@flow/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cashSummaryRows } from "./cash";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { CHART_MONTHS } from "./month-figures";
import { monthPeriod } from "./period";
import { useHomePreview } from "./preview";
import { israelToday } from "./ui/date-math";
import { withPeriodSearch } from "./project-period";
import type { CashRow } from "./ui/cash-rows";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-419 (owner's option A "Like Home", decision 0176). A project opens on its cash: this
 * month's תזרים, נכנס and יצא, רווח החודש (the profit page), and the month chart. A shared bill
 * counts the project's share. The words and rows are Home's (cash.ts); only the paths and the
 * reads are the project's.
 */

/** The project page reads this many months: the current one and the five before it, for its month chart. */
export const PROJECT_CASH_MONTHS = CHART_MONTHS;

/** A month's profit page (FLOW-140): the project's profit page for one month, named in the path. */
export function projectProfitMonthPath(projectId: string, key: string, search: string): string {
  return `/projects/${projectId}/profit/${key}${search}`;
}

/** Search for one project in the month the search carries (the lines profit leaves out are found there). */
function projectKeptSearchPath(projectId: string, monthSearch: string): string {
  const params = new URLSearchParams(monthSearch);
  params.set("project", projectId);
  return `/search?${params.toString()}`;
}

/** Home's rows under a month's figure, opening the project's month page (the kept row opens search). */
export function projectCashSummaryRows(
  projectId: string,
  key: string,
  rows: CashCurrencyRow[],
  search: string,
  now = new Date(),
): CashRow[] {
  // The month page reads its period from the link, so the month travels in the search, not Home's period.
  const monthSearch = withPeriodSearch(search, monthPeriod(key));
  return cashSummaryRows(key, rows, search, now).map((row) => {
    // The month page lists counted lines only: what profit leaves out is found in search, for this project and month.
    if (row.id === "kept") return { ...row, href: projectKeptSearchPath(projectId, monthSearch) };
    return { ...row, href: projectProfitMonthPath(projectId, key, monthSearch) };
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

/** FLOW-438: a month's lines on its page, the counted and the kept-out, up to the read's 200 each. */
export type ProjectCashMonthLines = { counted: CashLine[]; kept: CashLine[]; more: boolean };

/** FLOW-438: the project's lines for one month, as its cash month page lists them under the figures. */
export function useProjectCashMonthLinesQuery(projectId: string, month: string, currency: string, active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["breakdown-lines", "project-cash-month", preview, projectId, month, currency],
    enabled: active && preview === "off" && projectId !== "" && currency !== "",
    queryFn: async (): Promise<ProjectCashMonthLines> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const schemas = await loadReadSchemas();
      const read = async (side: "in_profit" | "not_in_profit") => {
        const { data, error } = await supabase.rpc("project_cash_month_lines", {
          p_project: projectId,
          p_month: `${month}-01`,
          p_side: side,
          p_currency: currency,
          p_limit: 200,
          p_offset: 0,
        });
        if (error) throw error;
        return schemas.cashLinesSchema.parse(data);
      };
      const [counted, kept] = await Promise.all([read("in_profit"), read("not_in_profit")]);
      return { counted: counted?.rows ?? [], kept: kept?.rows ?? [], more: counted?.has_more === true || kept?.has_more === true };
    },
  });
}

/**
 * FLOW-445: one month's cash for every project and the unassigned bucket (projects_cash_month). The
 * list reads it with no project; the project page reads its own row. `month` is `YYYY-MM`, or the
 * current month when omitted.
 */
export function useProjectsCashMonth(month?: string, projectId?: string, enabled = true) {
  const preview = useHomePreview();
  const client = useQueryClient();
  const listKey = ["projects-cash", month, undefined] as const;
  return useQuery({
    queryKey: ["projects-cash", month, projectId],
    enabled: enabled && preview === "off",
    // A project's row starts from the list's read of the same month, as old as that read: it reads
    // again once the list's copy would have, and at once when a write marked the list stale.
    initialData: () => projectRowFromList(client.getQueryData<ProjectsCashMonth>(listKey), projectId),
    initialDataUpdatedAt: () => {
      const list = client.getQueryState(listKey);
      return list?.isInvalidated === true ? 0 : list?.dataUpdatedAt;
    },
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("projects_cash_month", {
        p_month: month == null ? undefined : `${month}-01`,
        p_today: israelToday(),
        p_project: projectId,
      });
      if (error) throw error;
      return (await loadReadSchemas()).projectsCashMonthSchema.parse(data);
    },
  });
}

/** The list's answer cut to one project's row, or nothing when the list has no read or no such row. */
function projectRowFromList(list: ProjectsCashMonth | undefined, projectId: string | undefined): ProjectsCashMonth | undefined {
  if (list == null || projectId == null || projectId === "") return undefined;
  const row = list.projects.find((project) => project.id === projectId);
  return row == null ? undefined : { ...list, projects: [row] };
}

/** The company's overhead project as the owner set and named it (set_overhead_project). */
export type OverheadProject = { id: string; name: string };

/**
 * The overhead project from the Projects list's read (its `is_overhead` row follows `companies.overhead_project_id`,
 * the same cache as the Projects tab): undefined while it loads, null when none is set or the read failed. Preview
 * and `enabled` false read nothing and give null.
 */
export function useOverheadProject(enabled: boolean): OverheadProject | null | undefined {
  const preview = useHomePreview();
  const live = enabled && preview === "off";
  const read = useProjectsCashMonth(undefined, undefined, live);
  if (!live || read.isError) return null;
  if (read.data === undefined) return undefined;
  const row = read.data?.projects.find((project) => project.is_overhead);
  return row == null ? null : { id: row.id, name: row.name };
}
