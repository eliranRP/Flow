import type { ExpectedMonths, ProjectCategoryMonths } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { monthPeriod } from "./period";
import { useHomePreview } from "./preview";
import { useProjectCategoryMonthsQuery } from "./project-category-months";
import { nextMonthForecast, type NextMonthForecast } from "./project-next-month";
import { israelToday } from "./ui/date-math";
import { waitForAccessToken } from "./wait-for-session";

/** What a story, a test or the dev fixture hands the screens instead of the two reads. */
export type NextMonthSample = { today: string; expected: ExpectedMonths; categoryMonths: ProjectCategoryMonths | null };

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

/**
 * The project's forecast for next month in one currency, from its recurring charges and the last six complete
 * months by category (the month view's own read). Null until both reads are in; `pending` and `failed` let a
 * page show its skeleton or its error. `enabled` false (a sample screen with no forecast) reads nothing.
 */
export function useNextMonthForecast(projectId: string, currency: string, sample?: NextMonthSample, enabled = true) {
  const today = sample?.today ?? israelToday();
  const live = sample == null && enabled ? projectId : "";
  const expected = useProjectExpectedQuery(live);
  const categories = useProjectCategoryMonthsQuery(live, monthPeriod(today.slice(0, 7)));
  const recurring = sample?.expected.recurring ?? expected.data?.recurring;
  const categoryMonths = sample == null ? categories.data : sample.categoryMonths;
  const ready = sample != null || (expected.data != null && categories.data !== undefined);
  const forecast: NextMonthForecast | null = ready && recurring != null
    ? nextMonthForecast({ projectId, currency, today, recurring, categoryMonths })
    : null;
  return {
    forecast,
    pending: sample == null && (expected.isPending || categories.isPending),
    failed: sample == null && (expected.isError || categories.isError),
    paused: sample == null && (expected.isPaused || categories.isPaused),
    refetch: () => {
      void expected.refetch();
      void categories.refetch();
    },
  };
}
