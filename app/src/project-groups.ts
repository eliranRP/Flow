import type { Dashboard } from "@flow/shared";
import type { ChangeChoice } from "./ui/change-sheet-copy";

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
