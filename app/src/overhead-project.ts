import { useHomePreview } from "./preview";
import { useProjectsCashMonth } from "./project-cash";
import { overheadRow } from "./project-list";

// Its own module, not project-cash.ts: project-cash is in Home's first load (prefetch.tsx), and this hook and
// project-list.ts are only for the company profit page's chunk.

/** The company's overhead project as the owner set and named it (set_overhead_project). */
export type OverheadProject = { id: string; name: string };

/** The overhead project's read: the project (undefined while it loads), whether the read failed, and a retry. */
type OverheadRead = { project: OverheadProject | null | undefined; failed: boolean; refetch: () => void };

/**
 * The overhead project from the Projects list's read (its `is_overhead` row follows `companies.overhead_project_id`,
 * the same cache as the Projects tab). `project` is undefined while the first read loads, null when none is set; a
 * failed refetch keeps the last answer. Preview and `enabled` false read nothing and give null.
 */
export function useOverheadProject(enabled: boolean): OverheadRead {
  const preview = useHomePreview();
  const live = enabled && preview === "off";
  const read = useProjectsCashMonth(undefined, undefined, live);
  if (!live) return { project: null, failed: false, refetch: () => undefined };
  const refetch = () => { void read.refetch(); };
  if (read.data === undefined) return { project: undefined, failed: read.isError, refetch };
  const row = read.data == null ? undefined : overheadRow(read.data);
  return { project: row == null ? null : { id: row.id, name: row.name }, failed: false, refetch };
}
