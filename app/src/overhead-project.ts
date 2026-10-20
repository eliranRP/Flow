import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import { useHomePreview } from "./preview";
import { waitForAccessToken } from "./wait-for-session";

// Its own module: only the company profit page's chunk reads it, never Home's first load.

/** The company's overhead project as the owner set and named it (set_overhead_project). */
export type OverheadProject = { id: string; name: string };

/** The overhead project's read: the project (undefined while it loads), whether the read failed, and a retry. */
type OverheadRead = { project: OverheadProject | null | undefined; failed: boolean; refetch: () => void };

/**
 * The shown company's row (RLS lets only the shown company through): its overhead project id, and that project's id
 * and name through the composite key companies (id, overhead_project_id) → projects (company_id, id).
 */
const OVERHEAD_SELECT = "overhead_project_id, overhead:projects!companies_overhead_project_fk(id, name)";

type OverheadRow = { overhead_project_id: unknown; overhead: unknown };

/**
 * The row as the page uses it: null when no overhead project is set. No row (no readable company) or a set id
 * without its project is a failed read, never "none set": that would split the row again.
 */
function overheadFromRow(row: OverheadRow | null): OverheadProject | null {
  if (row == null) throw new Error("no company");
  if (row.overhead_project_id == null) return null;
  const project: unknown = Array.isArray(row.overhead) ? row.overhead[0] : row.overhead;
  if (typeof project !== "object" || project == null) throw new Error("overhead project");
  const { id, name } = project as { id?: unknown; name?: unknown };
  if (typeof id !== "string" || id !== row.overhead_project_id || typeof name !== "string") throw new Error("overhead project");
  return { id, name };
}

/**
 * The company's overhead project (owner 21/10): `companies.overhead_project_id` and that project's name, in one small
 * read of two rows, never the Projects list's heavy `projects_cash_month`. `project` is undefined while the first read
 * loads, null when none is set; a failed refetch keeps the last answer. A write marks it stale with every other read
 * (query-client.ts), so a rename or a new overhead project shows on the next visit. Preview and `enabled` false read
 * nothing and give null.
 */
export function useOverheadProject(enabled: boolean): OverheadRead {
  const preview = useHomePreview();
  const live = enabled && preview === "off";
  const read = useQuery({
    queryKey: ["company-overhead", preview],
    enabled: live,
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.from("companies").select(OVERHEAD_SELECT).maybeSingle();
      if (error) throw error;
      return overheadFromRow(data);
    },
  });
  if (!live) return { project: null, failed: false, refetch: () => undefined };
  const refetch = () => { void read.refetch(); };
  if (read.data === undefined) return { project: undefined, failed: read.isError, refetch };
  return { project: read.data, failed: false, refetch };
}
