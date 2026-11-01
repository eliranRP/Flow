import type { ForecastBuild, ForecastItem } from "@flow/shared";

/** A project as the dashboard lists it: the name לפי פרויקט shows, and whether it holds the general costs. */
export type ForecastProject = { id: string; name: string; is_overhead?: boolean };

/** One project's part of the month-end forecast: what is still to come in and out, and its net. */
export type ForecastProjectGroup = {
  /** The project's id, or null for the general costs (כללי). */
  projectId: string | null;
  name: string;
  income: ForecastItem[];
  expense: ForecastItem[];
  incomeTotal: bigint;
  expenseTotal: bigint;
  net: bigint;
};

export const GENERAL_NAME = "כללי";

/**
 * לפי פרויקט (FLOW-1004, owner 2026-11-01): the month-end forecast's counted items by project, the projects
 * in the dashboard's order, then the general costs (no project, or the overhead project, as the company's צפי
 * page groups them). A recurring charge names its project's id; an invoice names its project, matched to it by
 * name (one the list does not name keeps its own name; a charge on a project the list does not name is
 * general). The small charges count under their own projects; the items moved to next month are left out. The
 * groups' totals add up to the build's.
 */
export function forecastProjects(build: ForecastBuild, projects: readonly ForecastProject[]): ForecastProjectGroup[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const byName = new Map(projects.map((project) => [project.name, project]));
  const groups = new Map<string, ForecastProjectGroup>();
  const general: ForecastProjectGroup = { projectId: null, name: GENERAL_NAME, income: [], expense: [], incomeTotal: 0n, expenseTotal: 0n, net: 0n };

  function groupOf(item: ForecastItem): ForecastProjectGroup {
    const project = item.project_id != null ? byId.get(item.project_id) : item.project_name != null ? byName.get(item.project_name) : undefined;
    // A charge on a project the list does not name (deleted since) has no name to show: it counts as general.
    if (item.project_id != null && project == null) return general;
    const id = project?.id ?? null;
    if (id == null && item.project_name == null) return general;
    if (project?.is_overhead === true) return general;
    const key = id ?? `name:${item.project_name ?? ""}`;
    let group = groups.get(key);
    if (group == null) {
      group = { projectId: id, name: project?.name ?? item.project_name ?? GENERAL_NAME, income: [], expense: [], incomeTotal: 0n, expenseTotal: 0n, net: 0n };
      groups.set(key, group);
    }
    return group;
  }

  for (const item of [...build.income, ...build.expense, ...build.small]) {
    const group = groupOf(item);
    if (item.direction === "income") {
      group.income.push(item);
      group.incomeTotal += item.minor;
    } else {
      group.expense.push(item);
      group.expenseTotal += item.minor;
    }
  }
  const order = new Map(projects.map((project, index) => [project.id, index]));
  const rank = (group: ForecastProjectGroup) => (group.projectId == null ? Number.MAX_SAFE_INTEGER - 1 : order.get(group.projectId) ?? Number.MAX_SAFE_INTEGER - 2);
  const listed = [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "he"));
  const all = general.income.length + general.expense.length > 0 ? [...listed, general] : listed;
  for (const group of all) group.net = group.incomeTotal - group.expenseTotal;
  return all;
}
