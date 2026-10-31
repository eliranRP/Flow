import type { ExpectedParty, ProjectCategoryMonths } from "@flow/shared";
import { useMemo } from "react";
import { companyGeneralForecast } from "./company-next-month";
import { useCompanyNextMonth } from "./company-next-month-query";
import { useOverheadProject } from "./overhead-project";
import { nextMonthKey, type ProjectForecastEdit } from "./project-next-month";
import { type NextMonthSample, useNextMonthForecast } from "./project-next-month-query";
import { israelToday } from "./ui/date-math";

/**
 * FLOW-1002 (owner, 2026-10-31: "the row should behave the same as a regular project"): a project's next month,
 * as its צפי page, its edit page, its profit page and its card read it. For the company's overhead project it is
 * the general costs (decision 0237): what carries no project and what the overhead project carries, with the
 * overhead project's edits, the same part the company's צפי page shows under כללי. So a general row opens the
 * overhead project's edit page, and its writes (the overhead project's edits) reach both pages.
 */
export function useProjectNextMonth(projectId: string, currency: string, sample?: NextMonthSample, enabled = true) {
  const live = sample == null && enabled;
  const overhead = useOverheadProject(live && projectId !== "");
  // Until the company's overhead project is known, neither forecast is built: the page waits on one read.
  const deciding = live && overhead.project === undefined && !overhead.failed;
  const isOverhead = live && overhead.project != null && overhead.project.id === projectId;
  const own = useNextMonthForecast(projectId, currency, sample, enabled && !deciding && !isOverhead);
  const today = israelToday();
  const company = useCompanyNextMonth(currency, today, isOverhead);
  const input = company.input;
  const general = useMemo(() => {
    if (!isOverhead || input == null) return null;
    const general = (id: string | null | undefined) => id == null || id === projectId;
    const recurring: ExpectedParty[] = input.recurring.filter((party) => general(party.project_id)).map((party) => ({ ...party, project_id: projectId }));
    const categoryMonths: ProjectCategoryMonths = {
      project_id: projectId,
      today: input.today,
      this_month: input.today.slice(0, 7),
      months: [],
      categories: input.inputs.general.map((row) => ({ ...row, group_name: null, this_month_minor: 0, months_seen: 0, expected_minor: null, typical_day: null, flag: null })),
    };
    const edits: ProjectForecastEdit[] = input.inputs.edits.filter((edit) => edit.project_id === projectId);
    return { forecast: companyGeneralForecast(input), recurring, categoryMonths, edits };
  }, [isOverhead, input, projectId]);
  if (!isOverhead) return deciding ? { ...own, pending: true } : own;
  return {
    forecast: general?.forecast ?? null,
    month: nextMonthKey(today),
    today,
    edits: general?.edits ?? [],
    recurring: general?.recurring ?? [],
    categoryMonths: general?.categoryMonths ?? null,
    categories: company.categories,
    pending: company.pending,
    failed: company.failed,
    paused: company.paused,
    refetch: () => { void company.refetch(); },
  };
}
