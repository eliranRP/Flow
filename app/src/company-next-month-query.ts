import type { CategoryRow, ExpectedMonths, ProfitMonths } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import { companyNextMonthForecast, type CompanyNextMonth, type CompanyNextMonthInputs } from "./company-next-month";
import { companyRestOfYear, type RestOfYear } from "./company-year-forecast";
import { CHART_MONTHS } from "./month-figures";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { shiftMonthKey } from "./period";
import { useHomePreview } from "./preview";
import type { ForecastLoan } from "./project-next-loans";
import { editSchema, FORECAST_EDITS_KEY, readForecastLoans } from "./project-next-month-query";
import { useCategoriesQuery } from "./use-books";
import { waitForAccessToken } from "./wait-for-session";

/**
 * The company profit page's next month and chart (canvas note spec-fcwide, item 2): four reads for the whole
 * company at once, never one per project. expected_months for every charge, the company's loans with their
 * balances, company_next_month_inputs (every project's category months, the general costs' and the edits for
 * next month) and the categories; then get_profit_months for the company's last six months.
 */

/** What a story, a test or the dev fixture hands the page instead of the reads. */
export type CompanyNextMonthSample = {
  recurring: ExpectedMonths["recurring"];
  loans: ForecastLoan[];
  categories: CategoryRow[];
  inputs: CompanyNextMonthInputs;
  months: NonNullable<ProfitMonths>["months"];
};

const monthsRowSchema = z.object({
  id: z.string().nullable(),
  name: z.string().nullable(),
  currency: z.string(),
  months_minor: z.array(z.number().int()),
});

const inputsSchema = z.object({
  month: z.string(),
  overhead_project_id: z.string().nullable(),
  projects: z.array(z.object({ project_id: z.string(), categories: z.array(monthsRowSchema) })),
  general: z.array(monthsRowSchema),
  edits: z.array(editSchema.extend({ project_id: z.string() })),
});

async function readyClient() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  await waitForAccessToken(supabase);
  return supabase;
}

const NO_LOANS: readonly ForecastLoan[] = [];

/**
 * The company's forecast for next month in its currency: every project's (as its צפי page builds it, the edits
 * on top) and the general costs', summed; and the same for each month left in the year (`rest`, null in
 * December). Null until the reads are in; `enabled` false reads nothing.
 */
export function useCompanyNextMonth(currency: string, today: string, enabled: boolean, sample?: CompanyNextMonthSample) {
  const preview = useHomePreview();
  const live = enabled && sample == null && preview === "off";
  const expected = useQuery({
    queryKey: ["expected-months", preview, "company", 2],
    enabled: live,
    queryFn: async (): Promise<ExpectedMonths> => {
      const supabase = await readyClient();
      const { data, error } = await supabase.rpc("expected_months", { p_months: 2 });
      if (error) throw error;
      return (await loadReadSchemas()).expectedMonthsSchema.parse(data);
    },
  });
  const loans = useQuery({ queryKey: ["loans", "company-forecast", preview], enabled: live, queryFn: () => readForecastLoans(null) });
  const inputs = useQuery({
    queryKey: [FORECAST_EDITS_KEY, preview, "company", today],
    enabled: live,
    queryFn: async (): Promise<CompanyNextMonthInputs> => {
      const supabase = await readyClient();
      const { data, error } = await supabase.rpc("company_next_month_inputs", { p_today: today });
      if (error) throw error;
      return inputsSchema.parse(data);
    },
  });
  const categories = useCategoriesQuery(live);
  const recurring = sample?.recurring ?? expected.data?.recurring;
  const loanList = sample?.loans ?? loans.data ?? (sample == null ? undefined : NO_LOANS);
  const categoryList = sample?.categories ?? categories.data;
  const inputData = sample?.inputs ?? inputs.data;
  const forecast: CompanyNextMonth | null = useMemo(
    () => (recurring != null && loanList != null && categoryList != null && inputData != null
      ? companyNextMonthForecast({ currency, today, recurring, loans: loanList, categories: categoryList, inputs: inputData })
      : null),
    [recurring, loanList, categoryList, inputData, currency, today],
  );
  // The year view's rest of the year (decision 0200): the same reads, built again for each month left.
  const rest: RestOfYear | null = useMemo(
    () => (recurring != null && loanList != null && categoryList != null && inputData != null
      ? companyRestOfYear({ currency, today, recurring, loans: loanList, categories: categoryList, inputs: inputData })
      : null),
    [recurring, loanList, categoryList, inputData, currency, today],
  );
  const reads = [expected, loans, inputs, categories];
  return {
    forecast,
    rest,
    categories: categoryList ?? [],
    pending: live && reads.some((read) => read.isPending) && !reads.some((read) => read.isPaused),
    failed: live && reads.some((read) => read.isError),
  };
}

/** get_profit_months for the whole company: the six months to `today`'s, the current one to date. */
export function useCompanyProfitMonths(today: string, enabled: boolean, sample?: CompanyNextMonthSample) {
  const preview = useHomePreview();
  const live = enabled && sample == null && preview === "off";
  const from = `${shiftMonthKey(today.slice(0, 7), 1 - CHART_MONTHS)}-01`;
  const read = useQuery({
    queryKey: ["profit-months", preview, "company", from, today],
    enabled: live,
    queryFn: async (): Promise<ProfitMonths> => {
      const supabase = await readyClient();
      const { data, error } = await supabase.rpc("get_profit_months", { p_from: from, p_to: today });
      if (error) throw error;
      return (await loadReadSchemas()).profitMonthsSchema.parse(data);
    },
  });
  return {
    months: sample?.months ?? read.data?.months ?? null,
    failed: live && read.isError,
  };
}
