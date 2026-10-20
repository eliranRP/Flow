import type { Breakdown, ProfitMonth, ProfitMonths } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { yearsRange } from "./company-years";
import type { ProjectStatus } from "./company-year-rows";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { useHomePreview } from "./preview";
import { useDashboardQuery } from "./use-books";
import { waitForAccessToken } from "./wait-for-session";

/**
 * The company profit page's year and since-the-start reads (decision 0200): one get_profit_months read of every
 * month since the start (twenty years back at most, the read's 240-month limit) serves every year and the years'
 * list, never a read per year or per month; the project list of a year reads the year's two project breakdowns,
 * only when it is shown; the projects' statuses come from the dashboard Home already holds.
 */

/** What a story, a test or the dev fixture hands the page instead of the reads. */
export type CompanyYearsSample = {
  /** get_profit_months since the start, newest first as the read returns them. */
  months: ProfitMonth[];
  /** Each year's project breakdowns, by yyyy. */
  projects: Record<string, { income: Breakdown; expense: Breakdown }>;
  statuses: ProjectStatus[];
};

async function readyClient() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  await waitForAccessToken(supabase);
  return supabase;
}

/** The company's months since the start, to today. */
export function useCompanyYears(today: string, enabled: boolean, sample?: CompanyYearsSample) {
  const preview = useHomePreview();
  const live = enabled && sample == null && preview === "off";
  const { from, to } = yearsRange(today);
  const read = useQuery({
    queryKey: ["profit-months", preview, "company", from, to],
    enabled: live,
    queryFn: async (): Promise<ProfitMonths> => {
      const supabase = await readyClient();
      const { data, error } = await supabase.rpc("get_profit_months", { p_from: from, p_to: to });
      if (error) throw error;
      return (await loadReadSchemas()).profitMonthsSchema.parse(data);
    },
  });
  return {
    months: sample?.months ?? read.data?.months ?? null,
    failed: live && read.isError,
    refetch: () => { void read.refetch(); },
  };
}

/** A year's range: January to today in this year, to December 31 in a past one. */
function yearPeriod(year: string, today: string): { from: string; to: string } {
  return { from: `${year}-01-01`, to: year === today.slice(0, 4) ? today : `${year}-12-31` };
}

async function readBreakdown(range: { from: string; to: string }, direction: "income" | "expense"): Promise<Breakdown> {
  const supabase = await readyClient();
  const { data, error } = await supabase.rpc("get_breakdown", { p_from: range.from, p_to: range.to, p_direction: direction, p_group_by: "project" });
  if (error) throw error;
  return (await loadReadSchemas()).breakdownSchema.parse(data);
}

/** A year's projects: its income and expense by project, and the statuses that fold the finished ones together. */
export function useCompanyYearProjects(year: string, today: string, enabled: boolean, sample?: CompanyYearsSample) {
  const preview = useHomePreview();
  const live = enabled && sample == null && preview === "off";
  const range = yearPeriod(year, today);
  const income = useQuery({ queryKey: ["breakdown", "company-year", preview, range.from, range.to, "project", "income"], enabled: live, queryFn: () => readBreakdown(range, "income") });
  const expense = useQuery({ queryKey: ["breakdown", "company-year", preview, range.from, range.to, "project", "expense"], enabled: live, queryFn: () => readBreakdown(range, "expense") });
  const dashboard = useDashboardQuery(live);
  if (sample != null) {
    const given = sample.projects[year];
    return { breakdowns: { income: given?.income ?? null, expense: given?.expense ?? null }, statuses: sample.statuses, pending: false, failed: false };
  }
  return {
    breakdowns: { income: income.data ?? null, expense: expense.data ?? null },
    statuses: dashboard.data?.projects ?? [],
    pending: live && (income.isPending || expense.isPending),
    failed: live && (income.isError || expense.isError),
  };
}
