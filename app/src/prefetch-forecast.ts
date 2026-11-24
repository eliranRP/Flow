import type { QueryClient } from "@tanstack/react-query";
import { overridesQuery } from "./forecast-overrides-query";
import { overheadProjectOptions } from "./overhead-project";
import { monthPeriod } from "./period";
import { markDay, projectCategoryMonthsOptions } from "./project-category-months";
import { nextMonthKey } from "./project-next-month";
import { forecastEditsOptions, projectExpectedOptions } from "./project-next-month-query";
import { israelToday } from "./ui/date-math";

/**
 * FLOW-1270: the project page's forecast card reads, started on a touch of the project's row under the keys the
 * page reads: the company's overhead project, expected_months, project_category_months, the project's edits and the
 * month's overrides. list_categories is the company's, which Home holds. Its own module, loaded on the touch:
 * Home's entry carries none of the forecast's code (FLOW-804).
 */
export function prefetchForecastReads(client: QueryClient, preview: string, projectId: string, staleTime: number): void {
  const today = israelToday();
  const day = markDay(monthPeriod(today.slice(0, 7)));
  const month = nextMonthKey(today);
  const quiet = { staleTime, retry: false };
  // FLOW-1297: the page builds the overhead project from the company's general costs, not from the project's own reads
  // (next-month-for-project.ts), so a touch of the overhead project's row starts the three project reads below not at all.
  // The check is the page's: the overhead answer names this project. A failed or empty answer starts them, as the page does.
  const ownReads = () => {
    client.query({ ...projectExpectedOptions(preview, projectId), ...quiet }).catch(() => undefined);
    client.query({ ...projectCategoryMonthsOptions(preview, projectId, day), ...quiet }).catch(() => undefined);
    client.query({ ...forecastEditsOptions(preview, projectId, month), ...quiet }).catch(() => undefined);
  };
  void client.query({ ...overheadProjectOptions(preview), ...quiet }).then(
    (overhead) => { if (overhead?.id !== projectId) ownReads(); },
    () => { ownReads(); },
  );
  client.query({ ...overridesQuery(month, preview, true), ...quiet }).catch(() => undefined);
}
