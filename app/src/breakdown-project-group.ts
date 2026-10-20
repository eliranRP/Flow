/**
 * get_breakdown by project keys the general costs `overhead` (overhead-role costs, the overhead project's among
 * them) and `unassigned` (no project); every other key is a project id. Its `shared` flag marks a project holding a
 * share of a shared cost, so it never means כללי. The month's and the year's project lists both read a group here.
 */
const GENERAL_KEYS: ReadonlySet<string> = new Set(["overhead", "unassigned"]);

/**
 * The list row a project breakdown group belongs to: its project, opening it; or the general costs' one row,
 * keyed "", titled כללי, with no project to open.
 */
export function projectGroupRow(group: { key: string; name: string | null }): { key: string; title: string; projectId: string | null } {
  if (GENERAL_KEYS.has(group.key)) return { key: "", title: "כללי", projectId: null };
  return { key: group.key, title: group.name ?? "", projectId: group.key };
}
