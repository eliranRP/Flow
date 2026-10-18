import { formatAmountText, type ProjectDetail } from "@flow/shared";

type Project = NonNullable<ProjectDetail>;

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
