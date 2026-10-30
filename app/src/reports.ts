import { HEBREW_MONTHS, formatDisplay, israelToday } from "./ui/date-math";
import { SYSTEM_NAMES } from "./system-accounts";

/**
 * FLOW-161: the reports screen's choices and models (board row "דוחות", page "In design · for approval").
 * The P&L reads get_pnl_statement (FLOW-160) and the balance sheet mcp_balance_sheet (FLOW-152); this
 * file only shapes what they return. Everything the screen picks lives in the URL.
 */

export type ReportKind = "pnl" | "balance";

/** The P&L's preset periods, in the sheet's order; `custom` takes from/to. */
export const PNL_PRESETS = ["month", "last_month", "quarter", "year", "last_year", "all"] as const;
export type PnlPreset = (typeof PNL_PRESETS)[number];
export type PnlPeriod = { kind: PnlPreset } | { kind: "custom"; from: string; to: string };

/** The balance sheet's preset dates; `custom` takes one date. */
export const BALANCE_PRESETS = ["today", "last_month", "last_quarter", "last_year"] as const;
export type BalancePreset = (typeof BALANCE_PRESETS)[number];
export type BalanceDate = { kind: BalancePreset } | { kind: "custom"; date: string };

/** All projects together, one statement per project, or one project. */
export type ReportScope = { kind: "all" } | { kind: "by_project" } | { kind: "project"; id: string };

export type ReportState = { kind: ReportKind; period: PnlPeriod; asOf: BalanceDate; scope: ReportScope };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isIso(value: string | null): value is string {
  if (value == null || !ISO.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d;
}

/** The screen's choices from its query string. Anything unknown falls back to the default. */
export function reportStateOf(params: URLSearchParams): ReportState {
  const kind: ReportKind = params.get("kind") === "balance" ? "balance" : "pnl";
  const periodName = params.get("period");
  const from = params.get("from");
  const to = params.get("to");
  let period: PnlPeriod = { kind: "year" };
  if (periodName === "custom" && isIso(from) && isIso(to) && from <= to) period = { kind: "custom", from, to };
  else if (PNL_PRESETS.some((preset) => preset === periodName)) period = { kind: periodName as PnlPreset };
  const asOfName = params.get("asof");
  const date = params.get("date");
  let asOf: BalanceDate = { kind: "today" };
  if (asOfName === "custom" && isIso(date)) asOf = { kind: "custom", date };
  else if (BALANCE_PRESETS.some((preset) => preset === asOfName)) asOf = { kind: asOfName as BalancePreset };
  const scopeName = params.get("scope");
  const project = params.get("project");
  let scope: ReportScope = { kind: "all" };
  // The balance sheet has no by-project view: a link that asks for one shows all projects, with that chip not pressed.
  if (scopeName === "by_project" && kind === "pnl") scope = { kind: "by_project" };
  else if (scopeName === "project" && project != null && UUID.test(project)) scope = { kind: "project", id: project };
  return { kind, period, asOf, scope };
}

/** The query string for a state: defaults are left out, so the plain route is the year's P&L of everything. */
export function reportSearch(state: ReportState): string {
  const params = new URLSearchParams();
  if (state.kind === "balance") params.set("kind", "balance");
  if (state.period.kind === "custom") {
    params.set("period", "custom");
    params.set("from", state.period.from);
    params.set("to", state.period.to);
  } else if (state.period.kind !== "year") params.set("period", state.period.kind);
  if (state.asOf.kind === "custom") {
    params.set("asof", "custom");
    params.set("date", state.asOf.date);
  } else if (state.asOf.kind !== "today") params.set("asof", state.asOf.kind);
  if (state.scope.kind === "by_project") params.set("scope", "by_project");
  if (state.scope.kind === "project") {
    params.set("scope", "project");
    params.set("project", state.scope.id);
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/**
 * FLOW-163: the route that opens one report on one scope, at its default dates (this year's P&L,
 * today's balance sheet). `search` is a preview query ("?preview=…") the link carries along.
 */
export function reportsTo(kind: ReportKind, scope: ReportScope = { kind: "all" }, search = ""): string {
  const query = reportSearch({ kind, period: { kind: "year" }, asOf: { kind: "today" }, scope });
  const extra = search.replace(/^\?/, "");
  if (extra === "") return `/reports${query}`;
  return `/reports${query === "" ? "?" : `${query}&`}${extra}`;
}

function iso(year: number, month: number, day: number): string {
  return `${String(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The last day of a month (1-12). */
function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parts(today: string): { y: number; m: number } {
  return { y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) };
}

/** A preset's dates against today (Israel). `all` has none: the read then covers every date. */
export function pnlRange(period: PnlPeriod, today: string = israelToday()): { from: string | null; to: string | null } {
  const { y, m } = parts(today);
  switch (period.kind) {
    case "custom":
      return { from: period.from, to: period.to };
    case "month":
      return { from: iso(y, m, 1), to: today };
    case "last_month": {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)) };
    }
    case "quarter": {
      const first = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: iso(y, first, 1), to: today };
    }
    case "year":
      return { from: iso(y, 1, 1), to: today };
    case "last_year":
      return { from: iso(y - 1, 1, 1), to: iso(y - 1, 12, 31) };
    case "all":
      return { from: null, to: null };
  }
}

/** The balance sheet's date. */
export function balanceDate(asOf: BalanceDate, today: string = israelToday()): string {
  const { y, m } = parts(today);
  switch (asOf.kind) {
    case "custom":
      return asOf.date;
    case "today":
      return today;
    case "last_month": {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return iso(py, pm, lastDay(py, pm));
    }
    case "last_quarter": {
      const first = Math.floor((m - 1) / 3) * 3 + 1;
      const qy = first === 1 ? y - 1 : y;
      const qm = first === 1 ? 12 : first - 1;
      return iso(qy, qm, lastDay(qy, qm));
    }
    case "last_year":
      return iso(y - 1, 12, 31);
  }
}

function monthName(month: number): string {
  return HEBREW_MONTHS[month - 1] ?? String(month);
}

/** The period chip's word for a preset, with the dates it means today on the sheet's second line. */
export function pnlPresetLabel(kind: PnlPreset, today: string = israelToday()): { label: string; dates: string } {
  const { y, m } = parts(today);
  const range = pnlRange({ kind }, today);
  const span = dateRangeText(range.from, range.to);
  switch (kind) {
    case "month":
      return { label: "החודש", dates: `${monthName(m)} ${String(y)}` };
    case "last_month": {
      const pm = m === 1 ? 12 : m - 1;
      return { label: "חודש שעבר", dates: `${monthName(pm)} ${String(m === 1 ? y - 1 : y)}` };
    }
    case "quarter":
      return { label: "הרבעון", dates: span };
    case "year":
      return { label: "השנה", dates: span };
    case "last_year":
      return { label: "שנה שעברה", dates: String(y - 1) };
    case "all":
      return { label: "מההתחלה", dates: span };
  }
}

export function balancePresetLabel(kind: BalancePreset, today: string = israelToday()): { label: string; dates: string } {
  const date = ltr(formatDisplay(balanceDate({ kind }, today)));
  switch (kind) {
    case "today":
      return { label: "היום", dates: date };
    case "last_month":
      return { label: "סוף חודש שעבר", dates: date };
    case "last_quarter":
      return { label: "סוף רבעון שעבר", dates: date };
    case "last_year":
      return { label: "סוף שנה שעברה", dates: date };
  }
}

/** The period chip's text. */
export function pnlChipLabel(period: PnlPeriod, today: string = israelToday()): string {
  if (period.kind === "custom") return dateRangeText(period.from, period.to);
  const { label } = pnlPresetLabel(period.kind, today);
  return period.kind === "year" ? `${label} · ${today.slice(0, 4)}` : label;
}

export function balanceChipLabel(asOf: BalanceDate, today: string = israelToday()): string {
  if (asOf.kind === "custom") return `נכון ל־${ltr(formatDisplay(asOf.date))}`;
  return balancePresetLabel(asOf.kind, today).label;
}

/** Days in a range, both ends counted. */
export function rangeDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

// ---- The P&L statement -------------------------------------------------------------------------

export type StatementChild = { id: string | null; name: string | null; amount_minor: bigint; count: number };
export type StatementNode = StatementChild & { own_minor: bigint; children: StatementChild[] };
export type KeptOut = {
  id: string | null;
  name: string | null;
  direction: "income" | "expense";
  amount_minor: bigint;
  count: number;
  account_name: string | null;
  account_type: string | null;
};
export type StatementCurrency = {
  currency: string;
  income_minor: bigint;
  expense_minor: bigint;
  net_minor: bigint;
  income: StatementNode[];
  expense: StatementNode[];
  kept_out: KeptOut[];
};
export type StatementProject = { key: string; project_id: string | null; name: string | null; currencies: StatementCurrency[] };
export type Statement = {
  from: string | null;
  to: string | null;
  basis: string;
  project_id: string | null;
  project_name: string | null;
  by_project: boolean;
  currencies: StatementCurrency[];
  projects: StatementProject[];
  review_count: number;
};

/** A category's name, or the words for lines with none. */
export function categoryName(name: string | null): string {
  return name ?? "בלי קטגוריה";
}

/** A by-project key's name: the overhead and the unassigned have none of their own. */
export function projectKeyName(project: Pick<StatementProject, "key" | "name">): string {
  if (project.key === "overhead") return "הוצאות כלליות";
  if (project.key === "unassigned") return "בלי פרויקט";
  return project.name ?? "פרויקט";
}

/** The net as a share of income, a whole percent; null with no income. */
export function marginPercent(row: Pick<StatementCurrency, "income_minor" | "net_minor">): number | null {
  if (row.income_minor <= 0n) return null;
  return Math.round((Number(row.net_minor) * 100) / Number(row.income_minor));
}

/** A statement with nothing in it: no counted line and nothing kept out. */
export function statementEmpty(statement: Pick<Statement, "currencies">): boolean {
  return statement.currencies.every((row) => row.income.length === 0 && row.expense.length === 0 && row.kept_out.length === 0);
}

/** The collapsible section ids of one currency's statement, for כיווץ הכל. */
export function statementSectionIds(row: StatementCurrency, prefix = ""): string[] {
  const nodes = (side: "income" | "expense") => row[side].filter((node) => node.children.length > 0).map((node) => `${prefix}${row.currency}:${side}:${node.id ?? "none"}`);
  return [`${prefix}${row.currency}:income`, `${prefix}${row.currency}:expense`, ...nodes("income"), ...nodes("expense")];
}

// ---- The balance sheet ---------------------------------------------------------------------------

export type BalanceAccount = { account_id: string; name: string; is_system: boolean; balance_minor: bigint };
export type BalanceSide = { total_minor: bigint; accounts: BalanceAccount[] };
export type BalanceWarning = { code: "suspense" | "uncategorized"; account_id: string; account_name: string; balance_minor: bigint };
export type BalanceCurrency = {
  currency: string;
  assets: BalanceSide;
  liabilities: BalanceSide;
  equity: BalanceSide;
  retained_earnings_minor: bigint;
  total_assets_minor: bigint;
  total_liabilities_and_equity_minor: bigint;
  difference_minor: bigint;
  balanced: boolean;
  warnings: BalanceWarning[];
};
export type BalanceSheet = { as_of: string; project_id: string | null; project_name: string | null; currencies: BalanceCurrency[] };

/** An account's name in Hebrew: the ledger's system accounts are stored in English. */
export function accountName(account: Pick<BalanceAccount, "name" | "is_system">): string {
  if (!account.is_system) return account.name;
  return SYSTEM_NAMES[account.name] ?? account.name;
}

/** Equity as the page leads with it: owner equity plus the running profit. */
export function equityTotal(row: Pick<BalanceCurrency, "equity" | "retained_earnings_minor">): bigint {
  return row.equity.total_minor + row.retained_earnings_minor;
}

export function balanceEmpty(sheet: Pick<BalanceSheet, "currencies">): boolean {
  return sheet.currencies.every((row) => row.assets.accounts.length === 0 && row.liabilities.accounts.length === 0 && row.equity.accounts.length === 0 && row.retained_earnings_minor === 0n);
}

/** The Suspense amount and how many accounts need a look; null when nothing does. */
export function balanceWarning(row: Pick<BalanceCurrency, "warnings">): { amount: bigint; count: number } | null {
  if (row.warnings.length === 0) return null;
  const amount = row.warnings.reduce((sum, warning) => sum + (warning.balance_minor < 0n ? -warning.balance_minor : warning.balance_minor), 0n);
  return { amount, count: row.warnings.length };
}

// ---- Collapsed sections, remembered per report ---------------------------------------------------

const STORE_KEY = "flow.reports.collapsed";

/** The sections a report had collapsed last time; none when storage is off or empty. */
export function readCollapsed(kind: ReportKind): Set<string> {
  try {
    const raw = window.localStorage.getItem(`${STORE_KEY}.${kind}`);
    if (raw == null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeCollapsed(kind: ReportKind, collapsed: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(`${STORE_KEY}.${kind}`, JSON.stringify([...collapsed].slice(0, 200)));
  } catch {
    // Storage off (a private window): the page still works, it just forgets.
  }
}

/** Text kept left to right inside a Hebrew line (an LTR isolate): a date or a date range. */
export function ltr(text: string): string {
  return `\u2066${text}\u2069`;
}

/** A date range as "05/10/2026–20/10/2026", kept left to right; "כל התאריכים" with no range. */
export function dateRangeText(from: string | null, to: string | null): string {
  return from == null || to == null ? "כל התאריכים" : ltr(`${formatDisplay(from)}–${formatDisplay(to)}`);
}
