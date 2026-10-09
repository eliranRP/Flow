import type { Dashboard, ProjectGroupRow, ProjectRow } from "@flow/shared";
import type { ChangeChoice } from "./ui/change-sheet-copy";

/** FLOW-406 (0164, proj-b): a group as one summary row, its figures summed by the server. */
export type ProjectGroupEntry = { group: ProjectGroupRow; projects: ProjectRow[] };

/** "פרויקט אחד", else "N פרויקטים". */
export function projectCountLabel(count: number): string {
  return count === 1 ? "פרויקט אחד" : `${String(count)} פרויקטים`;
}

export function groupHref(groupId: string, search = ""): string {
  return `/projects/groups/${encodeURIComponent(groupId)}${search}`;
}

/** A group's figures in a project row's shape, so the row and its currencies read like a project's. */
export function groupAsProjectRow(group: ProjectGroupRow): ProjectRow {
  return {
    id: group.id,
    name: group.name,
    status: "active",
    income_agorot: group.income_agorot,
    direct_agorot: group.direct_agorot,
    shared_agorot: group.shared_agorot,
    profit_before_shared_agorot: group.profit_before_shared_agorot,
    profit_agorot: group.profit_agorot,
    by_currency: group.by_currency,
  };
}

/**
 * The Projects tab's top level: each group that holds a project (in the server's order), and the
 * projects in no group. A project whose group the payload does not list stays ungrouped.
 */
export function splitByGroup(data: Pick<Dashboard, "projects" | "groups">): { groups: ProjectGroupEntry[]; loose: ProjectRow[] } {
  const known = new Map((data.groups ?? []).map((group) => [group.id, group] as const));
  const members = new Map<string, ProjectRow[]>();
  const loose: ProjectRow[] = [];
  for (const project of data.projects) {
    const id = project.group_id ?? null;
    if (id == null || !known.has(id)) {
      loose.push(project);
      continue;
    }
    const list = members.get(id) ?? [];
    list.push(project);
    members.set(id, list);
  }
  const groups = [...known.values()]
    .filter((group) => members.has(group.id))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "he"))
    .map((group) => ({ group, projects: members.get(group.id) ?? [] }));
  return { groups, loose };
}

/** One group and its projects, or null when the payload has no such group. */
export function findGroup(data: Pick<Dashboard, "projects" | "groups">, groupId: string): ProjectGroupEntry | null {
  const group = (data.groups ?? []).find((row) => row.id === groupId);
  if (group == null) return null;
  return { group, projects: data.projects.filter((project) => project.group_id === groupId) };
}

/** The picker's project choices, each carrying its group's name (picker, FLOW-406). */
export function projectChoices(data: Pick<Dashboard, "projects" | "groups"> | undefined): ChangeChoice[] {
  if (data == null) return [];
  const names = new Map((data.groups ?? []).map((group) => [group.id, group.name] as const));
  return data.projects.map((project) => {
    const group = project.group_id == null ? undefined : names.get(project.group_id);
    return { id: project.id, name: project.name, status: project.status, ...(group != null ? { group } : {}) };
  });
}
