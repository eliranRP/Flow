import type { CategoryRow, LoanScheduleRow } from "@flow/shared";
import type { LoanDetail } from "./screens/loan-detail-data";
import { type OutlookLoan, paymentsLeft } from "./screens/loan-outlook";

/**
 * The loan rows of a project's next-month forecast (decision 0190), pure: for each open loan filed under the
 * project, in the forecast's currency, the interest and escrow of its payment due in the month (the loan
 * page's payments left, from the balance in the books, FLOW-427), each in the category
 * the loan's payments file that part to. Principal is not a profit line: loanPrincipal gives it apart, for the
 * project page's cash variant of the forecast (decision 0196).
 */

/** A loan as the forecast reads it: its terms, where it sits, and the categories its parts file to. */
export type ForecastLoan = OutlookLoan & Pick<LoanDetail, "id" | "currency" | "projectId" | "categoryIds">;

/** A company category as the forecast reads it (list_categories). */
export type ForecastCategory = Pick<CategoryRow, "id" | "name" | "loan_part" | "excluded_from_pnl">;

/** One category's expected loan cost in the month: positive, in minor units. */
export type LoanPart = { categoryId: string; name: string; minor: bigint };

/** The loan's payment due in `month` (yyyy-mm), as the loan page shows it; null when none is due then. */
function scheduleRow(loan: ForecastLoan, month: string, today: string): LoanScheduleRow | null {
  return paymentsLeft(loan, today)?.find((row) => row.dueDate.slice(0, 7) === month) ?? null;
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

/** Which loans and month the forecast reads: the project's, in the forecast's currency. */
type LoanMonth = {
  projectId: string;
  currency: string;
  month: string;
  /** yyyy-mm-dd: the payments left start from the one due today or later. */
  today: string;
  loans: readonly ForecastLoan[];
};

/**
 * The payment due in the month of each open loan filed under the project, in the forecast's currency. A
 * closed or paid-off loan, a demand loan, or a month with no payment left gives none.
 */
function dueRows(input: LoanMonth): { loan: ForecastLoan; row: LoanScheduleRow }[] {
  return input.loans.flatMap((loan) => {
    if (loan.projectId !== input.projectId || loan.status !== "open" || loan.currency !== input.currency) return [];
    const row = scheduleRow(loan, input.month, input.today);
    return row == null ? [] : [{ loan, row }];
  });
}

/** The month's loan costs by category: several loans in one category sum; a zero part makes no row. */
export function loanParts(input: LoanMonth & { categories: readonly ForecastCategory[] }): LoanPart[] {
  const parts = new Map<string, LoanPart>();
  const add = (category: ForecastCategory | null, minor: bigint) => {
    if (category == null || minor <= 0n) return;
    const held = parts.get(category.id);
    parts.set(category.id, { categoryId: category.id, name: category.name, minor: (held?.minor ?? 0n) + minor });
  };
  for (const { loan, row } of dueRows(input)) {
    add(partCategory(loan, "interest", input.categories), row.interestMinor);
    add(partCategory(loan, "escrow", input.categories), row.escrowMinor);
  }
  return [...parts.values()];
}

/** The principal of the same payments, summed: cash out that the profit leaves out. Positive, in minor units. */
export function loanPrincipal(input: LoanMonth): bigint {
  return dueRows(input).reduce((sum, { row }) => sum + (row.principalMinor > 0n ? row.principalMinor : 0n), 0n);
}
