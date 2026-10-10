// Shared ids, fixtures and the fake RPC for the Flow MCP tools tests (split out of tools_test.ts, FLOW-807).

export const LOAN = "dddddddd-dddd-4000-8000-0000000000d1";
export const LOAN_TXN = "eeeeeeee-eeee-4000-8000-0000000000e1";
export const TXN = "22222222-2222-4000-8000-000000000020";
export const PROJECT = "8c1a0b2e-1111-4000-8000-000000000001";
export const CATEGORY = "c0ffee00-1111-4000-8000-0000000000a1";
export const INCOME_CATEGORY = "d1ffee00-1111-4000-8000-0000000000b2";
export const REVIEW = "11111111-1111-4000-8000-000000000010";
export const INCOME_TXN = "33333333-3333-4000-8000-000000000030";
export const PROJECT_B = "8c1a0b2e-1111-4000-8000-000000000002";

export type Rpc = { name: string; body: Record<string, unknown> };

/**
 * The fake RPC. company_pnl_basis (FLOW-103: the company's date choice, read when a P&L tool gets
 * no basis) answers `basis` and is counted in basisCalls, not calls, so calls stays the tool's own reads.
 */
export function rpcOf(
  handler: (name: string, body: Record<string, unknown>) => { status: number; json: unknown },
  { basis = "invoiced" }: { basis?: unknown } = {},
) {
  const calls: Rpc[] = [];
  const basisCalls: Rpc[] = [];
  const rpc = (name: string, body: Record<string, unknown>) => {
    if (name === "company_pnl_basis") {
      basisCalls.push({ name, body });
      return Promise.resolve({ status: 200, json: basis });
    }
    calls.push({ name, body });
    return Promise.resolve(handler(name, body));
  };
  return { calls, basisCalls, rpc };
}
export const CATEGORY_NEW = "bbbbbbbb-bbbb-4000-8000-0000000000b1";

export const JOB = "abababab-abab-4000-8000-0000000000ab";

export const BATCH_KEY = "33333333-3333-4000-8000-000000000003";

export const PROJECT_FIXTURE = {
  id: PROJECT,
  name: "Example Site",
  status: "active",
  state_label: null,
  budget_agorot: null,
  sumit_budget_section_id: null,
  after_overhead: false,
  income_agorot: 0,
  direct_agorot: 0,
  shared_agorot: 0,
  by_currency: [{ currency: "USD", income_minor: 250000, direct_minor: 1250, shared_minor: 0, profit_minor: 248750 }],
  categories: [],
  categories_by_currency: [
    { currency: "USD", id: CATEGORY, name: "Example Supplies", amount_minor: 1250, has_shared_share: false },
    { currency: "USD", id: null, name: null, amount_minor: 0, has_shared_share: null },
  ],
  excluded_categories_by_currency: [
    { currency: "USD", id: CATEGORY_NEW, name: "Example Loan Principal", amount_minor: 50000, has_shared_share: false },
  ],
  excluded_income_by_currency: [
    { currency: "USD", id: CATEGORY, name: "Example Owner Money", amount_minor: 3000, count: 1 },
  ],
  other_currencies: [{ currency: "USD", income_minor: 250000, expense_minor: -1250, count: 2 }],
  pending_count: 0,
  pending_agorot: 0,
  pending_other_currencies: [],
  transactions: [
    {
      id: INCOME_TXN,
      description: "Example deposit",
      doc_date: "2026-09-02",
      amount_net: 250000,
      currency: "USD",
      direction: "income",
      source: "mercury",
      doc_kind: "invoice_receipt",
      category: null,
    },
    {
      id: TXN,
      description: null,
      doc_date: "2026-09-01",
      amount_net: -1250,
      currency: "USD",
      direction: "expense",
      source: "manual",
      doc_kind: "expense",
      category: "Example Supplies",
    },
  ],
  profit_agorot: 0,
  overhead_share_agorot: null,
  overhead_weighted: false,
  profit_after_overhead_agorot: 0,
};

/** A payment already on the loan, as mcp_loan_payments lists it. */
export function paidRow(transactionId: string, row: { interestMinor: bigint; principalMinor: bigint; escrowMinor?: bigint }, extra: Record<string, unknown> = {}) {
  return {
    transaction_id: transactionId,
    doc_date: "2026-01-01",
    line_status: "posted",
    needs_review: false,
    interest_minor: Number(row.interestMinor),
    escrow_minor: Number(row.escrowMinor ?? 0n),
    principal_minor: Number(row.principalMinor),
    fees_minor: 0,
    ...extra,
  };
}

export function feesRpc(
  loan: Record<string, unknown>,
  lineMinor: number,
  docDate = "2026-01-01",
  split: unknown = null,
  payments: unknown[] = [],
) {
  return rpcOf((name) => {
    if (name === "get_loan_split") return { status: 200, json: split };
    if (name === "mcp_loan_payments") return { status: 200, json: payments };
    if (name === "get_transaction") {
      return { status: 200, json: { id: LOAN_TXN, doc_date: docDate, amount_original: lineMinor, currency: "USD" } };
    }
    if (name === "mcp_list_loans") return { status: 200, json: [loan] };
    if (name === "mcp_attach_loan_payment") {
      return { status: 200, json: { ok: true, data: { loan_id: LOAN, transaction_id: LOAN_TXN, undo_kind: "loan_split" } } };
    }
    return { status: 500, json: null };
  });
}

export const DEMAND_LOAN = {
  id: LOAN,
  name: "Example Partner",
  currency: "USD",
  principal_minor: 5_000_000,
  // 7.3%: 10.00 a day on 50,000.00.
  annual_rate_ppm: 73_000,
  term_months: null,
  start_date: "2026-01-01",
  payment_minor: null,
  escrow_minor: 0,
  balance_minor: 5_000_000,
  kind: "demand",
  rates: [],
};
