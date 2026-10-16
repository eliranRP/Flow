import { lazy } from "react";
import { Navigate, Route, useLocation, useParams } from "react-router-dom";
import { anchorOf, monthPeriod, periodFromSearch } from "../period";
import { usePreviewSearch } from "../preview";
import { withPeriodSearch } from "../project-period";
import { israelToday } from "../ui/date-math";
import { screenLoaders } from "../screen-loaders";

const ProjectsScreen = lazy(() => screenLoaders.projects().then((m) => ({ default: m.ProjectsScreen })));
const ProjectDetailScreen = lazy(() => screenLoaders.projectDetail().then((m) => ({ default: m.ProjectDetailScreen })));
const ProjectCashMonthScreen = lazy(() => screenLoaders.projectCash().then((m) => ({ default: m.ProjectCashMonthScreen })));
const ProjectCashLinesScreen = lazy(() => screenLoaders.projectCash().then((m) => ({ default: m.ProjectCashLinesScreen })));
const ProjectCashHistoryScreen = lazy(() => screenLoaders.projectCashHistory().then((m) => ({ default: m.ProjectCashHistoryScreen })));
const ProjectCashYearScreen = lazy(() => screenLoaders.projectCashHistory().then((m) => ({ default: m.ProjectCashYearScreen })));
const ProjectCategoryScreen = lazy(() => screenLoaders.projectCategory().then((m) => ({ default: m.ProjectCategoryScreen })));
const ProfitMonthsScreen = lazy(() => screenLoaders.profitMonths().then((m) => ({ default: m.ProfitMonthsScreen })));
const ProjectProfitScreen = lazy(() => screenLoaders.projectProfit().then((m) => ({ default: m.ProjectProfitScreen })));
const ProjectGroupScreen = lazy(() => screenLoaders.projectGroup().then((m) => ({ default: m.ProjectGroupScreen })));

/**
 * A month's profit page (FLOW-140): the period comes from the month in the path. A link or an address that
 * names another period (or none) is sent to the month it names, so the path and the figures always agree.
 */
function ProjectMonthProfitRoute() {
  const { projectId = "", month = "" } = useParams();
  const location = useLocation();
  const search = usePreviewSearch();
    // A month not yet begun (or not a month at all) has no page: it goes to the project's profit page.
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > israelToday().slice(0, 7)) return <Navigate replace to={`/projects/${projectId}/profit${search}`} />;
  const current = periodFromSearch(new URLSearchParams(location.search));
  if (current?.kind !== "month" || anchorOf(current) !== month) {
    return <Navigate replace to={`/projects/${projectId}/profit/${month}${withPeriodSearch(search, monthPeriod(month))}`} />;
  }
  return <ProjectDetailScreen section="profit" />;
}

/** The projects tab: the list, a group, and a project's pages (its cash, profit, expenses, loans, transactions). */
export function ProjectRoutes() {
  return (
    <>
      <Route path="projects" element={<ProjectsScreen />} />
      {/* FLOW-406 (proj-b-2): a project group's page. */}
      <Route path="projects/groups/:groupId" element={<ProjectGroupScreen />} />
      <Route path="projects/:projectId" element={<ProjectDetailScreen />} />
      <Route path="projects/:projectId/months" element={<ProfitMonthsScreen />} />
      {/* FLOW-340 C: the screens the project page's rows open. */}
      {/* FLOW-419: the project opens on its cash; its profit page, a month and a month's lines are one tap in. */}
      <Route path="projects/:projectId/profit" element={<ProjectProfitScreen />} />
      <Route path="projects/:projectId/profit/:month" element={<ProjectMonthProfitRoute />} />
      {/* The project page's "לכל החודשים": its years, a year its months (Home's FLOW-417). */}
      <Route path="projects/:projectId/cash/history" element={<ProjectCashHistoryScreen />} />
      <Route path="projects/:projectId/cash/year/:year" element={<ProjectCashYearScreen />} />
      <Route path="projects/:projectId/cash/:month" element={<ProjectCashMonthScreen />} />
      <Route path="projects/:projectId/cash/:month/:side/:currency" element={<ProjectCashLinesScreen />} />
      <Route path="projects/:projectId/expenses" element={<ProjectDetailScreen section="expenses" />} />
      <Route path="projects/:projectId/investment" element={<ProjectDetailScreen section="investment" />} />
      <Route path="projects/:projectId/loans" element={<ProjectDetailScreen section="loans" />} />
      <Route path="projects/:projectId/transactions" element={<ProjectDetailScreen section="transactions" />} />
      <Route path="projects/:projectId/categories/:categoryId" element={<ProjectCategoryScreen />} />
    </>
  );
}
