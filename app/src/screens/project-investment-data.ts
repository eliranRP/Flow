import type { ProjectDetail } from "@flow/shared";
import type { InvestmentFigures } from "../ui/investment-card";
import type { LoanDetail } from "./loan-detail-data";

/* ------------------------------------------------------------------------------------------------
 * Data. The card reads `investment` from the project page's own get_project (decision 0143: it
 * ignores the period and basis). The renovation's own page reads its categories there too (FLOW-460).
 * ---------------------------------------------------------------------------------------------- */

/** A loan's terms as get_project returns them (FLOW-446): enough for loan-outlook's next payment. */
export type InvestmentLoanTerms = Pick<
  LoanDetail,
  "principalMinor" | "annualRatePpm" | "termMonths" | "startDate" | "paymentMinor" | "escrowMinor" | "kind" | "interestOnlyMonths" | "amortizationMonths" | "rates"
>;
export type InvestmentLoan = {
  id: string;
  name: string;
  currency: string;
  balance_minor: bigint;
  /** "open", "paid_off" or "closed". */
  status: string;
  closedOn: string | null;
  /** Null on an older payload that has no terms. */
  terms: InvestmentLoanTerms | null;
};

/** One project's investment, ready for the card and its sheets. */
export type ProjectInvestment = {
  isOverhead: boolean;
  figures: InvestmentFigures | null;
  /** Every loan filed under the project, open first (the loans card dims the ones paid off). */
  loans: InvestmentLoan[];
};

type ProjectLoanRow = NonNullable<NonNullable<ProjectDetail>["loans"]>[number];

function loanTermsOf(loan: ProjectLoanRow): InvestmentLoanTerms | null {
  if (loan.principal_minor == null || loan.annual_rate_ppm == null || loan.start_date == null) return null;
  const kind = loan.kind;
  return {
    principalMinor: BigInt(loan.principal_minor),
    annualRatePpm: loan.annual_rate_ppm,
    termMonths: loan.term_months ?? null,
    startDate: loan.start_date,
    paymentMinor: loan.payment_minor == null ? null : BigInt(loan.payment_minor),
    escrowMinor: BigInt(loan.escrow_minor ?? 0),
    kind: kind === "interest_only" || kind === "balloon" || kind === "demand" ? kind : "amortizing",
    interestOnlyMonths: loan.interest_only_months ?? null,
    amortizationMonths: loan.amortization_months ?? null,
    // Newest first, as the loan page keeps them.
    rates: [...(loan.rates ?? [])]
      .sort((a, b) => (a.effective_date < b.effective_date ? 1 : -1))
      .map((rate) => ({ id: rate.effective_date, effectiveDate: rate.effective_date, annualRatePpm: rate.annual_rate_ppm })),
  };
}

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
    .map((loan): InvestmentLoan => ({
      id: loan.id,
      name: loan.name,
      currency: loan.currency,
      balance_minor: loan.balance_minor,
      status: loan.status ?? "open",
      closedOn: loan.closed_on ?? null,
      terms: loanTermsOf(loan),
    }))
    .sort((a, b) => Number(a.status !== "open") - Number(b.status !== "open"));
  return { isOverhead: project.is_overhead === true, figures, loans };
}
