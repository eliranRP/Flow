import type { OverheadProject } from "./project-cash";

/**
 * get_breakdown by project keys the general costs `overhead` (overhead-role costs, the overhead project's among
 * them) and `unassigned` (no project); every other key is a project id, the overhead project's own lines (its
 * income, and any line without the overhead role) among them. Its `shared` flag marks a project holding a share of
 * a shared cost, so it never means the general costs. The month's and the year's project lists both read a group here.
 */
const GENERAL_KEYS: ReadonlySet<string> = new Set(["overhead", "unassigned"]);

/**
 * The list row a project breakdown group belongs to: its project, opening it; or the general costs' one row, keyed
 * "" (owner 20/10). With an overhead project set it holds `overhead`, `unassigned` and that project's own id, takes
 * the project's name and opens it; with none it is כללי and opens nothing.
 */
export function projectGroupRow(group: { key: string; name: string | null }, overhead: OverheadProject | null): { key: string; title: string; projectId: string | null } {
  if (GENERAL_KEYS.has(group.key) || group.key === overhead?.id) {
    return { key: "", title: overhead?.name ?? "כללי", projectId: overhead?.id ?? null };
  }
  return { key: group.key, title: group.name ?? "", projectId: group.key };
}
