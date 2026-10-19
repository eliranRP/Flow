import { buildLoanSchedule, type CategoryRow, type LoanScheduleRow } from "@flow/shared";
import type { LoanDetail } from "./screens/loan-detail-data";
import { loanScheduleTerms, type ScheduleLoan } from "./screens/loan-outlook";

/**
 * The loan rows of a project's next-month forecast (decision 0190), pure: for each open loan filed under the
 * project, in the forecast's currency, its schedule's interest and escrow for the month, each in the category
 * the loan's payments file that part to. Principal never counts.
 */

/** A loan as the forecast reads it: its terms, where it sits, and the categories its parts file to. */
export type ForecastLoan = ScheduleLoan & Pick<LoanDetail, "id" | "currency" | "status" | "projectId" | "categoryIds">;

/** A company category as the forecast reads it (list_categories). */
export type ForecastCategory = Pick<CategoryRow, "id" | "name" | "loan_part" | "excluded_from_pnl">;

/** One category's expected loan cost in the month: positive, in minor units. */
export type LoanPart = { categoryId: string; name: string; minor: bigint };

/** The loan's schedule row due in `month` (yyyy-mm); null for a loan with no schedule or none due then. */
function scheduleRow(loan: ForecastLoan, month: string): LoanScheduleRow | null {
  const terms = loanScheduleTerms(loan);
  if (terms == null) return null;
  try {
    return buildLoanSchedule(terms).rows.find((row) => row.dueDate.slice(0, 7) === month) ?? null;
  } catch {
    // Terms the schedule refuses give nothing, as on the loan page.
    return null;
  }
}

/**
 * The category a part files to: the loan's own, else the company's keyed one (categories.loan_part), as a
 * payment's split picks it. Null when there is none, or it is kept out of the profit (decision 0166).
 */
function partCategory(loan: ForecastLoan, part: "interest" | "escrow", categories: readonly ForecastCategory[]): ForecastCategory | null {
  const own = loan.categoryIds[part];
  const category = own == null
    ? categories.find((row) => row.loan_part === part)
    : categories.find((row) => row.id === own);
  return category == null || category.excluded_from_pnl === true ? null : category;
}

/** The month's loan costs by category: several loans in one category sum; a zero part makes no row. */
export function loanParts(input: {
  projectId: string;
  currency: string;
  month: string;
  loans: readonly ForecastLoan[];
  categories: readonly ForecastCategory[];
}): LoanPart[] {
  const parts = new Map<string, LoanPart>();
  const add = (category: ForecastCategory | null, minor: bigint) => {
    if (category == null || minor <= 0n) return;
    const held = parts.get(category.id);
    parts.set(category.id, { categoryId: category.id, name: category.name, minor: (held?.minor ?? 0n) + minor });
  };
  for (const loan of input.loans) {
    if (loan.projectId !== input.projectId || loan.status !== "open" || loan.currency !== input.currency) continue;
    const row = scheduleRow(loan, input.month);
    if (row == null) continue;
    add(partCategory(loan, "interest", input.categories), row.interestMinor);
    add(partCategory(loan, "escrow", input.categories), row.escrowMinor);
  }
  return [...parts.values()];
}
