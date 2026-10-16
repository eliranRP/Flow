import { lazy } from "react";
import { Route } from "react-router-dom";
import { screenLoaders } from "../screen-loaders";

const ProjectsScreen = lazy(() => screenLoaders.projects().then((m) => ({ default: m.ProjectsScreen })));
const ProjectDetailScreen = lazy(() => screenLoaders.projectDetail().then((m) => ({ default: m.ProjectDetailScreen })));
const ProjectCashMonthScreen = lazy(() => screenLoaders.projectCash().then((m) => ({ default: m.ProjectCashMonthScreen })));
const ProjectCashLinesScreen = lazy(() => screenLoaders.projectCash().then((m) => ({ default: m.ProjectCashLinesScreen })));
const ProjectCashHistoryScreen = lazy(() => screenLoaders.projectCashHistory().then((m) => ({ default: m.ProjectCashHistoryScreen })));
const ProjectCashYearScreen = lazy(() => screenLoaders.projectCashHistory().then((m) => ({ default: m.ProjectCashYearScreen })));
const ProjectCategoryScreen = lazy(() => screenLoaders.projectCategory().then((m) => ({ default: m.ProjectCategoryScreen })));
const ProfitMonthsScreen = lazy(() => screenLoaders.profitMonths().then((m) => ({ default: m.ProfitMonthsScreen })));
const ProjectGroupScreen = lazy(() => screenLoaders.projectGroup().then((m) => ({ default: m.ProjectGroupScreen })));

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
      <Route path="projects/:projectId/profit" element={<ProjectDetailScreen section="profit" />} />
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
