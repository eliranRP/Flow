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
    return {
      id: project.id,
      name: project.name,
      status: project.status,
      ...(group != null && project.group_id != null ? { group, groupId: project.group_id } : {}),
    };
  });
}
