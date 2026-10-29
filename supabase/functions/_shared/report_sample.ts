// FLOW-162: an invented company's reports, as get_pnl_statement and mcp_balance_sheet return them, for the
// report files' tests. Invented names and figures only.
import { parseBalanceSheet, parseStatement, type ReportFile } from "./report_model.ts";

const node = (name: string, amount: number, children: [string, number][] = []) => ({
  id: crypto.randomUUID(),
  name,
  amount_minor: amount,
  count: 3,
  own_minor: amount - children.reduce((sum, [, value]) => sum + value, 0),
  children: children.map(([childName, value]) => ({ id: crypto.randomUUID(), name: childName, amount_minor: value, count: 2 })),
});

const currency = (income: number, expense: number) => ({
  currency: "USD",
  income_minor: income,
  expense_minor: expense,
  net_minor: income - expense,
  income: [node("שכירות", income - 400_000, [["Maple Ave", 5_200_000], ["Cedar St", income - 5_600_000]]), node("החזרי הוצאות", 400_000)],
  expense: [
    node("הוצאות הנכסים", expense - 1_890_000, [["תיקונים", 1_250_000], ["ביטוח", 900_000]]),
    node("ריבית משכנתא", 1_890_000),
  ],
  kept_out: [{ id: null, name: "קרן הלוואה", direction: "expense", amount_minor: 1_200_000, count: 4, account_name: "Loan principal", account_type: "liability" }],
});

/** get_pnl_statement's body, as PostgREST sends it. */
export const SAMPLE_STATEMENT_BODY = {
  from: "2026-01-01",
  to: "2026-10-31",
  basis: "cash",
  project_id: null,
  project_name: null,
  by_project: true,
  currencies: [currency(9_620_000, 6_720_000)],
  projects: [
    { key: "p1", project_id: crypto.randomUUID(), name: "Maple Ave", currencies: [currency(5_200_000, 3_100_000)] },
    { key: "p2", project_id: crypto.randomUUID(), name: "Riverside Commons Phase Two Townhomes", currencies: [currency(4_420_000, 3_000_000)] },
    { key: "overhead", project_id: null, name: null, currencies: [currency(0, 620_000)] },
  ],
  review_count: 2,
};
export const SAMPLE_STATEMENT = parseStatement(SAMPLE_STATEMENT_BODY);

/** mcp_balance_sheet's body. */
export const SAMPLE_BALANCE_BODY = {
  as_of: "2026-10-31",
  project_name: null,
  currencies: [{
    currency: "USD",
    assets: { total_minor: 61_500_000, accounts: [{ name: "Bank/Clearing", is_system: true, balance_minor: 4_500_000 }, { name: "Property", is_system: true, balance_minor: 58_000_000 }, { name: "Accumulated depreciation", is_system: true, balance_minor: -1_000_000 }] },
    liabilities: { total_minor: 33_000_000, accounts: [{ name: "Loan principal", is_system: true, balance_minor: 33_000_000 }] },
    equity: { total_minor: 25_600_000, accounts: [{ name: "Owner capital", is_system: true, balance_minor: 25_600_000 }] },
    retained_earnings_minor: 2_900_000,
    total_liabilities_and_equity_minor: 61_500_000,
    balanced: true,
    warnings: [],
  }],
};
export const SAMPLE_BALANCE = parseBalanceSheet(SAMPLE_BALANCE_BODY);

export const SAMPLE_FILE: ReportFile = {
  company: "נכסי הדוגמה בע״מ",
  createdAt: "31/10/2026 09:15",
  parts: [
    { kind: "pnl", statement: SAMPLE_STATEMENT, byProject: false, expand: true },
    { kind: "pnl", statement: SAMPLE_STATEMENT, byProject: true, expand: false },
    { kind: "balance", sheet: SAMPLE_BALANCE },
  ],
};
