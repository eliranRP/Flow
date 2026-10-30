// FLOW-162: an invented company's reports, as get_pnl_statement and mcp_balance_sheet return them, for the
// report files' tests. Invented names and figures only.
import { balanceGridByPeriod, balanceGridByProject, mergeStatements, pnlGrid } from "./report_grid.ts";
import { parseBalanceSheet, parseStatement, projectKeyName, type GridPart, type ReportFile } from "./report_model.ts";

// A category's id is the same in every project's statement, as in the books.
const node = (name: string, amount: number, children: [string, number][] = []) => ({
  id: `category-${name}`,
  name,
  amount_minor: amount,
  count: 3,
  own_minor: amount - children.reduce((sum, [, value]) => sum + value, 0),
  children: children.map(([childName, value]) => ({ id: `category-${childName}`, name: childName, amount_minor: value, count: 2 })),
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

/** FLOW-991: the P&L by project, a column per project and "כללי", as export_report builds it. */
export const SAMPLE_PNL_GRID: GridPart = {
  kind: "grid",
  report: "pnl",
  by: "project",
  when: "01/01/2026–31/10/2026",
  fileWhen: "2026-01-01_2026-10-31",
  scope: "כל הפרויקטים",
  basis: "cash",
  grids: [pnlGrid("project", "USD", SAMPLE_STATEMENT.projects.map((project) => ({ label: projectKeyName(project), rows: project.currencies })), true, 2)],
};

// Two projects' balance sheets that, with the company's general accounts, add up to SAMPLE_BALANCE.
const usd = SAMPLE_BALANCE.currencies[0]!;
const projectSheet = (bank: number, property: number, loan: number) => ({
  ...usd,
  assets: { total_minor: BigInt(bank + property), accounts: [{ account_id: "a-bank", name: "Bank/Clearing", is_system: true, balance_minor: BigInt(bank) }, { account_id: "a-prop", name: "Property", is_system: true, balance_minor: BigInt(property) }] },
  liabilities: { total_minor: BigInt(loan), accounts: [{ account_id: "a-loan", name: "Loan principal", is_system: true, balance_minor: BigInt(loan) }] },
  equity: { total_minor: 0n, accounts: [] },
  retained_earnings_minor: 0n,
});
const withIds = {
  ...usd,
  assets: { ...usd.assets, accounts: usd.assets.accounts.map((account) => ({ ...account, account_id: account.name === "Bank/Clearing" ? "a-bank" : account.name === "Property" ? "a-prop" : "a-dep" })) },
  liabilities: { ...usd.liabilities, accounts: usd.liabilities.accounts.map((account) => ({ ...account, account_id: "a-loan" })) },
};
export const SAMPLE_PROJECT_SHEETS = [projectSheet(1_000_000, 30_000_000, 18_000_000), projectSheet(500_000, 28_000_000, 15_000_000)];
export const SAMPLE_COMPANY_SHEET = withIds;

/** FLOW-991: the balance sheet by project, and by quarter. */
export const SAMPLE_BALANCE_GRID: GridPart = {
  kind: "grid",
  report: "balance",
  by: "project",
  when: "נכון ל־31/10/2026",
  fileWhen: "2026-10-31",
  scope: "כל הפרויקטים",
  basis: null,
  grids: [balanceGridByProject("USD", [{ label: "Maple Ave", sheet: SAMPLE_PROJECT_SHEETS[0] }, { label: "Riverside Commons", sheet: SAMPLE_PROJECT_SHEETS[1] }], withIds, true, "31/10/2026")],
};
export const SAMPLE_QUARTER_GRID: GridPart = {
  ...SAMPLE_BALANCE_GRID,
  by: "quarter",
  grids: [balanceGridByPeriod("quarter", "USD", ["31/03/2026", "30/06/2026", "30/09/2026", "31/10/2026"].map((label) => ({ label, sheet: withIds })))],
};

export const SAMPLE_FILE: ReportFile = {
  company: "נכסי הדוגמה בע״מ",
  createdAt: "31/10/2026 09:15",
  parts: [
    { kind: "pnl", statement: SAMPLE_STATEMENT, expand: true },
    SAMPLE_PNL_GRID,
    { kind: "balance", sheet: SAMPLE_BALANCE },
  ],
};

/** The company's statement summed from its projects, to check a grid's total against. */
export const SAMPLE_PROJECTS_SUM = mergeStatements("USD", SAMPLE_STATEMENT.projects.map((project) => project.currencies[0]));
