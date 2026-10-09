import { useQuery } from "@tanstack/react-query";
import type { ProjectDetail } from "@flow/shared";
import { z } from "zod";
import { getSupabase } from "../lib/supabase";
import { useHomePreview } from "../preview";
import type { InvestmentFigures } from "../ui/investment-card";
import { waitForAccessToken } from "../wait-for-session";

/* ------------------------------------------------------------------------------------------------
 * Data. The card reads `investment` from the project page's own get_project (decision 0143: it
 * ignores the period and basis). Only the rehab sheet reads the project again, on the cash basis for
 * all time, to list rehab by category; it runs while that sheet is open.
 * ---------------------------------------------------------------------------------------------- */

const minorInput = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]);
const minor = minorInput.transform((value) => BigInt(value));

const categoryAmountSchema = z.object({
  currency: z.string(),
  id: z.string().nullable(),
  name: z.string().nullable(),
  amount_minor: minor,
});

const rehabCostsSchema = z
  .object({
    categories_by_currency: z.array(categoryAmountSchema).optional(),
    excluded_categories_by_currency: z.array(categoryAmountSchema).optional(),
  })
  .nullable();

const rehabCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  excluded_from_pnl: z.boolean().optional(),
  loan_part: z.string().nullable().optional(),
  rehab: z.boolean().nullable().optional(),
  in_rehab: z.boolean().optional(),
});

export type CategoryAmount = { id: string | null; name: string | null; currency: string; minor: bigint };
export type InvestmentLoan = { id: string; name: string; currency: string; balance_minor: bigint };
export type RehabCategory = z.infer<typeof rehabCategorySchema>;

/** One project's investment, ready for the card and its sheets. */
export type ProjectInvestment = {
  isOverhead: boolean;
  figures: InvestmentFigures | null;
  /** Open loans filed under the project. */
  loans: InvestmentLoan[];
  /** Stories only: the rehab sheet's costs by category, with no network. */
  categories?: CategoryAmount[];
};

export type ProjectSource = Pick<NonNullable<ProjectDetail>, "id" | "is_overhead" | "investment" | "loans">;

export function toProjectInvestment(project: ProjectSource): ProjectInvestment {
  const inv = project.investment ?? null;
  const figures: InvestmentFigures | null = inv == null ? null : {
    currency: inv.currency,
    purchaseMinor: inv.purchase_minor,
    arvMinor: inv.arv_minor,
    valueMinor: inv.value_minor,
    valueDate: inv.value_date,
    rehabMinor: inv.rehab_minor,
    rehabOther: inv.rehab_other_currencies.map((row) => ({ currency: row.currency, minor: row.amount_minor })),
    loanMinor: inv.loan_balance_minor,
    loanOther: inv.loan_balance_other_currencies.map((row) => ({ currency: row.currency, minor: row.balance_minor })),
    forcedEquityMinor: inv.forced_equity_minor,
    currentEquityMinor: inv.current_equity_minor,
  };
  const loans = (project.loans ?? [])
    .filter((loan) => loan.status == null || loan.status === "open")
    .map(({ id, name, currency, balance_minor }) => ({ id, name, currency, balance_minor }));
  return { isOverhead: project.is_overhead === true, figures, loans };
}

/** All-time, cash-basis costs by category, in and out of the P&L: rehab's own rule (0143). */
export function useRehabCostsQuery(projectId: string, active: boolean) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["project", preview, projectId, "rehab-costs"],
    enabled: active && preview === "off" && projectId !== "",
    queryFn: async (): Promise<CategoryAmount[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("get_project", { p_id: projectId, p_basis: "cash" });
      if (error) throw error;
      const parsed = rehabCostsSchema.parse(data);
      return [...(parsed?.categories_by_currency ?? []), ...(parsed?.excluded_categories_by_currency ?? [])].map((row) => ({
        id: row.id,
        name: row.name,
        currency: row.currency,
        minor: row.amount_minor,
      }));
    },
  });
}

/** What each category counts as in rehab. Under "categories", so the rehab switch refreshes it. */
export function useRehabCategoriesQuery(active: boolean) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["categories", preview, "rehab"],
    enabled: active && preview === "off",
    queryFn: async (): Promise<RehabCategory[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("list_categories");
      if (error) throw error;
      return rehabCategorySchema.array().parse(data);
    },
  });
}

/* ------------------------------------------------------------------------------------------------
 * The rehab list: the categories that make the total, then the ones left out (FLOW-404).
 * ---------------------------------------------------------------------------------------------- */

export type RehabLine = { key: string; id: string | null; name: string; minor: bigint; reason?: string };
export type RehabBreakdown = { counted: RehabLine[]; left: RehabLine[]; addsUp: boolean };

export const NO_CATEGORY = "בלי קטגוריה";
export const REHAB_TOTAL_ONLY = "הפירוט לפי קטגוריה לא זמין.";

function leftOutReason(category: RehabCategory | undefined): string | undefined {
  if (category == null) return undefined;
  if (category.rehab === false) return "הוצאה מהשיפוץ בהגדרות";
  if (category.loan_part != null && category.loan_part !== "") return "חלק מתשלום הלוואה";
  if (category.excluded_from_pnl === true) return "מחוץ לרווח והפסד";
  return undefined;
}

/**
 * Splits the project's costs in its currency by what each category counts as. A line with no
 * category counts (0143). `addsUp` is false when the counted rows do not make the server's total,
 * for example a loan part filed in an ordinary category; the sheet then shows only the total.
 */
export function rehabBreakdown(
  costs: readonly CategoryAmount[],
  categories: readonly RehabCategory[],
  currency: string,
  rehabMinor: bigint,
): RehabBreakdown {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const merged = new Map<string, RehabLine>();
  for (const row of costs) {
    if (row.currency !== currency) continue;
    const key = row.id ?? "";
    const line = merged.get(key);
    if (line) line.minor += row.minor;
    else merged.set(key, { key, id: row.id, name: row.name ?? NO_CATEGORY, minor: row.minor });
  }
  const counted: RehabLine[] = [];
  const left: RehabLine[] = [];
  for (const line of merged.values()) {
    if (line.minor === 0n) continue;
    const category = line.id == null ? undefined : byId.get(line.id);
    const inRehab = line.id == null || (category?.in_rehab ?? false);
    if (inRehab) counted.push(line);
    else left.push({ ...line, reason: leftOutReason(category) });
  }
  const byAmount = (a: RehabLine, b: RehabLine) => {
    if (a.id == null && b.id != null) return 1;
    if (b.id == null && a.id != null) return -1;
    return a.minor === b.minor ? 0 : a.minor > b.minor ? -1 : 1;
  };
  counted.sort(byAmount);
  left.sort(byAmount);
  const sum = counted.reduce((total, line) => total + line.minor, 0n);
  return { counted, left, addsUp: sum === rehabMinor };
}
