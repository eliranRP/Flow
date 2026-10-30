// FLOW-162: the report files' input, read from get_pnl_statement (FLOW-160) and mcp_balance_sheet (FLOW-152)
// as PostgREST returns them, and the words both files use. The PDF (report_pdf.ts) and the CSV
// (report_csv.ts) take the same parts, so the two never disagree.
import { formatAmountText } from "../../../packages/shared/src/money.ts";
import type { GridBy, ReportGrid } from "./report_grid.ts";

export type StatementChild = { id: string | null; name: string | null; amount_minor: bigint; count: number };
export type StatementNode = StatementChild & { own_minor: bigint; children: StatementChild[] };
export type KeptOut = { id: string | null; name: string | null; direction: string; amount_minor: bigint; account_name: string | null };
export type StatementCurrency = {
  currency: string;
  income_minor: bigint;
  expense_minor: bigint;
  net_minor: bigint;
  income: StatementNode[];
  expense: StatementNode[];
  kept_out: KeptOut[];
};
export type Statement = {
  from: string | null;
  to: string | null;
  basis: string;
  project_name: string | null;
  currencies: StatementCurrency[];
  projects: { key: string; project_id: string | null; name: string | null; currencies: StatementCurrency[] }[];
  review_count: number;
};
export type BalanceAccount = { account_id?: string | null; name: string; is_system: boolean; balance_minor: bigint };
export type BalanceCurrency = {
  currency: string;
  assets: { total_minor: bigint; accounts: BalanceAccount[] };
  liabilities: { total_minor: bigint; accounts: BalanceAccount[] };
  equity: { total_minor: bigint; accounts: BalanceAccount[] };
  retained_earnings_minor: bigint;
  total_liabilities_and_equity_minor: bigint;
  balanced: boolean;
  warnings: { account_name: string; balance_minor: bigint }[];
};
export type BalanceSheet = { as_of: string; project_name: string | null; currencies: BalanceCurrency[] };

export type PnlPart = { kind: "pnl"; statement: Statement; expand: boolean };
export type BalancePart = { kind: "balance"; sheet: BalanceSheet };
/**
 * FLOW-991: a report with a column per project or per period, one grid per currency. `when` is the period or
 * the date as text, `scope` the projects as text, and `fileWhen` the dates for the file's name.
 */
export type GridPart = { kind: "grid"; report: "pnl" | "balance"; by: GridBy; when: string; fileWhen: string; scope: string; basis: string | null; grids: ReportGrid[] };
export type ReportPart = PnlPart | BalancePart | GridPart;
/** One file: the company, when it was made (Israel time, as text), and its reports in order. */
export type ReportFile = { company: string; createdAt: string; parts: ReportPart[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function minor(value: unknown): bigint {
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error("bad amount");
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function child(row: Record<string, unknown>): StatementChild {
  return { id: text(row.id), name: text(row.name), amount_minor: minor(row.amount_minor), count: Number(row.count ?? 0) };
}

function statementCurrency(row: Record<string, unknown>): StatementCurrency {
  const node = (item: Record<string, unknown>): StatementNode => ({ ...child(item), own_minor: minor(item.own_minor ?? 0), children: list(item.children).map(child) });
  return {
    currency: text(row.currency) ?? "ILS",
    income_minor: minor(row.income_minor),
    expense_minor: minor(row.expense_minor),
    net_minor: minor(row.net_minor),
    income: list(row.income).map(node),
    expense: list(row.expense).map(node),
    kept_out: list(row.kept_out).map((item) => ({
      id: text(item.id),
      name: text(item.name),
      direction: text(item.direction) ?? "expense",
      amount_minor: minor(item.amount_minor),
      account_name: text(item.account_name),
    })),
  };
}

/** get_pnl_statement's body; throws on a shape it doesn't know. */
export function parseStatement(body: unknown): Statement {
  if (!isObject(body) || !Array.isArray(body.currencies) || !Array.isArray(body.projects)) throw new Error("bad statement");
  return {
    from: text(body.from),
    to: text(body.to),
    basis: text(body.basis) ?? "cash",
    project_name: text(body.project_name),
    currencies: list(body.currencies).map(statementCurrency),
    projects: list(body.projects).map((project) => ({
      key: text(project.key) ?? "",
      project_id: text(project.project_id),
      name: text(project.name),
      currencies: list(project.currencies).map(statementCurrency),
    })),
    review_count: Number(body.review_count ?? 0),
  };
}

/** mcp_balance_sheet's body; throws on a shape it doesn't know. */
export function parseBalanceSheet(body: unknown): BalanceSheet {
  if (!isObject(body) || !Array.isArray(body.currencies)) throw new Error("bad balance sheet");
  const side = (value: unknown) => {
    const row = isObject(value) ? value : {};
    return {
      total_minor: minor(row.total_minor ?? 0),
      accounts: list(row.accounts).map((account) => ({ account_id: text(account.account_id), name: text(account.name) ?? "", is_system: account.is_system === true, balance_minor: minor(account.balance_minor) })),
    };
  };
  return {
    as_of: text(body.as_of) ?? "",
    project_name: text(body.project_name),
    currencies: list(body.currencies).map((row) => ({
      currency: text(row.currency) ?? "ILS",
      assets: side(row.assets),
      liabilities: side(row.liabilities),
      equity: side(row.equity),
      retained_earnings_minor: minor(row.retained_earnings_minor ?? 0),
      total_liabilities_and_equity_minor: minor(row.total_liabilities_and_equity_minor ?? 0),
      balanced: row.balanced === true,
      warnings: list(row.warnings).map((warning) => ({ account_name: text(warning.account_name) ?? "", balance_minor: minor(warning.balance_minor) })),
    })),
  };
}

// The ledger's system accounts are stored in English; the app shows them in Hebrew (app/src/line-journal.ts,
// app/src/reports.ts). The files use the same words.
const SYSTEM_NAMES: Record<string, string> = {
  "Bank/Clearing": "בנק",
  "Loan principal": "קרן הלוואה",
  Escrow: "פיקדון מסים וביטוח",
  Property: "נכסים",
  "Accumulated depreciation": "פחת שנצבר",
  "Transfers in transit": "העברות בין חשבונות",
  "Owner capital": "השקעת בעלים",
  "Security deposit held": "פיקדון שהתקבל",
  Suspense: "חשבון מעבר",
  "VAT control": "מע״מ",
  "Uncategorized income": "הכנסה בלי קטגוריה",
  "Uncategorized expense": "הוצאה בלי קטגוריה",
};

export function accountName(account: { name: string; is_system: boolean }): string {
  return account.is_system ? (SYSTEM_NAMES[account.name] ?? account.name) : account.name;
}

export function systemAccountName(name: string): string {
  return SYSTEM_NAMES[name] ?? name;
}

export function categoryName(name: string | null): string {
  return name ?? "בלי קטגוריה";
}

export function projectKeyName(project: { key: string; name: string | null }): string {
  if (project.key === "overhead") return "הוצאות כלליות";
  if (project.key === "unassigned") return "בלי פרויקט";
  return project.name ?? "פרויקט";
}

/** An amount as the app writes it: $ or ₪ before the digits, a minus on money out, whole units. */
export function money(value: bigint, currency: string): string {
  return formatAmountText(value, currency);
}

/** dd/mm/yyyy of an ISO date. */
export function displayDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

export function periodLabel(statement: Pick<Statement, "from" | "to">): string {
  return statement.from == null || statement.to == null ? "כל התאריכים" : `${displayDate(statement.from)}–${displayDate(statement.to)}`;
}

export function basisLabel(basis: string): string {
  return basis === "cash" ? "בסיס מזומן" : "בסיס חשבוניות";
}

/** The net as a whole percent of income; null with no income. */
export function marginPercent(row: Pick<StatementCurrency, "income_minor" | "net_minor">): number | null {
  if (row.income_minor <= 0n) return null;
  return Math.round((Number(row.net_minor) * 100) / Number(row.income_minor));
}

/** The file's name: the report, the period or date, and the projects, as words the phone shows. */
export function reportFileName(file: ReportFile, extension: "pdf" | "csv" | "xlsx"): string {
  const first = file.parts[0];
  const isBalance = first?.kind === "balance" || (first?.kind === "grid" && first.report === "balance");
  const kind = file.parts.length > 1 ? "דוחות" : isBalance ? "מאזן" : "רווח-והפסד";
  let when = "";
  let scope = "כל-הפרויקטים";
  if (first?.kind === "pnl") {
    when = first.statement.from == null ? "מההתחלה" : `${first.statement.from}_${first.statement.to ?? ""}`;
    if (first.statement.project_name != null) scope = first.statement.project_name;
  } else if (first?.kind === "grid") {
    when = first.fileWhen;
    scope = first.by === "project" ? `לפי-פרויקט${first.scope === "כל הפרויקטים" ? "" : `_${first.scope}`}` : first.scope;
  } else if (first?.kind === "balance") {
    when = first.sheet.as_of;
    if (first.sheet.project_name != null) scope = first.sheet.project_name;
  }
  // No control or format characters, and a scope of at most 60 characters, so the name stays under the
  // 255-byte limit phones and disks set on a file name.
  const safe = (value: string) => value.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/[\\/:*?"<>|\s]+/g, "-");
  const short = (value: string) => [...value].slice(0, 60).join("");
  return `${[kind, when, short(scope)].filter((part) => part !== "").map(safe).join("_")}.${extension}`;
}
