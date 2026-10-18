import type { ForecastBuild, ForecastItem } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { monthEndDay } from "../forecast-month";
import { getSupabase } from "../lib/supabase";
import { loadReadSchemas } from "../load-read-schemas";
import { useHomePreview } from "../preview";
import { waitForAccessToken } from "../wait-for-session";
import { itemLate } from "./forecast-parts";

/**
 * The forecast by category (לפי קטגוריה): for each side, what each category already had this month
 * (cash, `get_breakdown` by category) and the forecast items still to come in it. A row's end figure
 * is the two together; the sides' sums are the month's totals at its end.
 */

/** One category's figure this month so far, unsigned, in the base's minor units. `key` is its id, or "none". */
export type CategorySoFar = { key: string; name: string | null; minor: bigint };
export type ForecastSoFar = { income: readonly CategorySoFar[]; expense: readonly CategorySoFar[] };

export type ForecastCategoryRow = {
  key: string;
  name: string;
  soFar: bigint;
  /** The items still to come, unsigned. */
  ahead: bigint;
  end: bigint;
  items: ForecastItem[];
  late: ForecastItem[];
};

export type ForecastCategorySide = { direction: "income" | "expense"; total: bigint; rows: ForecastCategoryRow[] };

/** A category with no id ("none"), or one Flow cannot name. */
export const OTHER_CATEGORY = "אחר";

export function forecastCategories(
  build: Pick<ForecastBuild, "income" | "expense" | "small">,
  soFar: ForecastSoFar,
  names: ReadonlyMap<string, string>,
  today: string,
): ForecastCategorySide[] {
  return (["expense", "income"] as const).map((direction) => {
    const rows = new Map<string, ForecastCategoryRow>();
    const row = (key: string, name: string | null) => {
      let found = rows.get(key);
      if (found == null) {
        found = { key, name: name ?? names.get(key) ?? OTHER_CATEGORY, soFar: 0n, ahead: 0n, end: 0n, items: [], late: [] };
        rows.set(key, found);
      }
      return found;
    };
    for (const group of soFar[direction]) {
      if (group.minor !== 0n) row(group.key, group.key === "none" ? null : group.name).soFar += group.minor;
    }
    const items = direction === "income" ? build.income : [...build.expense, ...build.small];
    for (const item of items) {
      const target = row(item.category_id ?? "none", null);
      target.ahead += item.minor;
      target.items.push(item);
      if (itemLate(item, today)) target.late.push(item);
    }
    const list = [...rows.values()].map((entry) => ({ ...entry, end: entry.soFar + entry.ahead }));
    list.sort((a, b) => (a.end === b.end ? a.name.localeCompare(b.name, "he") : a.end > b.end ? -1 : 1));
    return { direction, total: list.reduce((sum, entry) => sum + entry.end, 0n), rows: list };
  });
}

/** A recurring item's charge (`party:<direction>:<id>:<currency>[:<project>]`), for its page; null for an invoice. */
export function itemCharge(item: ForecastItem): { direction: "income" | "expense"; partyId: string; projectId: string | null } | null {
  if (item.kind !== "recurring") return null;
  const [, , partyId, , project] = item.key.split(":");
  if (partyId == null || partyId === "") return null;
  return { direction: item.direction, partyId, projectId: project == null || project === "none" ? null : project };
}

/** This month's cash so far by category, in the base, for both sides. */
export function useForecastSoFarQuery(month: string, base: string, active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["month-forecast", "so-far", preview, month, base],
    enabled: active && preview === "off",
    queryFn: async (): Promise<ForecastSoFar> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const range = { p_from: `${month}-01`, p_to: monthEndDay(month), p_group_by: "category", p_basis: "cash" };
      const [income, expense] = await Promise.all([
        supabase.rpc("get_breakdown", { ...range, p_direction: "income" }),
        supabase.rpc("get_breakdown", { ...range, p_direction: "expense" }),
      ]);
      if (income.error) throw income.error;
      if (expense.error) throw expense.error;
      const { breakdownSchema } = await loadReadSchemas();
      const groups = (data: unknown): CategorySoFar[] =>
        (breakdownSchema.parse(data)?.groups ?? [])
          .filter((group) => group.currency === base)
          .map((group) => ({ key: group.key, name: group.name, minor: group.amount_minor }));
      return { income: groups(income.data), expense: groups(expense.data) };
    },
  });
}
