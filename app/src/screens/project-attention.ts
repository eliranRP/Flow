import type { MissingBill, RecurringChange } from "@flow/shared";
import { chargeChangeViews, lateCounts, useMissingBillsQuery, useRecurringChangesQuery } from "../forecast";
import { withParam } from "./project-categories";
import type { BannerRow } from "../ui/banner";
import { attentionRows } from "./attention-rows";

/** A sample project's recurring alerts (stories and tests). */
export type ProjectRecurringSample = { late: MissingBill[]; changes: RecurringChange[] };

/**
 * The project page like Home (owner, 2026-10-10): Home's attention rows for one project. Its
 * expenses still waiting for approval open the review on the project; its late bills and income
 * and its changed recurring charges are Home's rows, counting only the project's. The server
 * already leaves out what this user hid (decision 0175), so a hide on קבועים hides it here too.
 */
export function projectAttentionRows({
  projectId,
  pending,
  late,
  changes,
  search,
}: {
  projectId: string;
  pending: number;
  late: readonly MissingBill[];
  changes: readonly RecurringChange[];
  search: string;
}): BannerRow[] {
  const counts = lateCounts(late.filter((row) => row.project_id === projectId));
  const rows = attentionRows({
    pending,
    unpaidCount: 0,
    unpaidGross: 0n,
    missingCount: counts.expense,
    missingIncome: counts.income,
    changes: chargeChangeViews(changes.filter((row) => row.project_id === projectId), search),
    search,
  });
  // FLOW-424 (C18-4): the review and קבועים rows open on this project, so the count matches.
  const projectSearch = withParam(search, "project", projectId);
  return rows.map((row) => ({ ...row, to: row.to.replace(/^\/(review|missing-bills)[^#]*/, (_, page) => `/${page}${projectSearch}`) }));
}

/** The reads behind the rows: Home's, so a hide or a new bill refreshes both. Off for a sample or another section. */
export function useProjectRecurring(active: boolean, sample?: ProjectRecurringSample): ProjectRecurringSample {
  const missing = useMissingBillsQuery(active && sample == null);
  const changes = useRecurringChangesQuery(active && sample == null);
  if (sample) return sample;
  // A failed read just hides its rows, as on Home.
  return { late: missing.data ?? [], changes: changes.data ?? [] };
}
