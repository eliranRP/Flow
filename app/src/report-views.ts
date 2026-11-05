import type { ProfitMonths } from "@flow/shared";
import {
  asOfOf,
  byCategoryNumber,
  categoryName,
  equityTotal,
  periodOf,
  projectKeyName,
  reportStateOf,
  writeAsOf,
  writePeriod,
  type BalanceCurrency,
  type BalanceDate,
  type BalanceSheet,
  type PnlPeriod,
  type ReportState,
  type Statement,
  type StatementCurrency,
} from "./reports";
import { HEBREW_MONTHS } from "./ui/date-math";

/**
 * FLOW-1045 (Reports v3, boards V3-Reports and V3-Report): the two reports' routes and the views they break
 * into. There are only two reports, profit and loss and the balance sheet; every other view is a breakdown of
 * one of them. `/reports` is the hub, `/reports/pnl?view=category|project|month[&project=<id>|&month=YYYY-MM]`
 * and `/reports/balance?view=assets|liabilities|project[&project=<id>]` the reports (BUILD-PLAN §5).
 */

export const PNL_VIEWS = ["category", "project", "month"] as const;
export type PnlView = (typeof PNL_VIEWS)[number];
export const BALANCE_VIEWS = ["assets", "liabilities", "project"] as const;
export type BalanceView = (typeof BALANCE_VIEWS)[number];

/** A drilled row of the by-project view: a project's id, or the general expenses that belong to no project. */
export type PnlDrill = { kind: "project"; key: string } | { kind: "month"; month: string } | null;

export type PnlRoute = { period: PnlPeriod; view: PnlView; drill: PnlDrill };
export type BalanceRoute = { asOf: BalanceDate; view: BalanceView; project: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** The two keys of the by-project statement that are not a project (get_pnl_statement's `projects`). */
const GENERAL_KEYS = new Set(["overhead", "unassigned"]);

/** A project id (or the general key) from a query string, or null. */
function projectKeyOf(value: string | null, general: boolean): string | null {
  if (value == null) return null;
  if (UUID.test(value)) return value;
  return general && GENERAL_KEYS.has(value) ? value : null;
}

export function pnlRouteOf(params: URLSearchParams): PnlRoute {
  const period = periodOf(params);
  const key = projectKeyOf(params.get("project"), true);
  const month = params.get("month");
  if (key != null) return { period, view: "project", drill: { kind: "project", key } };
  if (month != null && MONTH.test(month)) return { period, view: "month", drill: { kind: "month", month } };
  const view = PNL_VIEWS.find((item) => item === params.get("view")) ?? "category";
  return { period, view, drill: null };
}

export function balanceRouteOf(params: URLSearchParams): BalanceRoute {
  const asOf = asOfOf(params);
  const project = projectKeyOf(params.get("project"), false);
  if (project != null) return { asOf, view: "project", project };
  const view = BALANCE_VIEWS.find((item) => item === params.get("view")) ?? "assets";
  return { asOf, view, project: null };
}

/** `extra` is a preview query ("?preview=…") a link carries along. */
function withExtra(path: string, params: URLSearchParams, extra: string): string {
  const more = new URLSearchParams(extra.replace(/^\?/, ""));
  for (const [key, value] of more) if (!params.has(key)) params.set(key, value);
  const text = params.toString();
  return text === "" ? path : `${path}?${text}`;
}

export function pnlPath(route: PnlRoute, extra = ""): string {
  const params = new URLSearchParams();
  params.set("view", route.view);
  writePeriod(params, route.period);
  if (route.drill?.kind === "project") params.set("project", route.drill.key);
  if (route.drill?.kind === "month") params.set("month", route.drill.month);
  return withExtra("/reports/pnl", params, extra);
}

export function balancePath(route: BalanceRoute, extra = ""): string {
  const params = new URLSearchParams();
  params.set("view", route.view);
  writeAsOf(params, route.asOf);
  if (route.project != null) params.set("project", route.project);
  return withExtra("/reports/balance", params, extra);
}

/** The keys only a link from before v3 carries (`/reports?kind=balance`, the project band's `?scope=project&project=`). */
const LEGACY_KEYS = ["kind", "scope", "project"];
/** The keys the report's state is written in; the rest of a query (a preview) is carried along. */
const STATE_KEYS = [...LEGACY_KEYS, "period", "from", "to", "asof", "date"];

/**
 * Where an old `/reports?…` link lands now, with its state: the P&L or the balance sheet, by project, or one
 * project drilled. Null: the hub, which keeps its own period (`/reports?period=…`, an old P&L link's period).
 */
export function legacyReportsTarget(params: URLSearchParams): string | null {
  if (!LEGACY_KEYS.some((key) => params.has(key))) return null;
  const state = reportStateOf(params);
  const extra = new URLSearchParams();
  for (const [key, value] of params) if (!STATE_KEYS.includes(key)) extra.set(key, value);
  const rest = extra.toString();
  if (state.kind === "balance") {
    const project = state.scope.kind === "project" ? state.scope.id : null;
    return balancePath({ asOf: state.asOf, view: project != null ? "project" : "assets", project }, rest);
  }
  if (state.scope.kind === "project") return pnlPath({ period: state.period, view: "project", drill: { kind: "project", key: state.scope.id } }, rest);
  return pnlPath({ period: state.period, view: state.scope.kind === "by_project" ? "project" : "category", drill: null }, rest);
}

/** The one project a lines or account page reads, from its query string (`project`, a uuid). */
export function reportProjectId(params: URLSearchParams): string | null {
  return projectKeyOf(params.get("project"), false);
}

/**
 * Back from a lines or account page to the report it came from, with the report's own choices: the page's own
 * keys go. A project the lines page added itself (its split by project, `scope=project`) goes too.
 */
export function reportBackPath(report: "pnl" | "balance", search: string, own: readonly string[]): string {
  const params = new URLSearchParams(search.replace(/^\?/, ""));
  if (params.get("scope") === "project") params.delete("project");
  for (const key of [...own, "scope", "kind"]) params.delete(key);
  const text = params.toString();
  return `/reports/${report}${text === "" ? "" : `?${text}`}`;
}

/** The share sheet's state (report-share.ts reads the pre-v3 shape): the report, its dates and its project. */
export function shareStateOf(kind: ReportState["kind"], period: PnlPeriod, asOf: BalanceDate, project: string | null, byProject: boolean): ReportState {
  const scope: ReportState["scope"] = project != null && UUID.test(project) ? { kind: "project", id: project } : byProject && kind === "pnl" ? { kind: "by_project" } : { kind: "all" };
  return { kind, period, asOf, scope };
}

// ---- P&L views -----------------------------------------------------------------------------------

/** One row of a report's list: a name, an amount, and the line under it. */
export type ViewRow = {
  key: string;
  name: string;
  amount: bigint;
  /** Income shows its plus in green; a net shows its sign; a cost in a cost group shows none. */
  tone: "income" | "cost" | "net";
  hint?: string;
  /** A category row: the side and the node, for its lines. */
  category?: { side: "income" | "expense"; id: string | null; name: string | null };
};
export type ViewGroup = { key: string; title: string; total: bigint; tone: ViewRow["tone"]; rows: ViewRow[] };

function categoryRows(row: StatementCurrency, side: "income" | "expense", nodes: StatementCurrency["income"]): ViewRow[] {
  return nodes.flatMap((node) => {
    const leaf = (item: { id: string | null; name: string | null; amount_minor: bigint }, hint?: string): ViewRow => ({
      key: `${side}:${item.id ?? "none"}`,
      name: categoryName(item.name),
      amount: item.amount_minor,
      tone: side === "income" ? "income" : "cost",
      ...(hint == null ? {} : { hint }),
      category: { side, id: item.id, name: item.name },
    });
    if (node.children.length === 0) return [leaf(node)];
    const own = node.own_minor !== 0n ? [{ ...leaf({ ...node, amount_minor: node.own_minor }, "ישירות בקטגוריה"), key: `${side}:${node.id ?? "none"}:own` }] : [];
    return [...own, ...byCategoryNumber(node.children).map((child) => leaf(child))];
  });
}

/**
 * One currency's statement as the category view lists it: the income in one group, then the expenses, each
 * parent category its own group (its children the rows) and the categories with none in one group first.
 * A drill-down lists its own statement the same way, so its groups add up to its band.
 */
export function statementGroups(row: StatementCurrency): ViewGroup[] {
  const groups: ViewGroup[] = [];
  if (row.income.length > 0) groups.push({ key: "income", title: "הכנסות", total: row.income_minor, tone: "income", rows: categoryRows(row, "income", byCategoryNumber(row.income)) });
  const expense = byCategoryNumber(row.expense);
  const leaves = expense.filter((node) => node.children.length === 0);
  const parents = expense.filter((node) => node.children.length > 0);
  if (leaves.length > 0) {
    const total = leaves.reduce((sum, node) => sum + node.amount_minor, 0n);
    groups.push({ key: "expense", title: parents.length > 0 ? "הוצאות אחרות" : "הוצאות", total, tone: "cost", rows: categoryRows(row, "expense", leaves) });
  }
  for (const node of parents) {
    groups.push({ key: `expense:${node.id ?? "none"}`, title: categoryName(node.name), total: node.amount_minor, tone: "cost", rows: categoryRows(row, "expense", [node]) });
  }
  return groups;
}

/** The groups' net: income less costs. A drill-down's groups add up to the row tapped (a test). */
export function groupsNet(groups: readonly ViewGroup[]): bigint {
  return groups.reduce((sum, group) => sum + (group.tone === "income" ? group.total : group.tone === "cost" ? -group.total : group.total), 0n);
}

/** A by-project or by-month row: its net, and income and expenses under it. */
export type NetRow = { key: string; name: string; income: bigint; expense: bigint; net: bigint };

function currencyOf<T extends { currency: string }>(rows: readonly T[], currency: string): T | undefined {
  return rows.find((row) => row.currency === currency);
}

/**
 * The by-project view: one row per project, largest net first, and the general expenses that belong to no
 * project in their own group, so the two groups add up to the band's net.
 */
export function pnlProjectGroups(statement: Pick<Statement, "projects">, currency: string): { projects: NetRow[]; general: NetRow[] } {
  const rows = statement.projects.flatMap((project) => {
    const row = currencyOf(project.currencies, currency);
    if (row == null) return [];
    return [{ key: project.key, name: projectKeyName(project), income: row.income_minor, expense: row.expense_minor, net: row.net_minor }];
  });
  return {
    projects: rows.filter((row) => !GENERAL_KEYS.has(row.key)).sort((a, b) => (a.net === b.net ? 0 : a.net > b.net ? -1 : 1)),
    general: rows.filter((row) => GENERAL_KEYS.has(row.key)),
  };
}

export function netTotal(rows: readonly NetRow[]): bigint {
  return rows.reduce((sum, row) => sum + row.net, 0n);
}

/** A month's name and year: "אוקטובר 2026". */
export function monthTitleOf(month: string): string {
  return `${HEBREW_MONTHS[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`;
}

/** The by-month view: get_profit_months's months in the currency, newest first. */
export function pnlMonthRows(months: NonNullable<ProfitMonths>, currency: string): NetRow[] {
  return months.months.flatMap((month) => {
    const row = currencyOf(month.by_currency, currency);
    if (row == null) return [];
    return [{ key: month.month, name: monthTitleOf(month.month), income: row.income_minor, expense: row.expense_minor, net: row.profit_minor }];
  }).sort((a, b) => (a.key < b.key ? 1 : -1));
}

/** A month's dates for its statement: the first to the last day, or to today in the current month. */
export function monthRange(month: string, today: string): { from: string; to: string } {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const end = `${month}-${String(last).padStart(2, "0")}`;
  return { from: `${month}-01`, to: end > today ? today : end };
}

/** The by-project row that a drilled general key reads from: it has no statement of its own. */
export function generalStatementRow(statement: Pick<Statement, "projects">, key: string, currency: string): StatementCurrency | null {
  const project = statement.projects.find((item) => item.key === key);
  return project == null ? null : (currencyOf(project.currencies, currency) ?? null);
}

export function isGeneralKey(key: string): boolean {
  return GENERAL_KEYS.has(key);
}

// ---- Balance views -------------------------------------------------------------------------------

/** A property's equity: its value less its loans and accumulated depreciation (assets less liabilities). */
export function sheetEquity(row: Pick<BalanceCurrency, "total_assets_minor" | "liabilities">): bigint {
  return row.total_assets_minor - row.liabilities.total_minor;
}

export type PropertyRow = { key: string; projectId: string | null; name: string; assets: bigint; liabilities: bigint; equity: bigint };

/**
 * The balance sheet by project: one row per property whose sheet has an account, largest equity first, then
 * "בנק ושאר", what the company holds outside them, so the rows add up to the company's equity.
 */
export function balanceProjectRows(company: BalanceCurrency, sheets: readonly BalanceSheet[]): PropertyRow[] {
  const rows = sheets.flatMap((sheet) => {
    const row = currencyOf(sheet.currencies, company.currency);
    if (row == null || sheet.project_id == null || (row.assets.accounts.length === 0 && row.liabilities.accounts.length === 0)) return [];
    return [{ key: sheet.project_id, projectId: sheet.project_id, name: sheet.project_name ?? "פרויקט", assets: row.total_assets_minor, liabilities: row.liabilities.total_minor, equity: sheetEquity(row) }];
  }).sort((a, b) => (a.equity === b.equity ? 0 : a.equity > b.equity ? -1 : 1));
  const inProjects = rows.reduce((sum, row) => sum + row.equity, 0n);
  const assets = rows.reduce((sum, row) => sum + row.assets, 0n);
  const liabilities = rows.reduce((sum, row) => sum + row.liabilities, 0n);
  const rest: PropertyRow = { key: "rest", projectId: null, name: "בנק ושאר", assets: company.total_assets_minor - assets, liabilities: company.liabilities.total_minor - liabilities, equity: equityTotal(company) - inProjects };
  return rest.assets === 0n && rest.liabilities === 0n && rest.equity === 0n ? rows : [...rows, rest];
}
