// FLOW-991: the reports as a grid, a row per category or account and a column per project or per period
// (Reports export design, "PDF · רווח והפסד לפי נכס" and the three pages after it). The columns are projects
// or periods, never both; the other is a filter. The PDF (report_pdf.ts), the CSV (report_csv.ts), the xlsx
// (report_xlsx.ts) and export_report's json all draw the same grid, so they never disagree.
import {
  accountName,
  categoryName,
  money,
  systemAccountName,
  type BalanceAccount,
  type BalanceCurrency,
  type StatementChild,
  type StatementCurrency,
  type StatementNode,
} from "./report_model.ts";

/** total: one column, the whole period or the date (the xlsx and json of a report with no columns). */
export type GridBy = "total" | "project" | "month" | "quarter" | "year";
export type GridRowKind = "section" | "parent" | "child" | "row" | "sub" | "mid" | "net";
/**
 * One row. `cells` has one amount per column (null: nothing to show there, as equity in a project's column);
 * `total` is the total column's. `plus` and `minus` name the rows (by index) this row adds up, so the xlsx
 * writes it as a formula; a row without them is a figure from the books.
 */
export type GridRow = { kind: GridRowKind; label: string; cells: (bigint | null)[]; total: bigint | null; plus?: number[]; minus?: number[] };
export type ReportGrid = {
  report: "pnl" | "balance";
  by: GridBy;
  currency: string;
  columns: string[];
  /** False for the balance sheet by period: its last column is the balance sheet's date, not a sum. */
  hasTotal: boolean;
  rows: GridRow[];
  kpis: { label: string; value: string }[];
  notes: string[];
};

/** A column's statement or balance sheet in one currency; undefined when it has nothing in that currency. */
export type PnlColumn = { label: string; rows: (StatementCurrency | undefined)[] };

const ZERO_STATEMENT = (currency: string): StatementCurrency => ({
  currency, income_minor: 0n, expense_minor: 0n, net_minor: 0n, income: [], expense: [], kept_out: [],
});

function key(id: string | null, name: string | null): string {
  return id ?? `name:${name ?? ""}`;
}

/** Several statements in one currency added up: categories by id, sub-categories by id, largest first. */
export function mergeStatements(currency: string, rows: (StatementCurrency | undefined)[]): StatementCurrency {
  const out = ZERO_STATEMENT(currency);
  const side = (pick: (row: StatementCurrency) => StatementNode[]) => {
    const nodes = new Map<string, StatementNode & { kids: Map<string, StatementChild> }>();
    for (const row of rows) {
      if (row == null) continue;
      for (const node of pick(row)) {
        const k = key(node.id, node.name);
        const into = nodes.get(k) ?? { id: node.id, name: node.name, amount_minor: 0n, count: 0, own_minor: 0n, children: [], kids: new Map() };
        into.amount_minor += node.amount_minor;
        into.own_minor += node.own_minor;
        into.count += node.count;
        for (const child of node.children) {
          const ck = key(child.id, child.name);
          const kid = into.kids.get(ck) ?? { id: child.id, name: child.name, amount_minor: 0n, count: 0 };
          kid.amount_minor += child.amount_minor;
          kid.count += child.count;
          into.kids.set(ck, kid);
        }
        nodes.set(k, into);
      }
    }
    const bySize = (a: { amount_minor: bigint }, b: { amount_minor: bigint }) => (a.amount_minor === b.amount_minor ? 0 : a.amount_minor > b.amount_minor ? -1 : 1);
    return [...nodes.values()].map(({ kids, ...node }) => ({ ...node, children: [...kids.values()].sort(bySize) })).sort(bySize);
  };
  out.income = side((row) => row.income);
  out.expense = side((row) => row.expense);
  const kept = new Map<string, StatementCurrency["kept_out"][number]>();
  for (const row of rows) {
    if (row == null) continue;
    out.income_minor += row.income_minor;
    out.expense_minor += row.expense_minor;
    out.net_minor += row.net_minor;
    for (const item of row.kept_out) {
      const k = `${item.direction}:${key(item.id, item.name)}`;
      const into = kept.get(k) ?? { ...item, amount_minor: 0n };
      into.amount_minor += item.amount_minor;
      kept.set(k, into);
    }
  }
  out.kept_out = [...kept.values()];
  return out;
}

function nodeMap(nodes: StatementNode[]): Map<string, StatementNode> {
  return new Map(nodes.map((node) => [key(node.id, node.name), node]));
}

const sumOf = (cells: (bigint | null)[]) => cells.reduce<bigint>((sum, cell) => sum + (cell ?? 0n), 0n);

/** Whole percent of the net on income, or "—". */
function margin(income: bigint, net: bigint): string {
  if (income <= 0n) return "—";
  const value = Math.round((Number(net) * 100) / Number(income));
  return `${value < 0 ? "−" : ""}${String(Math.abs(value))}%`;
}

/**
 * The P&L grid in one currency. Each column's statement gives its cells; the total column is their sum.
 * `expand` puts each category's sub-categories under it.
 */
export function pnlGrid(by: GridBy, currency: string, columns: PnlColumn[], expand: boolean, reviewCount: number): ReportGrid {
  const per = columns.map((column) => column.rows.find((row) => row?.currency === currency));
  const merged = mergeStatements(currency, per);
  const rows: GridRow[] = [];
  const maps = per.map((row) => ({ income: nodeMap(row?.income ?? []), expense: nodeMap(row?.expense ?? []) }));
  const side = (title: string, which: "income" | "expense", sign: 1n | -1n, totalLabel: string): number | null => {
    const nodes = merged[which];
    if (nodes.length === 0) return null;
    rows.push({ kind: "section", label: title, cells: per.map(() => null), total: null });
    const tops: number[] = [];
    for (const node of nodes) {
      const k = key(node.id, node.name);
      const cellsOf = (pick: (found: StatementNode) => bigint) => maps.map((map) => {
        const found = map[which].get(k);
        return found == null ? 0n : sign * pick(found);
      });
      const shown = expand && node.children.length > 0;
      if (!shown) {
        tops.push(rows.length);
        const cells = cellsOf((found) => found.amount_minor);
        rows.push({ kind: "row", label: categoryName(node.name), cells, total: sumOf(cells) });
        continue;
      }
      const parentAt = rows.length;
      tops.push(parentAt);
      rows.push({ kind: "parent", label: categoryName(node.name), cells: [], total: null, plus: [] });
      const kids: number[] = [];
      if (node.own_minor !== 0n) {
        kids.push(rows.length);
        const cells = cellsOf((found) => found.own_minor);
        rows.push({ kind: "child", label: `${categoryName(node.name)} · ישירות`, cells, total: sumOf(cells) });
      }
      for (const child of node.children) {
        const ck = key(child.id, child.name);
        kids.push(rows.length);
        const cells = maps.map((map) => {
          const found = map[which].get(k)?.children.find((item) => key(item.id, item.name) === ck);
          return found == null ? 0n : sign * found.amount_minor;
        });
        rows.push({ kind: "child", label: categoryName(child.name), cells, total: sumOf(cells) });
      }
      const parent = rows[parentAt]!;
      parent.plus = kids;
      parent.cells = per.map((_, index) => kids.reduce((sum, at) => sum + (rows[at]!.cells[index] ?? 0n), 0n));
      parent.total = sumOf(parent.cells);
    }
    const cells = per.map((_, index) => tops.reduce((sum, at) => sum + (rows[at]!.cells[index] ?? 0n), 0n));
    rows.push({ kind: "sub", label: totalLabel, cells, total: sumOf(cells), plus: tops });
    return rows.length - 1;
  };
  const income = side("הכנסות", "income", 1n, "סה״כ הכנסות");
  const expense = side("הוצאות", "expense", -1n, "סה״כ הוצאות");
  const plus = [income, expense].filter((at): at is number => at != null);
  const netCells = per.map((_, index) => plus.reduce((sum, at) => sum + (rows[at]!.cells[index] ?? 0n), 0n));
  rows.push({ kind: "net", label: "רווח נקי", cells: netCells, total: sumOf(netCells), plus });
  const incomeTotal = income == null ? 0n : rows[income]!.total ?? 0n;
  const expenseTotal = expense == null ? 0n : rows[expense]!.total ?? 0n;
  const net = incomeTotal + expenseTotal;
  const notes: string[] = [];
  if (by === "project") notes.push("כל עמודת פרויקט היא רווח והפסד של הפרויקט: השורות שלו וחלקו בהוצאה משותפת.");
  const kept = merged.kept_out.filter((item) => item.amount_minor !== 0n);
  if (kept.length > 0) {
    const list = kept.map((item) => {
      const account = item.account_name == null ? null : systemAccountName(item.account_name);
      const name = account == null || account === categoryName(item.name) ? categoryName(item.name) : `${categoryName(item.name)} (${account})`;
      return `${name} ${money(item.direction === "income" ? item.amount_minor : -item.amount_minor, currency)}`;
    });
    notes.push(`לא נספר ברווח (במאזן): ${list.join(" · ")}.`);
  } else {
    notes.push("קרן, פיקדון מסים וביטוח וקניית נכסים לא נספרים ברווח; הם במאזן.");
  }
  if (reviewCount > 0) notes.push(`${String(reviewCount)} תנועות ממתינות לבדיקה בתקופה ולא נכללו.`);
  return {
    report: "pnl",
    by,
    currency,
    columns: columns.map((column) => column.label),
    hasTotal: by !== "total",
    rows,
    kpis: [
      { label: "רווח נקי", value: money(net, currency) },
      { label: "הכנסות", value: money(incomeTotal, currency) },
      { label: "הוצאות", value: money(expenseTotal, currency) },
      { label: "מההכנסות", value: margin(incomeTotal, net) },
    ],
    notes,
  };
}

/**
 * The name of the column for the overhead and the lines with no project: "כללי", or "בלי פרויקט" when a
 * project is itself called "כללי" (a company's overhead project often is), so no two columns share a name.
 */
export function generalLabel(projects: string[]): string {
  return projects.includes("כללי") ? "בלי פרויקט" : "כללי";
}

/** A balance-sheet column in one currency; undefined when it has no balances in that currency. */
export type BalanceColumn = { label: string; sheet: BalanceCurrency | undefined };

function accountKey(account: BalanceAccount): string {
  return account.account_id ?? `${account.is_system ? "system" : "name"}:${account.name}`;
}

/** The accounts of one side across the columns, in the books' order (by name), each column's balance. */
function accountRows(sheets: (BalanceCurrency | undefined)[], pick: (sheet: BalanceCurrency) => BalanceAccount[]): GridRow[] {
  const seen = new Map<string, BalanceAccount>();
  for (const sheet of sheets) for (const account of sheet == null ? [] : pick(sheet)) if (!seen.has(accountKey(account))) seen.set(accountKey(account), account);
  return [...seen.values()]
    .sort((a, b) => accountName(a).localeCompare(accountName(b), "he"))
    .map((account) => {
      const cells = sheets.map((sheet) => (sheet == null ? 0n : pick(sheet).find((item) => accountKey(item) === accountKey(account))?.balance_minor ?? 0n));
      return { kind: "row" as const, label: accountName(account), cells, total: sumOf(cells) };
    });
}

/**
 * The balance sheet by project in one currency. `company` is the whole company's sheet: its equity shows in
 * the total column only, and the "כללי" column (when `general` is set) is the company less the projects.
 */
export function balanceGridByProject(currency: string, projects: BalanceColumn[], company: BalanceCurrency | undefined, general: boolean, date: string): ReportGrid {
  const columns = [...projects];
  if (general) columns.push({ label: generalLabel(projects.map((column) => column.label)), sheet: company == null ? undefined : remainder(company, projects.map((column) => column.sheet)) });
  const sheets = columns.map((column) => column.sheet);
  const rows: GridRow[] = [];
  const block = (title: string, pick: (sheet: BalanceCurrency) => BalanceAccount[], totalLabel: string): number => {
    rows.push({ kind: "section", label: title, cells: sheets.map(() => null), total: null });
    const start = rows.length;
    rows.push(...accountRows(sheets, pick));
    const plus = Array.from({ length: rows.length - start }, (_, index) => start + index);
    const cells = sheets.map((_, index) => plus.reduce((sum, at) => sum + (rows[at]!.cells[index] ?? 0n), 0n));
    rows.push({ kind: "sub", label: totalLabel, cells, total: sumOf(cells), plus });
    return rows.length - 1;
  };
  const assets = block("נכסים", (sheet) => sheet.assets.accounts, "סה״כ נכסים");
  const liabilities = block("התחייבויות", (sheet) => sheet.liabilities.accounts, "סה״כ התחייבויות");
  const netCells = sheets.map((_, index) => (rows[assets]!.cells[index] ?? 0n) - (rows[liabilities]!.cells[index] ?? 0n));
  const netAssets = sumOf(netCells);
  rows.push({ kind: "mid", label: "נכסים נטו (נכסים פחות התחייבויות)", cells: netCells, total: netAssets, plus: [assets], minus: [liabilities] });
  const notes = ["שורה שייכת לפרויקט לפי הפרויקט שהתנועה שויכה אליו. נכסים נטו של פרויקט = הנכסים שלו פחות ההתחייבויות שלו."];
  // Equity is the company's: it shows only when every project is in, in the total column.
  if (general && company != null) {
    rows.push({ kind: "section", label: "הון (ברמת החברה)", cells: sheets.map(() => null), total: null });
    const start = rows.length;
    for (const account of company.equity.accounts) rows.push({ kind: "row", label: accountName(account), cells: sheets.map(() => null), total: account.balance_minor });
    if (company.retained_earnings_minor !== 0n) rows.push({ kind: "row", label: "רווח שנצבר", cells: sheets.map(() => null), total: company.retained_earnings_minor });
    const plus = Array.from({ length: rows.length - start }, (_, index) => start + index);
    rows.push({ kind: "net", label: "סה״כ הון", cells: sheets.map(() => null), total: company.equity.total_minor + company.retained_earnings_minor, plus });
    notes.push("כללי: מה שלא שויך לפרויקט (חשבונות החברה, הלוואות לחברה). ההון הוא של החברה ומופיע רק בסה״כ.");
    notes.push(company.balanced ? "מאוזן · נכסים = התחייבויות + הון" : "לא מאוזן: כדאי לבדוק את הספרים");
  }
  return {
    report: "balance",
    by: "project",
    currency,
    columns: columns.map((column) => column.label),
    hasTotal: true,
    rows,
    kpis: [
      { label: general ? "הון עצמי" : "נכסים נטו", value: money(netAssets, currency) },
      { label: "נכסים", value: money(rows[assets]!.total ?? 0n, currency) },
      { label: "התחייבויות", value: money(rows[liabilities]!.total ?? 0n, currency) },
      { label: "נכון ל־", value: date },
    ],
    notes,
  };
}

/** The company's sheet less the projects' sheets, account by account. */
export function remainder(company: BalanceCurrency, projects: (BalanceCurrency | undefined)[]): BalanceCurrency {
  const less = (pick: (sheet: BalanceCurrency) => BalanceAccount[]): BalanceAccount[] =>
    pick(company)
      .map((account) => ({
        ...account,
        balance_minor: account.balance_minor - projects.reduce((sum, sheet) => sum + (sheet == null ? 0n : pick(sheet).find((item) => accountKey(item) === accountKey(account))?.balance_minor ?? 0n), 0n),
      }))
      .concat(
        // An account a project has and the company does not (it cannot, but the sum must still hold).
        projects.flatMap((sheet) => (sheet == null ? [] : pick(sheet)))
          .filter((account) => !pick(company).some((item) => accountKey(item) === accountKey(account)))
          .map((account) => ({ ...account, balance_minor: -account.balance_minor })),
      )
      .filter((account) => account.balance_minor !== 0n);
  const side = (pick: (sheet: BalanceCurrency) => { total_minor: bigint; accounts: BalanceAccount[] }) => {
    const accounts = less((sheet) => pick(sheet).accounts);
    return { total_minor: accounts.reduce((sum, account) => sum + account.balance_minor, 0n), accounts };
  };
  const assets = side((sheet) => sheet.assets);
  const liabilities = side((sheet) => sheet.liabilities);
  const equity = side((sheet) => sheet.equity);
  const retained = company.retained_earnings_minor - projects.reduce((sum, sheet) => sum + (sheet?.retained_earnings_minor ?? 0n), 0n);
  return {
    currency: company.currency,
    assets,
    liabilities,
    equity,
    retained_earnings_minor: retained,
    total_liabilities_and_equity_minor: liabilities.total_minor + equity.total_minor + retained,
    balanced: assets.total_minor === liabilities.total_minor + equity.total_minor + retained,
    warnings: [],
  };
}

/** Several balance sheets in one currency added up, account by account (several projects picked together). */
export function addSheets(currency: string, sheets: (BalanceCurrency | undefined)[]): BalanceCurrency {
  const side = (pick: (sheet: BalanceCurrency) => BalanceAccount[]) => {
    const accounts = new Map<string, BalanceAccount>();
    for (const sheet of sheets) {
      for (const account of sheet == null ? [] : pick(sheet)) {
        const into = accounts.get(accountKey(account)) ?? { ...account, balance_minor: 0n };
        into.balance_minor += account.balance_minor;
        accounts.set(accountKey(account), into);
      }
    }
    const list = [...accounts.values()].filter((account) => account.balance_minor !== 0n);
    return { total_minor: list.reduce((sum, account) => sum + account.balance_minor, 0n), accounts: list };
  };
  const assets = side((sheet) => sheet.assets.accounts);
  const liabilities = side((sheet) => sheet.liabilities.accounts);
  const equity = side((sheet) => sheet.equity.accounts);
  const retained = sheets.reduce((sum, sheet) => sum + (sheet?.retained_earnings_minor ?? 0n), 0n);
  return {
    currency,
    assets,
    liabilities,
    equity,
    retained_earnings_minor: retained,
    total_liabilities_and_equity_minor: liabilities.total_minor + equity.total_minor + retained,
    balanced: assets.total_minor === liabilities.total_minor + equity.total_minor + retained,
    warnings: sheets.flatMap((sheet) => sheet?.warnings ?? []),
  };
}

/** The balance sheet by period in one currency: each column is the balance on its date; no total column. */
export function balanceGridByPeriod(by: GridBy, currency: string, columns: BalanceColumn[]): ReportGrid {
  const sheets = columns.map((column) => column.sheet);
  const rows: GridRow[] = [];
  const block = (title: string, pick: (sheet: BalanceCurrency) => BalanceAccount[], totalLabel: string, extra?: GridRow): number => {
    rows.push({ kind: "section", label: title, cells: sheets.map(() => null), total: null });
    const start = rows.length;
    rows.push(...accountRows(sheets, pick));
    if (extra != null && extra.cells.some((cell) => cell !== 0n)) rows.push(extra);
    const plus = Array.from({ length: rows.length - start }, (_, index) => start + index);
    const cells = sheets.map((_, index) => plus.reduce((sum, at) => sum + (rows[at]!.cells[index] ?? 0n), 0n));
    rows.push({ kind: "sub", label: totalLabel, cells, total: null, plus });
    return rows.length - 1;
  };
  const assets = block("נכסים", (sheet) => sheet.assets.accounts, "סה״כ נכסים");
  const liabilities = block("התחייבויות", (sheet) => sheet.liabilities.accounts, "סה״כ התחייבויות");
  const retained: GridRow = { kind: "row", label: "רווח שנצבר", cells: sheets.map((sheet) => sheet?.retained_earnings_minor ?? 0n), total: null };
  const equity = block("הון", (sheet) => sheet.equity.accounts, "סה״כ הון", retained);
  const cells = sheets.map((_, index) => (rows[liabilities]!.cells[index] ?? 0n) + (rows[equity]!.cells[index] ?? 0n));
  rows.push({ kind: "net", label: "התחייבויות והון", cells, total: null, plus: [liabilities, equity] });
  const last = sheets.length - 1;
  const at = (row: number, index: number) => rows[row]!.cells[index] ?? 0n;
  return {
    report: "balance",
    by,
    currency,
    columns: columns.map((column) => column.label),
    hasTotal: false,
    rows,
    kpis: [
      { label: "הון עצמי", value: money(at(equity, last), currency) },
      { label: "נכסים", value: money(at(assets, last), currency) },
      { label: "התחייבויות", value: money(at(liabilities, last), currency) },
      ...(columns.length > 1 ? [{ label: `שינוי מ־${columns[0]?.label ?? ""}`, value: money(at(equity, last) - at(equity, 0), currency) }] : []),
    ],
    notes: columns.length > 1 ? ["כל עמודה היא היתרה בסוף התקופה. העמודה האחרונה היא תאריך המאזן."] : [],
  };
}

/** A period of a P&L by period: its first and last day and its column's label. */
export type Period = { from: string; to: string; label: string };

const MONTHS = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The months, quarters or years from `from` to `to`, the first and last clipped to the range. */
export function periods(by: "month" | "quarter" | "year", from: string, to: string): Period[] {
  const [fy, fm] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const [ty, tm] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
  const step = by === "month" ? 1 : by === "quarter" ? 3 : 12;
  const oneYear = fy === ty;
  const out: Period[] = [];
  let year = fy;
  let month = by === "month" ? fm : by === "quarter" ? Math.floor((fm - 1) / 3) * 3 + 1 : 1;
  while (year < ty || (year === ty && month <= tm)) {
    const endMonth = month + step - 1;
    const start = iso(year, month, 1);
    const end = iso(year, endMonth, lastDay(year, endMonth));
    const label = by === "month"
      ? (oneYear ? MONTHS[month - 1]! : `${MONTHS[month - 1]!} ${String(year).slice(2)}`)
      : by === "quarter"
      ? (oneYear ? `רבעון ${String((month + 2) / 3)}` : `רבעון ${String((month + 2) / 3)} ${String(year)}`)
      : String(year);
    out.push({ from: start < from ? from : start, to: end > to ? to : end, label });
    month += step;
    if (month > 12) {
      month -= 12;
      year += 1;
    }
  }
  return out;
}
