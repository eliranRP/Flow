import type { BalanceSheet, Statement, StatementCurrency, StatementProject } from "../reports";

/**
 * FLOW-161: the reports' fixtures, the board's numbers (row "דוחות"). Invented names and round amounts, in
 * cents. Net profit $29,000 on $96,000; equity $285,000 on assets $814,500.
 */

const P = {
  cedar: "a0000000-0000-4000-8000-000000000161",
  maple: "a0000000-0000-4000-8000-000000000162",
  oak: "a0000000-0000-4000-8000-000000000163",
  long: "a0000000-0000-4000-8000-000000000164",
};

function cat(id: string, name: string, dollars: number, count: number, children: Array<[string, string, number, number]> = [], own?: number) {
  const kids = children.map(([cid, cname, cdollars, ccount]) => ({ id: cid, name: cname, amount_minor: BigInt(cdollars * 100), count: ccount }));
  return { id, name, amount_minor: BigInt(dollars * 100), count, own_minor: BigInt((own ?? (kids.length === 0 ? dollars : 0)) * 100), children: kids };
}

export const REPORTS_STATEMENT_ROW: StatementCurrency = {
  currency: "USD",
  income_minor: 9_600_000n,
  expense_minor: 6_700_000n,
  net_minor: 2_900_000n,
  income: [cat("c-rent", "שכירות", 96_000, 48)],
  expense: [
    cat("c-props", "הוצאות הנכסים", 47_200, 61, [
      ["c-mortgage", "ריבית משכנתא", 18_900, 10],
      ["c-repairs", "תיקונים ותחזוקה", 12_400, 14],
      ["c-tax", "מס רכוש", 8_200, 4],
      ["c-insurance", "ביטוח", 4_600, 4],
      ["c-utilities", "חשמל ומים", 3_100, 29],
    ]),
    cat("c-depreciation", "פחת", 14_000, 10),
    cat("c-general", "הוצאות כלליות", 5_800, 22, [
      ["c-books", "הנהלת חשבונות", 2_400, 10],
      ["c-legal", "ייעוץ משפטי", 1_800, 2],
      ["c-software", "תוכנה", 1_200, 9],
      ["c-bank", "עמלות בנק", 400, 1],
    ]),
  ],
  kept_out: [
    { id: "k-principal", name: "קרן הלוואה", direction: "expense", amount_minor: 1_500_000n, count: 10, account_name: "Loan principal", account_type: "liability" },
    { id: "k-escrow", name: "פיקדון מסים וביטוח", direction: "expense", amount_minor: 150_000n, count: 10, account_name: "Escrow", account_type: "asset" },
  ],
};

function projectRow(income: number, expense: number): StatementCurrency {
  return { currency: "USD", income_minor: BigInt(income * 100), expense_minor: BigInt(expense * 100), net_minor: BigInt((income - expense) * 100), income: [], expense: [], kept_out: [] };
}

export const REPORTS_PROJECTS: StatementProject[] = [
  { key: P.cedar, project_id: P.cedar, name: "Cedar St", currencies: [projectRow(30_000, 18_800)] },
  { key: P.maple, project_id: P.maple, name: "Maple Ave", currencies: [projectRow(26_000, 17_400)] },
  { key: P.oak, project_id: P.oak, name: "Oak Ridge", currencies: [projectRow(24_000, 17_100)] },
  { key: P.long, project_id: P.long, name: "Riverside Commons Phase Two Townhomes", currencies: [projectRow(16_000, 13_700)] },
];

export const REPORTS_STATEMENT: Statement = {
  from: "2026-01-01",
  to: "2026-10-31",
  basis: "cash",
  project_id: null,
  project_name: null,
  by_project: false,
  currencies: [REPORTS_STATEMENT_ROW],
  projects: [],
  review_count: 2,
};

export const REPORTS_BY_PROJECT: Statement = { ...REPORTS_STATEMENT, by_project: true, projects: REPORTS_PROJECTS };

export const REPORTS_EMPTY: Statement = { ...REPORTS_STATEMENT, currencies: [], review_count: 0 };

const account = (id: string, name: string, dollars: number, system = true) => ({ account_id: id, name, is_system: system, balance_minor: BigInt(dollars * 100) });

export const REPORTS_BALANCE: BalanceSheet = {
  as_of: "2026-10-31",
  project_id: null,
  project_name: null,
  currencies: [{
    currency: "USD",
    assets: { total_minor: 81_450_000n, accounts: [account("a-bank", "Bank/Clearing", 42_000), account("a-escrow", "Escrow", 6_500), account("a-prop", "Property", 780_000), account("a-dep", "Accumulated depreciation", -14_000)] },
    liabilities: { total_minor: 52_950_000n, accounts: [account("l-loan", "Loan principal", 520_000), account("l-dep", "Security deposit held", 9_500)] },
    equity: { total_minor: 25_600_000n, accounts: [account("e-owner", "Owner capital", 256_000)] },
    retained_earnings_minor: 2_900_000n,
    total_assets_minor: 81_450_000n,
    total_liabilities_and_equity_minor: 81_450_000n,
    difference_minor: 0n,
    balanced: true,
    warnings: [],
  }],
};

/** The same sheet with $1,250 sitting in Suspense: it still balances, and it says so. */
export const REPORTS_BALANCE_SUSPENSE: BalanceSheet = {
  ...REPORTS_BALANCE,
  currencies: REPORTS_BALANCE.currencies.map((row) => ({
    ...row,
    assets: { total_minor: row.assets.total_minor + 125_000n, accounts: [...row.assets.accounts, account("a-susp", "Suspense", 1_250)] },
    retained_earnings_minor: row.retained_earnings_minor + 125_000n,
    total_assets_minor: row.total_assets_minor + 125_000n,
    total_liabilities_and_equity_minor: row.total_liabilities_and_equity_minor + 125_000n,
    warnings: [{ code: "suspense", account_id: "a-susp", account_name: "Suspense", balance_minor: 125_000n }],
  })),
};

export const REPORTS_TODAY = "2026-10-31";
export const REPORTS_PROJECT_IDS = P;
