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
  from: "2026-01-01",
  from_start: false,
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

/** FLOW-171: an equity account with a long Latin name, the owner's report in invented figures: a partner's money in and out. */
const EQUITY_NAME = "Partner A – Contributions/Distributions";

function equityMove(date: string, amount: bigint, description: string): AccountLines["rows"][number] {
  return {
    transaction_id: `e0000000-0000-4000-8000-0000${date.replaceAll("-", "")}`,
    doc_date: date,
    currency: "USD",
    amount_minor: amount,
    description,
    party_name: "Partner A",
    project_name: null,
    part: null,
    loan_id: null,
    line_amount_minor: amount,
  };
}

/** This year: $100,000 in on 1 January, one $10,000 contribution in October. */
export const REPORT_ACCOUNT_EQUITY: AccountLines = {
  account_id: "q-partner",
  name: EQUITY_NAME,
  type: "equity",
  is_system: false,
  as_of: "2026-10-31",
  from: "2026-01-01",
  from_start: false,
  project_id: null,
  project_name: null,
  loan_ids: [],
  currencies: [{ currency: "USD", opening_minor: 10_000_000n, movement_minor: 1_000_000n, balance_minor: 11_000_000n, count: 1 }],
  rows: [equityMove("2026-10-05", 1_000_000n, "Partner contribution")],
  has_more: false,
};

/** From the start: no opening, and the movements of 2026 and 2025 under a heading per year. */
export const REPORT_ACCOUNT_EQUITY_ALL: AccountLines = {
  ...REPORT_ACCOUNT_EQUITY,
  from: null,
  from_start: true,
  currencies: [{ currency: "USD", opening_minor: 0n, movement_minor: 11_000_000n, balance_minor: 11_000_000n, count: 4 }],
  rows: [
    equityMove("2026-10-05", 1_000_000n, "Partner contribution"),
    equityMove("2025-12-20", -500_000n, "Partner distribution"),
    equityMove("2025-06-10", 3_000_000n, "Partner contribution"),
    equityMove("2025-02-01", 7_500_000n, "Partner contribution"),
  ],
};

/** The balance sheet dated 31 December 2025: that year's opening and movements. */
export const REPORT_ACCOUNT_EQUITY_2025: AccountLines = {
  ...REPORT_ACCOUNT_EQUITY,
  as_of: "2025-12-31",
  from: "2025-01-01",
  currencies: [{ currency: "USD", opening_minor: 0n, movement_minor: 10_000_000n, balance_minor: 10_000_000n, count: 3 }],
  rows: REPORT_ACCOUNT_EQUITY_ALL.rows.slice(1),
};
