import type { CategoryRow, ExpectedMonths, ProjectCategoryMonths } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { monthPeriod } from "./period";
import { useHomePreview } from "./preview";
import { useProjectCategoryMonthsQuery } from "./project-category-months";
import type { ForecastLoan } from "./project-next-loans";
import { applyForecastEdits, nextMonthForecast, nextMonthKey, type NextMonthForecast, type ProjectForecastEdit } from "./project-next-month";
import { LOAN_DETAIL_COLUMNS, type LoanDetailDbRow, readLoanRow } from "./screens/loan-detail-data";
import { israelToday } from "./ui/date-math";
import { useCategoriesQuery } from "./use-books";
import { waitForAccessToken } from "./wait-for-session";

/**
 * What a story, a test or the dev fixture hands the screens instead of the reads: the two forecast reads,
 * the user's edits, the project's loans, and the company's categories (the loan rows' categories and the
 * edit page's category sheet).
 */
export type NextMonthSample = {
  today: string;
  expected: ExpectedMonths;
  categoryMonths: ProjectCategoryMonths | null;
  edits?: ProjectForecastEdit[];
  loans?: ForecastLoan[];
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
  matched_transaction_id: z.string().nullable().optional(),
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

/**
 * The loans filed under the project, as the loan page reads a loan (its row with the rates). Under "loans",
 * so a loan write refreshes it. A forecast needs only the terms, so no balance is read.
 */
function useProjectLoansQuery(projectId: string) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["loans", "project", preview, projectId],
    enabled: preview === "off" && projectId !== "",
    queryFn: async (): Promise<ForecastLoan[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.from("loans").select(LOAN_DETAIL_COLUMNS).eq("project_id", projectId);
      if (error) throw error;
      return (data as unknown as LoanDetailDbRow[]).map((row) => readLoanRow(row, null));
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
 * The project's forecast for next month in one currency, from its recurring charges, its loans' schedules and
 * the last six complete months by category (the month view's own read), with the user's edits on top. Null
 * until the reads are in; `pending` and `failed` let a page show its skeleton or its error. `enabled` false
 * (a sample screen with no forecast) reads nothing. The edit page also takes the reads themselves
 * (`recurring`, `categoryMonths`, `categories`).
 */
export function useNextMonthForecast(projectId: string, currency: string, sample?: NextMonthSample, enabled = true) {
  const today = sample?.today ?? israelToday();
  const month = nextMonthKey(today);
  const live = sample == null && enabled ? projectId : "";
  const expected = useProjectExpectedQuery(live);
  const categories = useProjectCategoryMonthsQuery(live, monthPeriod(today.slice(0, 7)));
  const editsRead = useForecastEditsQuery(live, month);
  const loansRead = useProjectLoansQuery(live);
  const companyCategories = useCategoriesQuery(live !== "");
  const recurring = sample?.expected.recurring ?? expected.data?.recurring;
  const categoryMonths = sample == null ? categories.data : sample.categoryMonths;
  const edits = sample == null ? editsRead.data : sample.edits ?? [];
  const loans = sample == null ? loansRead.data : sample.loans ?? [];
  const categoryList = sample == null ? companyCategories.data : sample.categories ?? [];
  const ready = sample != null
    || (expected.data != null && categories.data !== undefined && editsRead.data != null && loansRead.data != null && companyCategories.data != null);
  const base: NextMonthForecast | null = ready && recurring != null
    ? nextMonthForecast({ projectId, currency, today, recurring, categoryMonths, loans, categories: categoryList })
    : null;
  const reads = [expected, categories, editsRead, loansRead, companyCategories];
  return {
    forecast: base == null ? null : applyForecastEdits(base, edits ?? []),
    month,
    edits: edits ?? [],
    recurring: recurring ?? [],
    categoryMonths: categoryMonths ?? null,
    categories: categoryList ?? [],
    pending: sample == null && reads.some((read) => read.isPending),
    failed: sample == null && reads.some((read) => read.isError),
    paused: sample == null && reads.some((read) => read.isPaused),
    refetch: () => {
      for (const read of reads) void read.refetch();
    },
  };
}
