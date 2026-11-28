import type { CategoryRow, ExpectedMonths, ProfitMonths } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import type { CompanyNextMonthInputs } from "./company-next-month";
import { CHART_MONTHS } from "./month-figures";
import { loadReadSchemas } from "./load-read-schemas";
import { shiftMonthKey } from "./period";
import { useHomePreview } from "./preview";
import type { ForecastLoan } from "./project-next-loans";
import { readyClient } from "./ready-client";

/**
 * get_profit_months for the company's last six months (the Profit chart), and what a story, a test or the dev fixture hands the
 * page instead of the reads. FLOW-1308 moved the company's forecast to company_forecast (company-forecast-query.ts) and
 * FLOW-1315 the overhead project's page to project_forecast, so the old four-read hook is gone.
 */

/** What a story, a test or the dev fixture hands the page instead of the reads (company-forecast-sample.ts builds them). */
export type CompanyNextMonthSample = {
  recurring: ExpectedMonths["recurring"];
  loans: ForecastLoan[];
  categories: CategoryRow[];
  inputs: CompanyNextMonthInputs;
  months: NonNullable<ProfitMonths>["months"];
};

/** get_profit_months for the whole company: the six months to `today`'s, the current one to date. */
export function useCompanyProfitMonths(today: string, enabled: boolean, sample?: CompanyNextMonthSample) {
  const preview = useHomePreview();
  const live = enabled && sample == null && preview === "off";
  const from = `${shiftMonthKey(today.slice(0, 7), 1 - CHART_MONTHS)}-01`;
  const read = useQuery({
    queryKey: ["profit-months", preview, "company", from, today],
    enabled: live,
    queryFn: async (q): Promise<ProfitMonths> => {
      const supabase = await readyClient(q);
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
