import type { CategoryRow, LoanScheduleRow, ProjectDetail } from "@flow/shared";
import { type LoanDetail, type LoanDetailDbRow, readLoanRow } from "./screens/loan-detail-data";
import { type OutlookLoan, paymentsLeft } from "./screens/loan-outlook";

/**
 * The loan rows of a project's next-month forecast (decision 0190), pure: for each open loan filed under the
 * project, in the forecast's currency, the interest and escrow of its payment due in the month (the loan
 * page's payments left, from the balance in the books, FLOW-427), each in the category
 * the loan's payments file that part to. Principal is not a profit line: loanCashOnly gives it apart, with any
 * part kept out of the profit, for the project page's cash variant of the forecast (decision 0196).
 */

/** A loan as the forecast reads it: its terms, where it sits, and the categories its parts file to. */
export type ForecastLoan = OutlookLoan & Pick<LoanDetail, "id" | "currency" | "projectId" | "categoryIds">;

/** The loans block of get_project's answer. */
type ProjectLoan = NonNullable<NonNullable<ProjectDetail>["loans"]>[number];

/**
 * The forecast's loans from the project's own get_project answer (FLOW-1240), the same loans the loans and
 * loan_balances reads gave (readLoanRow, so the rates, the balance and the categories are read the same way). A
 * project with no loans, or no project at all, gives none. A field an older answer lacks reads as empty: the four
 * category ids of a cached answer from before FLOW-1240 are null (the company's keyed categories apply).
 */
export function forecastLoansOf(project: ProjectDetail): ForecastLoan[] {
  if (project == null) return [];
  return (project.loans ?? []).map((loan) => {
    const { id, currency, projectId, categoryIds, status, balanceMinor, kind, termMonths, paymentMinor, rates, principalMinor, annualRatePpm, startDate, escrowMinor, interestOnlyMonths, amortizationMonths } =
      readLoanRow(loanDbRow(loan, project.id), { balanceMinor: loan.balance_minor, flaggedParts: 0 });
    return { id, currency, projectId, categoryIds, status, balanceMinor, kind, termMonths, paymentMinor, rates, principalMinor, annualRatePpm, startDate, escrowMinor, interestOnlyMonths, amortizationMonths };
  });
}

/** One get_project loan as the loans read's row. */
function loanDbRow(loan: ProjectLoan, projectId: string): LoanDetailDbRow {
  return {
    id: loan.id,
    company_id: "",
    name: loan.name,
    currency: loan.currency,
    principal_minor: loan.principal_minor ?? 0,
    annual_rate_ppm: loan.annual_rate_ppm ?? 0,
    term_months: loan.term_months ?? null,
    start_date: loan.start_date ?? "",
    payment_minor: loan.payment_minor ?? null,
    escrow_minor: loan.escrow_minor ?? 0,
    kind: (loan.kind ?? "amortizing") as LoanDetailDbRow["kind"],
    interest_only_months: loan.interest_only_months ?? null,
    amortization_months: loan.amortization_months ?? null,
    status: (loan.status ?? "open") as LoanDetailDbRow["status"],
    closed_on: loan.closed_on ?? null,
    project_id: projectId,
    interest_category_id: loan.interest_category_id ?? null,
    escrow_category_id: loan.escrow_category_id ?? null,
    principal_category_id: loan.principal_category_id ?? null,
    fees_category_id: loan.fees_category_id ?? null,
    loan_rates: (loan.rates ?? []).map((rate) => ({ id: "", effective_date: rate.effective_date, annual_rate_ppm: rate.annual_rate_ppm })),
  };
}

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

/** One loan's cash in the month that no loan row holds, and the categories of the loan rows it has. */
export type LoanCash = {
  loanId: string;
  /** The categories its interest and escrow rows file to (`avg:<id>`); empty when it has none. */
  rowCategoryIds: string[];
  /** Positive, in minor units. */
  minor: bigint;
};

/**
 * The cash of the same payments that no loan row holds, loan by loan: the principal, and the interest or
 * escrow whose category is kept out of the profit (decision 0166, a flip's hard-money interest) or missing.
 * With the loan rows, the whole payment. A loan with nothing of the kind is left out.
 */
export function loanCashOnly(input: LoanMonth & { categories: readonly ForecastCategory[] }): LoanCash[] {
  const positive = (minor: bigint) => (minor > 0n ? minor : 0n);
  return dueRows(input).flatMap(({ loan, row }) => {
    const rowCategoryIds: string[] = [];
    let minor = positive(row.principalMinor);
    for (const [part, amount] of [["interest", row.interestMinor], ["escrow", row.escrowMinor]] as const) {
      const category = partCategory(loan, part, input.categories);
      if (category == null) minor += positive(amount);
      else if (amount > 0n) rowCategoryIds.push(category.id);
    }
    return minor === 0n ? [] : [{ loanId: loan.id, rowCategoryIds, minor }];
  });
}
