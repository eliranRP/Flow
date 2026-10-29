import type { AccountLines } from "../report-schemas";

/**
 * FLOW-165: the account drill-down's fixture, the board's numbers (ReportAccountDrill): a loan's principal on
 * Cedar St, $154,000 owed on 1 January and $4,000 paid down in ten payments of $400. Invented names, cents.
 */

const LOAN = "d0000000-0000-4000-8000-000000000165";

function payment(month: number): AccountLines["rows"][number] {
  const mm = String(month).padStart(2, "0");
  return {
    transaction_id: `b0000000-0000-4000-8000-0000000016${mm}`,
    doc_date: `2026-${mm}-01`,
    currency: "USD",
    amount_minor: -40_000n,
    description: "Mortgage payment",
    party_name: "Example Mortgage Co",
    project_name: "Cedar St",
    part: "principal",
    loan_id: LOAN,
    line_amount_minor: -135_000n,
  };
}

export const REPORT_ACCOUNT_LOAN: AccountLines = {
  account_id: "l-loan",
  name: "Loan principal",
  type: "liability",
  is_system: true,
  as_of: "2026-10-31",
  year_start: "2026-01-01",
  project_id: "a0000000-0000-4000-8000-000000000161",
  project_name: "Cedar St",
  loan_ids: [LOAN],
  currencies: [{ currency: "USD", opening_minor: 15_400_000n, movement_minor: -400_000n, balance_minor: 15_000_000n, count: 10 }],
  rows: [10, 9, 8].map(payment),
  has_more: true,
};

/** An asset with no movement this year: the balance and the opening are the same. */
export const REPORT_ACCOUNT_QUIET: AccountLines = {
  ...REPORT_ACCOUNT_LOAN,
  account_id: "a-escrow",
  name: "Escrow",
  type: "asset",
  project_id: null,
  project_name: null,
  loan_ids: [],
  currencies: [{ currency: "USD", opening_minor: 650_000n, movement_minor: 0n, balance_minor: 650_000n, count: 0 }],
  rows: [],
  has_more: false,
};
