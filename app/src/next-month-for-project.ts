import type { ExpectedParty, ProjectCategoryMonths } from "@flow/shared";
import { useMemo } from "react";
import { companyGeneralForecast } from "./company-next-month";
import { useCompanyCurrencyQuery } from "./company-currency";
import { useCompanyNextMonth } from "./company-next-month-query";
import { useOverheadProject } from "./overhead-project";
import { nextMonthKey, type ProjectForecastEdit } from "./project-next-month";
import { type NextMonthSample, useNextMonthForecast } from "./project-next-month-query";
import { shiftMonthKey } from "./period";
import { israelToday } from "./ui/date-math";

/**
 * FLOW-1002 (owner, 2026-10-31: "the row should behave the same as a regular project"): a project's next month,
 * as its צפי page, its edit page, its profit page and its card read it. For the company's overhead project it is
 * the general costs (decision 0237): what carries no project and what the overhead project carries, with the
 * overhead project's edits, the same part the company's צפי page shows under כללי. So a general row opens the
 * overhead project's edit page, and its writes (the overhead project's edits) reach both pages.
 *
 * FLOW-1229: `overheadKnown` is the page's own guess at "is this the overhead project" (get_project's `is_overhead`,
 * the same `companies.overhead_project_id` test, possibly from a cached read). It only STARTS reads early, never
 * decides what is shown: while the company read is out, a false hint starts the project's own reads and a true one
 * the company's, and the row stays in its loading state as before. What is shown is the company read's answer, or,
 * if that read failed, the FLOW-1002 fallback to the project's own forecast (whose reads then start, if the hint
 * was true). A stale hint starts the wrong set of reads; the right set starts when the answer lands. That costs
 * extra reads, never a wrong figure.
 */
export function useProjectNextMonth(projectId: string, currency: string, sample?: NextMonthSample, enabled = true, month?: string, withOverrides = false, overheadKnown?: boolean) {
  const live = sample == null && enabled;
  const overhead = useOverheadProject(live && projectId !== "");
  // Until the company's overhead project is known, neither forecast is built: the page waits on one read. If that
  // read fails, every project (the overhead one too) falls back to its own forecast, as before FLOW-1002, rather
  // than every project page failing over one small read.
  const deciding = live && overhead.project === undefined && !overhead.failed;
  const isOverhead = live && overhead.project != null && overhead.project.id === projectId;
  // The reads that may start before the answer: the hint's set only; what shows is decided above.
  const startOwn = enabled && (deciding ? overheadKnown === false : !isOverhead);
  const startCompany = isOverhead || (deciding && overheadKnown === true);
  const own = useNextMonthForecast(projectId, currency, sample, startOwn, month);
  const today = israelToday();
  // FLOW-1066: a month of the forecast (?month=), next month by default.
  const forMonth = month ?? nextMonthKey(today);
  // The general costs are the company's, in its books currency (0147), as the company's צפי page reads them,
  // whatever currency the overhead project's own figures are in. The pages show them in the currency returned.
  // A failed currency read fails the page rather than showing a USD company's general costs in shekels.
  const currencyRead = useCompanyCurrencyQuery(startCompany);
  const companyCurrency = currencyRead.data ?? currency;
  const company = useCompanyNextMonth(companyCurrency, today, startCompany && currencyRead.data != null, undefined, forMonth, false, withOverrides);
  const currencyFailed = currencyRead.data == null && currencyRead.isError;
  const input = company.input;
  const general = useMemo(() => {
    if (!isOverhead || input == null) return null;
    const general = (id: string | null | undefined) => id == null || id === projectId;
    const recurring: ExpectedParty[] = input.recurring.filter((party) => general(party.project_id)).map((party) => ({ ...party, project_id: projectId }));
    const categoryMonths: ProjectCategoryMonths = {
      project_id: projectId,
      today: input.today,
      this_month: `${input.today.slice(0, 7)}-01`,
      // The six months before this one, as company_next_month_inputs reads them: the edit page's history labels.
      months: Array.from({ length: 6 }, (_, index) => `${shiftMonthKey(input.today.slice(0, 7), index - 6)}-01`),
      categories: input.inputs.general.map((row) => ({ ...row, group_name: null, this_month_minor: 0, months_seen: 0, expected_minor: null, typical_day: null, flag: null })),
    };
    const edits: ProjectForecastEdit[] = input.inputs.edits.filter((edit) => edit.project_id === projectId);
    return { forecast: companyGeneralForecast(input), recurring, categoryMonths, edits };
  }, [isOverhead, input, projectId]);
  if (!isOverhead) return deciding ? { ...own, forecast: null, pending: true, currency, general: false } : { ...own, currency, general: false };
  return {
    currency: companyCurrency,
    /** FLOW-1079: the general costs' page (the overhead project's): a charge with no project is its own. */
    general: true,
    forecast: general?.forecast ?? null,
    month: forMonth,
    today,
    edits: general?.edits ?? [],
    recurring: general?.recurring ?? [],
    categoryMonths: general?.categoryMonths ?? null,
    categories: company.categories,
    /** FLOW-1079: the month's forecast overrides, what a skipped row's החזרה writes back. */
    overrides: company.overrides,
    pending: !currencyFailed && (currencyRead.data == null || company.pending),
    failed: currencyFailed || company.failed,
    paused: company.paused,
    refetch: () => { void currencyRead.refetch(); void company.refetch(); },
  };
}
