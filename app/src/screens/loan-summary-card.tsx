import { Card } from "../ui/card";
import { PartsBar, type PartsBarPart } from "../ui/parts-bar";
import { LoanBalance } from "./loan-list";
import type { LoanListSummary } from "./loan-list-summary";

/** FLOW-139. The loans list's summary card: the debt today, this month's parts, and the next payment. */
export function LoanSummaryCard({ summary, currency }: { summary: LoanListSummary; currency: string }) {
  const parts: PartsBarPart[] = [
    { key: "principal", label: "קרן", minor: summary.monthlyParts.principal, color: "var(--color-accent)", amount: <LoanBalance minor={summary.monthlyParts.principal} currency={currency} /> },
    { key: "interest", label: "ריבית", minor: summary.monthlyParts.interest, color: "var(--color-accent-dim)", amount: <LoanBalance minor={summary.monthlyParts.interest} currency={currency} /> },
    { key: "escrow", label: "נאמנות (escrow)", minor: summary.monthlyParts.escrow, color: "var(--color-track-strong, var(--color-line))", amount: <LoanBalance minor={summary.monthlyParts.escrow} currency={currency} /> },
  ];
  const next = summary.next;
  return (
    <Card className="ui-loan-summary">
      <p className="ui-loan-summary-label">סך החוב היום</p>
      <LoanBalance className="ui-loan-summary-total" minor={summary.totalBalanceMinor} currency={currency} />
      <div className="ui-loan-summary-monthly">
        <span className="ui-loan-summary-label">תשלומים בחודש</span>
        <LoanBalance minor={summary.monthlyMinor} currency={currency} />
      </div>
      <PartsBar parts={parts} />
      {next == null ? null : (
        <p className="ui-loan-summary-caption">
          הבא: <LoanBalance minor={next.amountMinor} currency={currency} /> ל־{next.lenderName} ב־{dayMonth(next.dueDate)}
          {" · 12 החודשים הבאים "}
          <LoanBalance minor={summary.twelveMonthsMinor} currency={currency} />
        </p>
      )}
    </Card>
  );
}

/** dd/mm from an ISO date, as the list shows it. */
function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}
