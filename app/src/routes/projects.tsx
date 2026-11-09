import { lazy } from "react";
import { Navigate, Route, useLocation, useParams } from "react-router-dom";
import { anchorOf, monthPeriod, periodFromSearch } from "../period";
import { usePreviewSearch } from "../preview";
import { withPeriodSearch } from "../project-period";
import { israelToday } from "../ui/date-math";
import { screenLoaders } from "../screen-loaders";

const ProjectsScreen = lazy(() => screenLoaders.projects().then((m) => ({ default: m.ProjectsScreen })));
const ProjectDetailScreen = lazy(() => screenLoaders.projectDetail().then((m) => ({ default: m.ProjectDetailScreen })));
const ProjectCategoryScreen = lazy(() => screenLoaders.projectCategory().then((m) => ({ default: m.ProjectCategoryScreen })));
const ProjectUnassignedScreen = lazy(() => screenLoaders.projectUnassigned().then((m) => ({ default: m.ProjectUnassignedScreen })));
const ProjectProfitScreen = lazy(() => screenLoaders.projectProfit().then((m) => ({ default: m.ProjectProfitScreen })));
const ProjectMonthProfitScreen = lazy(() => screenLoaders.projectMonthProfit().then((m) => ({ default: m.ProjectMonthProfitScreen })));
const ProjectNextMonthScreen = lazy(() => screenLoaders.projectNextMonth().then((m) => ({ default: m.ProjectNextMonthScreen })));
const ProjectNextEditScreen = lazy(() => screenLoaders.projectNextEdit().then((m) => ({ default: m.ProjectNextEditScreen })));
const ProjectUtilitiesScreen = lazy(() => screenLoaders.projectUtilities().then((m) => ({ default: m.ProjectUtilitiesScreen })));
const ProjectInvestmentScreen = lazy(() => screenLoaders.projectInvestment().then((m) => ({ default: m.ProjectInvestmentScreen })));
const PropertyStatementScreen = lazy(() => screenLoaders.propertyReturns().then((m) => ({ default: m.PropertyStatementScreen })));
const PropertyReturnLineScreen = lazy(() => screenLoaders.propertyReturns().then((m) => ({ default: m.PropertyReturnLineScreen })));
const PropertyMetricScreen = lazy(() => screenLoaders.propertyReturnsDetail().then((m) => ({ default: m.PropertyMetricScreen })));
const PropertyPartScreen = lazy(() => screenLoaders.propertyReturnsDetail().then((m) => ({ default: m.PropertyPartScreen })));

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
  return <ProjectMonthProfitScreen />;
}

/** The projects tab: the list and a project's pages (its cash, profit, investment, a category). */
export function ProjectRoutes() {
  return (
    <>
      <Route path="projects" element={<ProjectsScreen />} />
      {/* FLOW-1044: the lines with no project, before the project page so it is not read as an id. */}
      <Route path="projects/unassigned" element={<ProjectUnassignedScreen />} />
      <Route path="projects/:projectId" element={<ProjectDetailScreen />} />
      {/* FLOW-340 C: the screens the project page's rows open. */}
      {/* FLOW-419: the project opens on its cash; its profit page, a month and a month's lines are one tap in. */}
      <Route path="projects/:projectId/profit" element={<ProjectProfitScreen />} />
      {/* The ProfitNext frame: next month's forecast, from the dashed card on the profit page. */}
      <Route path="projects/:projectId/profit/next" element={<ProjectNextMonthScreen />} />
      {/* ProfitNextEdit and ProfitNextAdd: a forecast row's edit page (its key in the last segment) and a new line. */}
      <Route path="projects/:projectId/profit/next/edit/:rowKey" element={<ProjectNextEditScreen />} />
      <Route path="projects/:projectId/profit/next/add" element={<ProjectNextEditScreen add />} />
      <Route path="projects/:projectId/profit/:month" element={<ProjectMonthProfitRoute />} />
      <Route path="projects/:projectId/investment" element={<ProjectInvestmentScreen />} />
      {/* FLOW-1135: the property's utilities, who pays each (tenant or company). */}
      <Route path="projects/:projectId/utilities" element={<ProjectUtilitiesScreen />} />
      {/* FLOW-451: what the investment page's figures are made of: the statement, a line, a metric, a part. */}
      {/* Two paths, not four: Cloudflare Pages takes at most 100 dynamic _redirects rules. */}
      <Route path="projects/:projectId/investment/:section" element={<PropertyReturnsSection />} />
      <Route path="projects/:projectId/investment/:section/:key" element={<PropertyReturnsItem />} />
      <Route path="projects/:projectId/categories/:categoryId" element={<ProjectCategoryScreen />} />
    </>
  );
}

/** /investment/returns is the statement; any other section goes back to the investment page. */
function PropertyReturnsSection() {
  const { section } = useParams();
  return section === "returns" ? <PropertyStatementScreen /> : <Navigate to=".." relative="path" replace />;
}

/** /investment/returns/<line>, /investment/metric/<metric> and /investment/part/<part>. */
function PropertyReturnsItem() {
  const { section } = useParams();
  if (section === "returns") return <PropertyReturnLineScreen />;
  if (section === "metric") return <PropertyMetricScreen />;
  if (section === "part") return <PropertyPartScreen />;
  return <Navigate to="../.." relative="path" replace />;
}
