import type { ProfitMonths } from "@flow/shared";
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

function projectRow(income: number, expense: number, incomeRows: ReturnType<typeof cat>[] = [], expenseRows: ReturnType<typeof cat>[] = []): StatementCurrency {
  return { currency: "USD", income_minor: BigInt(income * 100), expense_minor: BigInt(expense * 100), net_minor: BigInt((income - expense) * 100), income: incomeRows, expense: expenseRows, kept_out: [] };
}

/** FLOW-1045: Cedar St's own statement, its categories adding up to its row: $30,000 less $17,000. */
export const REPORTS_CEDAR_ROW = projectRow(30_000, 17_000, [cat("c-rent", "שכירות", 30_000, 12)], [
  cat("c-mortgage", "ריבית משכנתא", 9_000, 10),
  cat("c-repairs", "תיקונים ותחזוקה", 6_000, 5),
  cat("c-tax", "מס רכוש", 2_000, 2),
]);

/**
 * The by-project statement: four projects ($34,800 between them) and the general expenses that belong to none
 * ($5,800), adding up to the $29,000 of the whole.
 */
export const REPORTS_PROJECTS: StatementProject[] = [
  { key: P.cedar, project_id: P.cedar, name: "Cedar St", currencies: [REPORTS_CEDAR_ROW] },
  { key: P.maple, project_id: P.maple, name: "Maple Ave", currencies: [projectRow(26_000, 16_000)] },
  { key: P.oak, project_id: P.oak, name: "Oak Ridge", currencies: [projectRow(24_000, 15_800)] },
  { key: P.long, project_id: P.long, name: "Riverside Commons Phase Two Townhomes", currencies: [projectRow(16_000, 12_400)] },
  {
    key: "overhead",
    project_id: null,
    name: null,
    currencies: [projectRow(0, 5_800, [], [cat("c-books", "הנהלת חשבונות", 2_400, 10), cat("c-legal", "ייעוץ משפטי", 1_800, 2), cat("c-software", "תוכנה", 1_200, 9), cat("c-bank", "עמלות בנק", 400, 1)])],
  },
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

/** FLOW-1045: Cedar St's own P&L (get_pnl_statement with its id), the drill-down of its by-project row. */
export const REPORTS_CEDAR: Statement = { ...REPORTS_STATEMENT, project_id: P.cedar, project_name: "Cedar St", currencies: [REPORTS_CEDAR_ROW], review_count: 0 };

/** The months' expenses, January to October: $67,000 in all, on $9,600 of rent each month. */
const MONTH_COSTS = [7_000, 6_500, 7_200, 6_800, 6_400, 7_100, 6_600, 6_900, 6_700, 5_800];

/** get_profit_months for the year to date, newest first: ten months adding up to the $29,000 net. */
export const REPORTS_MONTHS: NonNullable<ProfitMonths> = {
  basis: "cash",
  from: "2026-01-01",
  to: "2026-10-31",
  months: MONTH_COSTS.map((cost, index) => {
    const month = `2026-${String(index + 1).padStart(2, "0")}`;
    const last = new Date(Date.UTC(2026, index + 1, 0)).getUTCDate();
    return { month, from: `${month}-01`, to: `${month}-${String(last)}`, open: index === 9, by_currency: [{ currency: "USD", income_minor: 960_000n, expense_minor: BigInt(cost * 100), profit_minor: BigInt((9_600 - cost) * 100) }] };
  }).reverse(),
  by_currency: [{ currency: "USD", income_minor: 9_600_000n, expense_minor: 6_700_000n, profit_minor: 2_900_000n }],
};

/** October's own P&L (get_pnl_statement for its dates): $9,600 less $5,800, as its month row says. */
export const REPORTS_OCTOBER: Statement = {
  ...REPORTS_STATEMENT,
  from: "2026-10-01",
  to: "2026-10-31",
  currencies: [projectRow(9_600, 5_800, [cat("c-rent", "שכירות", 9_600, 4)], [
    cat("c-mortgage", "ריבית משכנתא", 1_890, 1),
    cat("c-repairs", "תיקונים ותחזוקה", 1_240, 2),
    cat("c-tax", "מס רכוש", 820, 1),
    cat("c-insurance", "ביטוח", 460, 1),
    cat("c-general", "הוצאות כלליות", 1_390, 3),
  ])],
  review_count: 0,
};

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

/** One property's sheet: its value (less depreciation) and its loan; what is left is its equity. */
function projectSheet(id: string, name: string, assets: Array<[string, string, number]>, loans: Array<[string, string, number]>): BalanceSheet {
  const assetRows = assets.map(([aid, aname, dollars]) => account(aid, aname, dollars, false));
  const loanRows = loans.map(([lid, lname, dollars]) => account(lid, lname, dollars, false));
  const total = assetRows.reduce((sum, row) => sum + row.balance_minor, 0n);
  const owed = loanRows.reduce((sum, row) => sum + row.balance_minor, 0n);
  return {
    as_of: "2026-10-31",
    project_id: id,
    project_name: name,
    currencies: [{
      currency: "USD",
      assets: { total_minor: total, accounts: assetRows },
      liabilities: { total_minor: owed, accounts: loanRows },
      equity: { total_minor: 0n, accounts: [] },
      retained_earnings_minor: total - owed,
      total_assets_minor: total,
      total_liabilities_and_equity_minor: total,
      difference_minor: 0n,
      balanced: true,
      warnings: [],
    }],
  };
}

/**
 * FLOW-1045: mcp_balance_sheet per project. Three properties hold $246,000 of the $285,000 equity; the rest
 * ($39,000, the bank less what is owed outside them) is the "בנק ושאר" row. Riverside has no account yet.
 */
export const REPORTS_PROJECT_SHEETS: BalanceSheet[] = [
  projectSheet(P.cedar, "Cedar St", [["p-cedar", "Cedar St · שווי", 215_000]], [["l-cedar", "משכנתא · Cedar", 128_400]]),
  projectSheet(P.maple, "Maple Ave", [["p-maple", "Maple Ave · שווי", 310_000]], [["l-maple", "הלוואת גישור · Maple", 246_300]]),
  projectSheet(P.oak, "Oak Ridge", [["p-oak", "Oak Ridge · שווי", 255_000], ["d-oak", "פחת שנצבר", -14_000]], [["l-oak", "הלוואה · Oak", 145_300]]),
  projectSheet(P.long, "Riverside Commons Phase Two Townhomes", [], []),
];

export const REPORTS_TODAY = "2026-10-31";
export const REPORTS_PROJECT_IDS = P;
