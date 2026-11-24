import type { QueryClient } from "@tanstack/react-query";
import { projectForecastOptions } from "./project-forecast-query";
import { nextMonthKey } from "./project-next-month";
import { israelToday } from "./ui/date-math";

/**
 * FLOW-1270, FLOW-1315: the project page's forecast card read, started on a touch of the project's row under the key the page reads:
 * `project_forecast` for next month, in the company's currency (the page asks for another only for a project whose figures are in
 * one). It is one read for any project, the company's overhead project too, since the database builds that page as the general
 * costs. Its own module, loaded on the touch: Home's entry carries none of the forecast's code (FLOW-804).
 */
export function prefetchForecastReads(client: QueryClient, preview: string, projectId: string, staleTime: number): void {
  const today = israelToday();
  client.query({ ...projectForecastOptions(preview, projectId, nextMonthKey(today), today, null), staleTime, retry: false }).catch(() => undefined);
}
