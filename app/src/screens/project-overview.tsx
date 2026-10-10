import { formatAmountText, type ProjectDetail } from "@flow/shared";
import type { ReactNode } from "react";
import { projectExpenseMinor, type ProjectCurrencyRow } from "../by-currency";
import { List, ListRow } from "../ui/list-row";
import type { ProjectInvestment } from "./project-investment-data";

type Project = NonNullable<ProjectDetail>;

/** get_project returns at most this many recent transactions, so a full page may hide older rows. */
export const PROJECT_RECENT_CAP = 40;

/** Where each overview row goes. The screen builds them, so dev fixtures can point elsewhere. */
export type ProjectOverviewLinks = {
  income: string;
  expenses: string;
  investment: string;
  loans: string;
  transactions: string;
  months: string;
};

/** One figure per currency, joined: "₪400,000 · $1,200". */
function figures(rows: readonly ProjectCurrencyRow[], pick: (row: ProjectCurrencyRow) => bigint): string {
  return rows.map((row) => formatAmountText(pick(row), row.currency)).join(" · ");
}

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

/** The lines the project page lists for its period; "40+" when the read stopped at its cap. */
export function transactionsFigure(project: Project): string {
  const count = project.transactions.length;
  return count >= PROJECT_RECENT_CAP ? `${String(PROJECT_RECENT_CAP)}+` : String(count);
}

function Figure({ children }: { children: ReactNode }) {
  return <bdi className="ui-num ui-project-row-figure" dir="ltr">{children}</bdi>;
}

/**
 * FLOW-340 C: the project page below the band is one list of one-line rows, each opening its own
 * screen. A row with nothing to show (no loan, no investment data) is left out.
 */
export function ProjectOverviewRows({
  project,
  investmentData,
  currencyRows,
  links,
  profitOnly = false,
}: {
  project: Project;
  investmentData: ProjectInvestment;
  currencyRows: readonly ProjectCurrencyRow[];
  links: ProjectOverviewLinks;
  /** FLOW-419: the profit page leaves השקעה and הלוואות to their own page. */
  profitOnly?: boolean;
}) {
  const investment = profitOnly ? null : investmentFigure(investmentData);
  const loans = profitOnly ? null : loansFigure(project);
  return (
    <List className="ui-project-overview">
      <ListRow variant="item" title="הכנסות" meta={<Figure>{figures(currencyRows, (row) => row.income_minor)}</Figure>} href={links.income} chevron />
      <ListRow variant="item" title="הוצאות" meta={<Figure>{figures(currencyRows, projectExpenseMinor)}</Figure>} href={links.expenses} chevron />
      {investment == null ? null : (
        <ListRow variant="item" title="השקעה" meta={investment === "" ? undefined : <span className="ui-project-row-figure">{investment}</span>} href={links.investment} chevron />
      )}
      {loans == null ? null : (
        <ListRow variant="item" title="הלוואות" meta={<span className="ui-project-row-figure">{loans}</span>} href={links.loans} chevron />
      )}
      <ListRow variant="item" title="תנועות" meta={<Figure>{transactionsFigure(project)}</Figure>} href={links.transactions} chevron />
      <ListRow variant="item" title="לפי חודש" href={links.months} chevron />
    </List>
  );
}
