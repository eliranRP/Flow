import { projectCategoryMonthsSchema, type ProjectCategoryMonthRow, type ProjectCategoryMonths } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import type { PeriodChoice } from "./period";
import { useHomePreview } from "./preview";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-401 (decision 0149, owner's v5 "clean"): the project page folds grouped categories into
 * one row, and in the month view a small up mark sits on a category above its usual month. A
 * bill that has not come yet shows "—" under its group. Only the month view shows the marks:
 * next to a quarter's total, "usual for a month" would mislead.
 */

/** The month a period shows marks for: its last day (cut at today), or null outside the month view. */
export function markDay(period: PeriodChoice | null): string | null {
  if (period == null || period.kind !== "month" || period.to == null) return null;
  return period.to;
}

/** project_category_months for the month the period ends in (the server's "this month"). */
export function useProjectCategoryMonthsQuery(projectId: string, period: PeriodChoice | null) {
  const preview = useHomePreview();
  const day = markDay(period);
  return useQuery({
    // Under "project", so every write that refreshes the project refreshes the marks too.
    queryKey: ["project", "category-months", preview, projectId, day],
    enabled: preview === "off" && projectId !== "" && day != null,
    queryFn: async (): Promise<ProjectCategoryMonths | null> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("project_category_months", { p_project_id: projectId, p_today: day ?? undefined });
      if (error) throw error;
      return data == null ? null : projectCategoryMonthsSchema.parse(data);
    },
  });
}

export type CategoryLine = {
  currency: string;
  id: string | null;
  name: string | null;
  amount_minor: bigint;
  has_shared_share?: boolean;
};

/** One category row on the project page. `up`: above its usual month. `missing`: a usual bill not in yet. */
export type CategoryItem = { line: CategoryLine; up: UpKind; missing: boolean };

/** Why a category carries the up mark: above its usual month, or a cost new this month. */
export type UpKind = "high" | "new" | null;

export type CategoryEntry =
  | ({ kind: "category" } & CategoryItem)
  | { kind: "group"; name: string; currency: string; amount_minor: bigint; up: UpKind; items: CategoryItem[] };

function key(id: string | null, currency: string): string {
  return `${id ?? ""}:${currency}`;
}

function flagUp(flag: ProjectCategoryMonthRow["flag"] | undefined): UpKind {
  return flag === "high" || flag === "new" ? flag : null;
}

function absMinor(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/**
 * The rows of one currency, in amount order, biggest first. Two or more categories of the same
 * group fold into one row with their total; a lone member stays a plain row. A missing bill
 * joins its group (or the end of the list) with no amount. Order never follows the marks, so a
 * category keeps its place.
 */
export function categoryEntries(
  lines: CategoryLine[],
  groupOf: ReadonlyMap<string, string>,
  months: ProjectCategoryMonthRow[] | null,
): CategoryEntry[] {
  const flags = new Map<string, ProjectCategoryMonthRow["flag"]>();
  for (const row of months ?? []) flags.set(key(row.id, row.currency), row.flag);
  const items: CategoryItem[] = lines.map((line) => ({ line, up: flagUp(flags.get(key(line.id, line.currency))), missing: false }));
  const shown = new Set(lines.map((line) => key(line.id, line.currency)));
  const currency = lines[0]?.currency ?? months?.[0]?.currency;
  for (const row of months ?? []) {
    if (row.flag !== "missing" || row.id == null || row.currency !== currency || shown.has(key(row.id, row.currency))) continue;
    items.push({ line: { currency: row.currency, id: row.id, name: row.name, amount_minor: 0n }, up: null, missing: true });
  }
  const byGroup = new Map<string, CategoryItem[]>();
  for (const item of items) {
    const group = item.line.id == null ? undefined : groupOf.get(item.line.id);
    if (group == null) continue;
    byGroup.set(group, [...(byGroup.get(group) ?? []), item]);
  }
  const entries: CategoryEntry[] = [];
  const placed = new Set<string>();
  for (const item of items) {
    const group = item.line.id == null ? undefined : groupOf.get(item.line.id);
    const members = group == null ? undefined : byGroup.get(group);
    if (group == null || members == null || members.length < 2) {
      entries.push({ kind: "category", ...item });
      continue;
    }
    if (placed.has(group)) continue;
    placed.add(group);
    const sorted = [...members].sort(byAmount);
    entries.push({
      kind: "group",
      name: group,
      currency: item.line.currency,
      amount_minor: members.reduce((sum, member) => sum + member.line.amount_minor, 0n),
      // A high member names the group's mark first; else a new one.
      up: members.find((member) => member.up === "high")?.up ?? members.find((member) => member.up === "new")?.up ?? null,
      items: sorted,
    });
  }
  return entries.sort((a, b) => {
    // Missing bills go last; otherwise biggest first.
    const aMissing = a.kind === "category" && a.missing;
    const bMissing = b.kind === "category" && b.missing;
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    const diff = absMinor(entryAmount(b)) - absMinor(entryAmount(a));
    return diff > 0n ? 1 : diff < 0n ? -1 : 0;
  });
}

function entryAmount(entry: CategoryEntry): bigint {
  return entry.kind === "group" ? entry.amount_minor : entry.line.amount_minor;
}

function byAmount(a: CategoryItem, b: CategoryItem): number {
  if (a.missing !== b.missing) return a.missing ? 1 : -1;
  const diff = absMinor(b.line.amount_minor) - absMinor(a.line.amount_minor);
  return diff > 0n ? 1 : diff < 0n ? -1 : 0;
}

/** The category page's usual-amount line: the expected cost of that category and currency, when known. */
export function usualFor(
  months: ProjectCategoryMonths | null | undefined,
  categoryId: string,
  currency: string,
): { expected: bigint; up: UpKind; currency: string } | null {
  const row = months?.categories.find((item) => item.id === categoryId && item.currency === currency);
  if (row?.expected_minor == null) return null;
  return { expected: BigInt(row.expected_minor), up: flagUp(row.flag), currency };
}
