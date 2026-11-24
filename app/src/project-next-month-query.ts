import type { CategoryRow, ExpectedMonths, ProjectCategoryMonths } from "@flow/shared";
import type { ForecastLoan } from "./project-next-loans";
import type { ProjectForecastEdit } from "./project-next-month";

/**
 * What a story, a test or the dev fixture hands the screens instead of the read: the two forecast reads,
 * the user's edits, the project's loans, and the company's categories (the loan rows' categories and the
 * edit page's category sheet). The screens build the forecast from them with the TypeScript builders
 * (next-month-for-project.ts); a live page reads project_forecast instead (FLOW-1315, project-forecast-query.ts).
 */
export type NextMonthSample = {
  today: string;
  expected: ExpectedMonths;
  categoryMonths: ProjectCategoryMonths | null;
  edits?: ProjectForecastEdit[];
  loans?: ForecastLoan[];
  categories?: CategoryRow[];
};
