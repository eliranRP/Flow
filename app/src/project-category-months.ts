import { projectCategoryMonthsSchema, type ProjectCategoryMonthRow, type ProjectCategoryMonths } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
import type { PeriodChoice } from "./period";
import { useHomePreview } from "./preview";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-401 (decision 0149, owner's v5 "clean"): in the month view a small up mark sits on a category
 * above its usual month. Only the month view shows the marks: next to a quarter's total, "usual for
 * a month" would mislead.
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

/** Why a category carries the up mark: above its usual month, or a cost new this month. */
export type UpKind = "high" | "new" | null;

function flagUp(flag: ProjectCategoryMonthRow["flag"] | undefined): UpKind {
  return flag === "high" || flag === "new" ? flag : null;
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
