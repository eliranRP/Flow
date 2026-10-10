import { formatAmountText, type ProjectDetail } from "@flow/shared";
import { projectExpenseMinor, type ProjectCurrencyRow } from "../by-currency";
import { CashRows, cashAmountsText, type CashRow } from "../ui/cash-rows";
import type { ProjectInvestment } from "./project-investment-data";

type Project = NonNullable<ProjectDetail>;

/** get_project returns at most this many recent transactions, so a full page may hide older rows. */
export const PROJECT_RECENT_CAP = 40;

/** Where the profit page's rows go. The screen builds them, so dev fixtures can point elsewhere. */
export type ProjectProfitLinks = {
  income: string;
  expenses: string;
  months: string;
};

/** "הון עצמי בנכס ₪850,000"; "" when there is data but no equity yet; null with nothing to show (FLOW-340 C). */
export function investmentFigure(data: ProjectInvestment): string | null {
  const figures = data.figures;
  if (data.isOverhead || figures == null) return null;
  if (figures.currentEquityMinor != null) return `הון עצמי בנכס ${formatAmountText(figures.currentEquityMinor, figures.currency)}`;
  const entered = figures.purchaseMinor != null || figures.valueMinor != null || figures.arvMinor != null || figures.rehabMinor !== 0n;
  return entered ? "" : null;
}

/** The loans the project still owes on; a paid-off or closed loan lives on the loans page only. */
export function openLoans(project: Project): NonNullable<Project["loans"]> {
  return (project.loans ?? []).filter((loan) => loan.status == null || loan.status === "open");
}

/** "הלוואת גישור · ₪800,000", or "2 הלוואות · ₪1,200,000" in one currency; null with no loan. */
export function loansFigure(project: Project): string | null {
  const loans = openLoans(project);
  const first = loans[0];
  if (first == null) return null;
  if (loans.length === 1) return `${first.name} · ${formatAmountText(first.balance_minor, first.currency)}`;
  const currencies = [...new Set(loans.map((loan) => loan.currency))];
  const totals = currencies
    .map((currency) => formatAmountText(
      loans.filter((loan) => loan.currency === currency).reduce((sum, loan) => sum + loan.balance_minor, 0n),
      currency,
    ))
    .join(" · ");
  return `${String(loans.length)} הלוואות · ${totals}`;
}

/**
 * FLOW-438 (design lead, 2026-10-10): the profit page's rows in the cash month page's look, so the
 * summary outweighs the lines listed under it: הכנסות in green, הוצאות, then לפי חודש. Each opens
 * its own screen. The page's own list carries the lines, so there is no תנועות row.
 */
export function ProjectProfitRows({
  currencyRows,
  links,
  periodWords,
}: {
  currencyRows: readonly ProjectCurrencyRow[];
  links: ProjectProfitLinks;
  /** "באוקטובר": the period, for a screen reader's row name. */
  periodWords: string;
}) {
  const amounts = (pick: (row: ProjectCurrencyRow) => bigint) => currencyRows.map((row) => ({ currency: row.currency, minor: pick(row) }));
  const income = amounts((row) => row.income_minor);
  const expenses = amounts(projectExpenseMinor);
  const rows: CashRow[] = [
    { id: "income", label: "הכנסות", tone: "in", amounts: income, href: links.income, name: `הכנסות ${periodWords} ${cashAmountsText(income)} – פירוט` },
    { id: "expenses", label: "הוצאות", tone: "out", amounts: expenses, href: links.expenses, name: `הוצאות ${periodWords} ${cashAmountsText(expenses)} – פירוט` },
    { id: "months", label: "לפי חודש", tone: "out", amounts: [], href: links.months, name: "לפי חודש" },
  ];
  return <CashRows rows={rows} />;
}
