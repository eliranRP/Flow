import type { MissingBill, RecurringChange } from "@flow/shared";
import { chargeChangeViews, lateCounts, useMissingBillsQuery, useProjectRecurringChangesQuery } from "../forecast";
import { BUDGET_ALERT_PERCENT, budgetPercent } from "../project-list";
import type { BannerRow } from "../ui/banner";
import { attentionRows } from "./attention-rows";

function withParam(search: string, key: string, value: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set(key, value);
  return `?${params.toString()}`;
}

/** A sample project's recurring alerts (stories and tests). */
export type ProjectRecurringSample = { late: MissingBill[]; changes: RecurringChange[] };

/**
 * FLOW-1043 (BUILD-PLAN §3.5): what each row counts, so a row hidden on this device comes back once that
 * changes. The review row has no key: it counts work to do and is never hidden (plan §5).
 */
function keyed(row: BannerRow, counts: Record<string, string>): BannerRow {
  if (row.button != null) return row;
  const count = counts[row.id] ?? (row.id.startsWith("change:") ? row.id : undefined);
  return count == null ? row : { ...row, dismissKey: `${row.id}:${count}` };
}

/**
 * The project page like Home (owner, 2026-10-10): Home's attention rows for one project. Its
 * expenses still waiting for approval open the review on the project; its late bills and income
 * and its changed recurring charges are Home's rows, counting only the project's (FLOW-441: each
 * change measured on the project's own share, from project_recurring_changes). The server
 * already leaves out what this user hid (decision 0175), so a hide on קבועים hides it here too.
 * FLOW-1044: on the project page they are AttentionCards, and a renovation past 80% of its budget adds a row.
 */
export function projectAttentionRows({
  projectId,
  pending,
  late,
  changes,
  search,
  budget = null,
}: {
  projectId: string;
  pending: number;
  late: readonly MissingBill[];
  changes: readonly RecurringChange[];
  search: string;
  /** FLOW-1044: the budget and what is spent of it, for the "עבר 80% מהתקציב" row. */
  budget?: { budget_minor: number | null; spent_minor: number } | null;
}): BannerRow[] {
  const counts = lateCounts(late.filter((row) => row.project_id === projectId));
  const own = changes.filter((row) => row.project_id === projectId);
  const views = chargeChangeViews(own, search);
  const rows = attentionRows({
    pending,
    unpaidCount: 0,
    unpaidGross: 0n,
    missingCount: counts.expense,
    missingIncome: counts.income,
    changes: views,
    search,
  });
  // FLOW-424 (C18-4): the review, קבועים and changed-charges rows open on this project, so the count matches.
  const projectSearch = withParam(search, "project", projectId);
  const routed = rows.map((row) => ({ ...row, to: row.to.replace(/^\/(review|missing-bills|recurring\/changes)[^#]*/, (_, page: string) => `/${page}${projectSearch}`) }));
  const percent = budget == null ? null : budgetPercent(budget);
  if (percent != null && percent >= BUDGET_ALERT_PERCENT) {
    routed.push({
      id: "budget",
      to: `/projects/${projectId}${search}#budget`,
      title: percent > 100 ? "עבר את התקציב" : <>עבר <bdi dir="ltr">{`${String(BUDGET_ALERT_PERCENT)}%`}</bdi> מהתקציב</>,
      short: "תקציב",
      tag: percent > 100 ? "חריגה" : `מעל ${String(BUDGET_ALERT_PERCENT)}%`,
    });
  }
  // A single changed charge's row counts its amount, so a new amount brings back a hidden row.
  const nowById = Object.fromEntries(views.map((view) => [`change:${view.id}`, view.now]));
  return routed.map((row) => keyed(row, {
    ...nowById,
    missing: String(counts.expense),
    "missing-income": String(counts.income),
    changes: String(own.length),
    budget: percent == null ? "" : percent > 100 ? "over" : String(BUDGET_ALERT_PERCENT),
  }));
}

/** The reads behind the rows: Home's, so a hide or a new bill refreshes both. Off for a sample or another section. */
export function useProjectRecurring(projectId: string, active: boolean, sample?: ProjectRecurringSample): ProjectRecurringSample {
  const missing = useMissingBillsQuery(active && sample == null);
  // FLOW-441: the project's own changes, not Home's company-wide ones filtered by project.
  const changes = useProjectRecurringChangesQuery(projectId, active && sample == null);
  if (sample) return sample;
  // A failed read just hides its rows, as on Home.
  return { late: missing.data ?? [], changes: changes.data ?? [] };
}
