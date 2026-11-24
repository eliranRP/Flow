import type { CategoryRow, ExpectedMonths, ProfitMonths } from "@flow/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import type { CompanyForecastInput, CompanyNextMonthInputs } from "./company-next-month";
import { companyMonthInput } from "./company-year-forecast";
import { CHART_MONTHS } from "./month-figures";
import { expectedMonthsQueryOptions } from "./expected-months-query";
import { loadReadSchemas } from "./load-read-schemas";
import { shiftMonthKey } from "./period";
import { useHomePreview } from "./preview";
import type { ForecastLoan } from "./project-next-loans";
import { nextMonthKey } from "./project-next-month";
import { editSchema, FORECAST_EDITS_KEY, readForecastLoans } from "./project-next-month-query";
import { skippedKeys, useForecastOverrides } from "./forecast-skip";
import { useCategoriesQuery } from "./use-books";
import { readyClient } from "./ready-client";

/**
 * The company's forecast the old way (canvas note spec-fcwide, item 2): four reads for the whole company at once, never one
 * per project. expected_months for every charge, the company's loans with their balances, company_next_month_inputs (every
 * project's category months, the general costs' and the edits for a month) and the categories, built here by the TypeScript
 * builders. FLOW-1308: Profit, Home's months to come and the company's pages read company_forecast instead
 * (company-forecast-query.ts); this read stays for the overhead project's page (useProjectNextMonth), which FLOW-1315 moves.
 * The same file holds get_profit_months for the company's last six months (the Profit chart).
 */

/** What a story, a test or the dev fixture hands the page instead of the reads (company-forecast-sample.ts builds them). */
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
  rest_edits: z.array(editSchema.omit({ matched_transaction_id: true }).extend({ project_id: z.string(), matches: z.record(z.string(), z.string()).optional() })).optional(),
  /** FLOW-1195, FLOW-1202: the keys taken out of each month: next month only in the slim answer, next month to the horizon with rest_edits; a month with none has no key. */
  skips: z.record(z.string(), z.array(z.string())).optional(),
});

/**
 * The company's forecast for next month in its currency: every project's (as its צפי page builds it, the edits
 * on top) and the general costs', summed. Null until the reads are in; `enabled` false reads nothing. FLOW-1066: with
 * `month` (a month of the forecast, inForecastHorizon), `forecast` and `input` are that month's, from the same reads.
 * A month after next month needs every later month's edits too (the full answer, p_rest).
 * FLOW-1202: every month's skips come with the answer (`skips`: next month's in the slim one), so no
 * forecast_overrides_for is sent to count them. `withOverrides` (a month's page that can skip a row) also reads
 * that month's override rows: a skip's undo puts back the row as it was (its amount and day), which the keys alone
 * do not hold.
 */
export function useCompanyNextMonth(currency: string, today: string, enabled: boolean, month?: string, withOverrides = false) {
  const preview = useHomePreview();
  const live = enabled && preview === "off";
  // FLOW-1171: the same read as Home's forecast (expected-months-query), so one request serves both.
  const expected = useQuery({ ...expectedMonthsQueryOptions(preview), enabled: live });
  const loans = useQuery({ queryKey: ["loans", "company-forecast", preview], enabled: live, queryFn: () => readForecastLoans() });
  // A later month is built from rest_edits; the slim answer (no rest_edits) holds next month's edits only.
  const full = month != null && month !== nextMonthKey(today);
  const client = useQueryClient();
  // FLOW-1191: the full answer (p_rest) holds everything the slim one does, plus rest_edits (and, FLOW-1202, its
  // skips cover next month too). With the full one cached for the same day, the slim read starts from it, as fresh
  // as it is: no request while it is fresh.
  const seed = full ? undefined : client.getQueryState<CompanyNextMonthInputs>([FORECAST_EDITS_KEY, preview, "company", today, true]);
  const inputs = useQuery({
    queryKey: [FORECAST_EDITS_KEY, preview, "company", today, full],
    enabled: live,
    initialData: seed?.data,
    initialDataUpdatedAt: seed?.dataUpdatedAt,
    queryFn: async (): Promise<CompanyNextMonthInputs> => {
      const supabase = await readyClient();
      const { data, error } = await supabase.rpc("company_next_month_inputs", { p_today: today, p_rest: full });
      if (error) throw error;
      return inputsSchema.parse(data);
    },
  });
  const categories = useCategoriesQuery(live);
  // FLOW-1079: a month of the forecast counts what was taken out of it for that month only. FLOW-1096, FLOW-1195,
  // FLOW-1202: from the answer's `skips`, which has next month (the slim answer) or every month to the horizon (the
  // full one): the card's count is right from the first answer, and no forecast_overrides_for goes out for it.
  // The override rows are read only where a row can be skipped and put back (`withOverrides`).
  const overrides = useForecastOverrides(month ?? "", live && month != null && withOverrides);
  const skipList = overrides.data;
  const inputData = inputs.data;
  const answeredSkips = inputData?.skips;
  const skips = useMemo(() => {
    const forMonth = month ?? nextMonthKey(today);
    if (answeredSkips != null) return answeredSkips[forMonth] ?? [];
    return skipList == null ? undefined : [...skippedKeys(skipList)];
  }, [month, today, answeredSkips, skipList]);
  const recurring = expected.data?.recurring;
  const loanList = loans.data;
  const categoryList = categories.data;
  // FLOW-1002: what the forecast is built from, so the overhead project's page can build the general costs alone.
  // FLOW-1066: built for `month` (a month of the forecast; next month by default), its own edits in place of next month's.
  const forMonth = month ?? nextMonthKey(today);
  const input: CompanyForecastInput | null = useMemo(
    () => (recurring != null && loanList != null && categoryList != null && inputData != null
      ? { ...companyMonthInput({ currency, today, recurring, loans: loanList, categories: categoryList, inputs: inputData }, forMonth), skips }
      : null),
    [recurring, loanList, categoryList, inputData, currency, today, forMonth, skips],
  );
  const reads = month == null || !withOverrides ? [expected, loans, inputs, categories] : [expected, loans, inputs, categories, overrides];
  return {
    input,
    /** FLOW-1079: `month`'s overrides (null without a month, or while read), for the skip's undo. */
    overrides: skipList ?? null,
    categories: categoryList ?? [],
    pending: live && reads.some((read) => read.isPending) && !reads.some((read) => read.isPaused),
    failed: live && reads.some((read) => read.isError),
    /** FLOW-1000: a read waits for the network (offline). */
    paused: live && reads.some((read) => read.isPaused),
    /** FLOW-1000: reads every one of them again (a page's נסו שוב). */
    refetch: () => Promise.all(reads.map((read) => read.refetch())),
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
    /** FLOW-1139: the months are being read: the chart's skeleton holds its place. */
    loading: live && read.isPending,
    failed: live && read.isError,
  };
}
