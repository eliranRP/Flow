// FLOW-162: the report as a CSV that opens in Excel: UTF-8 with a byte-order mark (so Excel reads the Hebrew),
// one row per line of the report, amounts as plain numbers with two decimals and a minus on money out. The
// same parts as the PDF (report_model.ts), so the two files hold the same numbers.
import {
  accountName,
  basisLabel,
  categoryName,
  displayDate,
  periodLabel,
  projectKeyName,
  type BalancePart,
  type PnlPart,
  type ReportFile,
  type StatementCurrency,
  systemAccountName,
} from "./report_model.ts";

/** An amount in minor units as a plain decimal: −1234567 → "-12345.67". Every currency here has two decimals. */
export function decimal(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 100n;
  const cents = String(abs % 100n).padStart(2, "0");
  return `${negative ? "-" : ""}${String(whole)}.${cents}`;
}

/** One CSV cell: quoted when it holds a comma, a quote or a line break; a leading = + - @ is defused. */
export function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function line(cells: string[]): string {
  return cells.map(cell).join(",");
}

function pnlRows(part: PnlPart, rows: string[][]) {
  const statement = part.statement;
  const scope = statement.project_name ?? (part.byProject ? "לפי פרויקט" : "כל הפרויקטים");
  rows.push(["רווח והפסד", periodLabel(statement), scope, basisLabel(statement.basis)]);
  if (part.byProject && statement.projects.length > 0) {
    rows.push(["פרויקט", "מטבע", "הכנסות", "הוצאות", "רווח נקי"]);
    for (const project of statement.projects) {
      for (const row of project.currencies) rows.push([projectKeyName(project), row.currency, decimal(row.income_minor), decimal(-row.expense_minor), decimal(row.net_minor)]);
    }
    for (const row of statement.currencies) rows.push(["סה״כ", row.currency, decimal(row.income_minor), decimal(-row.expense_minor), decimal(row.net_minor)]);
    pnlNotes(statement, rows);
    rows.push([]);
    return;
  }
  rows.push(["סעיף", "קטגוריה", "תת־קטגוריה", "מטבע", "סכום"]);
  const side = (row: StatementCurrency, title: string, nodes: StatementCurrency["income"], sign: 1n | -1n) => {
    for (const node of nodes) {
      if (node.children.length === 0 || !part.expand) {
        rows.push([title, categoryName(node.name), "", row.currency, decimal(sign * node.amount_minor)]);
        continue;
      }
      if (node.own_minor !== 0n) rows.push([title, categoryName(node.name), "ישירות בקטגוריה", row.currency, decimal(sign * node.own_minor)]);
      for (const item of node.children) rows.push([title, categoryName(node.name), categoryName(item.name), row.currency, decimal(sign * item.amount_minor)]);
    }
  };
  for (const row of statement.currencies) {
    side(row, "הכנסות", row.income, 1n);
    rows.push(["סה״כ הכנסות", "", "", row.currency, decimal(row.income_minor)]);
    side(row, "הוצאות", row.expense, -1n);
    rows.push(["סה״כ הוצאות", "", "", row.currency, decimal(-row.expense_minor)]);
    rows.push(["רווח נקי", "", "", row.currency, decimal(row.net_minor)]);
    for (const item of row.kept_out) {
      const account = item.account_name == null ? "" : systemAccountName(item.account_name);
      rows.push(["לא נספר ברווח", categoryName(item.name), account === categoryName(item.name) ? "" : account, row.currency, decimal(item.direction === "income" ? item.amount_minor : -item.amount_minor)]);
    }
  }
  pnlNotes(statement, rows);
  rows.push([]);
}

/** The PDF's notes under the P&L, as rows: what is kept out of profit, and the lines still waiting for review. */
function pnlNotes(statement: PnlPart["statement"], rows: string[][]) {
  rows.push(["הערה", "קרן, פיקדון מסים וביטוח וקניית נכסים לא נספרים ברווח; הם במאזן."]);
  if (statement.review_count > 0) rows.push(["הערה", `${String(statement.review_count)} תנועות ממתינות לבדיקה בתקופה ולא נכללו.`]);
}

function balanceRows(part: BalancePart, rows: string[][]) {
  const sheet = part.sheet;
  rows.push(["מאזן", `נכון ל־${displayDate(sheet.as_of)}`, sheet.project_name ?? "כל הפרויקטים"]);
  rows.push(["סעיף", "חשבון", "מטבע", "יתרה"]);
  for (const row of sheet.currencies) {
    const side = (title: string, accounts: typeof row.assets.accounts, total: bigint) => {
      for (const account of accounts) rows.push([title, accountName(account), row.currency, decimal(account.balance_minor)]);
      rows.push([`סה״כ ${title}`, "", row.currency, decimal(total)]);
    };
    side("נכסים", row.assets.accounts, row.assets.total_minor);
    side("התחייבויות", row.liabilities.accounts, row.liabilities.total_minor);
    for (const account of row.equity.accounts) rows.push(["הון", accountName(account), row.currency, decimal(account.balance_minor)]);
    rows.push(["הון", "רווח שנצבר", row.currency, decimal(row.retained_earnings_minor)]);
    rows.push(["סה״כ הון", "", row.currency, decimal(row.equity.total_minor + row.retained_earnings_minor)]);
    rows.push(["התחייבויות והון", "", row.currency, decimal(row.total_liabilities_and_equity_minor)]);
    rows.push(["הערה", row.balanced ? "מאוזן · נכסים = התחייבויות + הון" : "לא מאוזן: כדאי לבדוק את הספרים"]);
    for (const warning of row.warnings) rows.push(["אזהרה", systemAccountName(warning.account_name), row.currency, decimal(warning.balance_minor)]);
  }
  rows.push([]);
}

/** The CSV's text, with the byte-order mark Excel needs for Hebrew. */
export function renderReportCsv(file: ReportFile): string {
  const rows: string[][] = [[file.company, `הופק ב־${file.createdAt}`, "דוח ניהולי מתוך Flow, לא דוח כספי מבוקר"], []];
  for (const part of file.parts) {
    if (part.kind === "pnl") pnlRows(part, rows);
    else balanceRows(part, rows);
  }
  return `\uFEFF${rows.map(line).join("\r\n")}\r\n`;
}
