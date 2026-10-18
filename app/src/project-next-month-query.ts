import type { CategoryRow, ExpectedMonths, ProjectCategoryMonths } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { monthPeriod } from "./period";
import { useHomePreview } from "./preview";
import { useProjectCategoryMonthsQuery } from "./project-category-months";
import { applyForecastEdits, nextMonthForecast, nextMonthKey, type NextMonthForecast, type ProjectForecastEdit } from "./project-next-month";
import { israelToday } from "./ui/date-math";
import { waitForAccessToken } from "./wait-for-session";

/**
 * What a story, a test or the dev fixture hands the screens instead of the reads: the two forecast reads,
 * the user's edits, and the company's categories (the edit page's category sheet).
 */
export type NextMonthSample = {
  today: string;
  expected: ExpectedMonths;
  categoryMonths: ProjectCategoryMonths | null;
  edits?: ProjectForecastEdit[];
  categories?: CategoryRow[];
};

/** The query key the edits read sits under; every forecast write refreshes it. */
export const FORECAST_EDITS_KEY = "project-forecast-edits";

const editSchema = z.object({
  id: z.string(),
  kind: z.enum(["change", "remove", "add"]),
  row_key: z.string().nullable(),
  category_id: z.string().nullable(),
  category_name: z.string().nullable().optional(),
  direction: z.enum(["income", "expense"]).nullable(),
  amount_minor: z.number().nullable(),
  pace: z.enum(["once", "month", "2months", "quarter", "year"]),
  start_month: z.string(),
});

/** expected_months for one project: this month and the next (decision 0185: a charge's project is its own). */
function useProjectExpectedQuery(projectId: string) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["expected-months", preview, "project", projectId, 2],
    enabled: preview === "off" && projectId !== "",
    queryFn: async (): Promise<ExpectedMonths> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("expected_months", { p_months: 2, p_project_id: projectId });
      if (error) throw error;
      return (await loadReadSchemas()).expectedMonthsSchema.parse(data);
    },
  });
}

/** project_forecast_edits_for: the user's edits that apply to the month. */
function useForecastEditsQuery(projectId: string, month: string) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: [FORECAST_EDITS_KEY, preview, projectId, month],
    enabled: preview === "off" && projectId !== "",
    queryFn: async (): Promise<ProjectForecastEdit[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("project_forecast_edits_for", { p_project_id: projectId, p_month: month });
      if (error) throw error;
      return editSchema.array().parse(data ?? []);
    },
  });
}

/**
 * The project's forecast for next month in one currency, from its recurring charges and the last six complete
 * months by category (the month view's own read), with the user's edits on top. Null until the reads are in;
 * `pending` and `failed` let a page show its skeleton or its error. `enabled` false (a sample screen with no
 * forecast) reads nothing. The edit page also takes the reads themselves (`recurring`, `categoryMonths`).
 */
export function useNextMonthForecast(projectId: string, currency: string, sample?: NextMonthSample, enabled = true) {
  const today = sample?.today ?? israelToday();
  const month = nextMonthKey(today);
  const live = sample == null && enabled ? projectId : "";
  const expected = useProjectExpectedQuery(live);
  const categories = useProjectCategoryMonthsQuery(live, monthPeriod(today.slice(0, 7)));
  const editsRead = useForecastEditsQuery(live, month);
  const recurring = sample?.expected.recurring ?? expected.data?.recurring;
  const categoryMonths = sample == null ? categories.data : sample.categoryMonths;
  const edits = sample == null ? editsRead.data : sample.edits ?? [];
  const ready = sample != null || (expected.data != null && categories.data !== undefined && editsRead.data != null);
  const base: NextMonthForecast | null = ready && recurring != null
    ? nextMonthForecast({ projectId, currency, today, recurring, categoryMonths })
    : null;
  const reads = [expected, categories, editsRead];
  return {
    forecast: base == null ? null : applyForecastEdits(base, edits ?? []),
    month,
    edits: edits ?? [],
    recurring: recurring ?? [],
    categoryMonths: categoryMonths ?? null,
    pending: sample == null && reads.some((read) => read.isPending),
    failed: sample == null && reads.some((read) => read.isError),
    paused: sample == null && reads.some((read) => read.isPaused),
    refetch: () => {
      for (const read of reads) void read.refetch();
    },
  };
}
