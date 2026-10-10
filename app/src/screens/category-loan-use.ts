import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabase";
import { assertNoError } from "../use-write";

/** A loan's own category for one of its parts (decision 0128). Fees stay free (0130), so they are not here. */
export type CategoryLoanUse = { loanName: string; part: "interest" | "escrow" | "principal" };

/** The loan columns as a story or the read gives them. */
export type LoanCategoryColumns = {
  name: string;
  interest_category_id: string | null;
  escrow_category_id: string | null;
  principal_category_id: string | null;
};

const PART_WORD: Record<CategoryLoanUse["part"], string> = {
  interest: "ריבית",
  escrow: "מסים וביטוח",
  principal: "קרן",
};

/** Each category a loan names for interest, escrow or principal; the first loan by name wins. */
export function categoryLoanUses(loans: readonly LoanCategoryColumns[]): Map<string, CategoryLoanUse> {
  const uses = new Map<string, CategoryLoanUse>();
  const sorted = [...loans].sort((a, b) => a.name.localeCompare(b.name, "he"));
  for (const loan of sorted) {
    for (const part of ["interest", "escrow", "principal"] as const) {
      const id = loan[`${part}_category_id`];
      if (id != null && !uses.has(id)) uses.set(id, { loanName: loan.name, part });
    }
  }
  return uses;
}

/** The locked line in a loan category's ⋯ sheet: its first line, and an optional second one under it. */
export type LoanLine = { title: string; detail?: string };

/**
 * FLOW-106 §3.5, FLOW-362: the locked line in the category's ⋯ sheet, "קטגוריה של הלוואה" on line 1 and
 * "<loan> · ריבית" on line 2, so a long loan name never breaks across the two. The name is isolated, as a bdi would.
 */
export function loanUseLine(use: CategoryLoanUse): LoanLine {
  return { title: "קטגוריה של הלוואה", detail: `\u2068${use.loanName}\u2069\u00a0· ${PART_WORD[use.part]}` };
}

/** The company's loans' own categories, for Settings → Categories. */
export function useCategoryLoanUses(companyId: string | null | undefined, sample?: readonly LoanCategoryColumns[]) {
  const query = useQuery({
    queryKey: ["loans", companyId, "categories"],
    enabled: sample == null && companyId != null,
    retry: false,
    queryFn: async (): Promise<LoanCategoryColumns[]> => {
      const supabase = getSupabase();
      if (!supabase || companyId == null) return [];
      const loans = await supabase
        .from("loans")
        .select("name, interest_category_id, escrow_category_id, principal_category_id")
        .eq("company_id", companyId);
      assertNoError(loans);
      return loans.data ?? [];
    },
  });
  return categoryLoanUses(sample ?? query.data ?? []);
}
