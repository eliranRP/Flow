import { Card } from "../ui/card";
import { PartsBar, type BarPart, type BarLegendItem } from "../ui/parts-bar";
import { LoanBalance } from "./loan-list";
import type { LoanListSummary } from "./loan-list-summary";

/** FLOW-139. The loans list's summary card: the debt today, this month's parts, and the next payment. */
export function LoanSummaryCard({ summary, currency }: { summary: LoanListSummary; currency: string }) {
  const parts = [
    { key: "principal", label: "קרן", value: summary.monthlyParts.principal, tone: "accent" },
    { key: "interest", label: "ריבית", value: summary.monthlyParts.interest, tone: "accent-dim" },
    { key: "escrow", label: "נאמנות (escrow)", value: summary.monthlyParts.escrow, tone: "muted" },
  ] as const;
  const shown = parts.filter((part) => part.value > 0n);
  const bars: BarPart[] = shown.map((part) => ({ key: part.key, value: part.value, tone: part.tone }));
  const legend: BarLegendItem[] = shown.map((part) => ({
    key: part.key,
    label: part.label,
    value: <LoanBalance minor={part.value} currency={currency} />,
  }));
  const next = summary.next;
  return (
    <Card className="ui-loan-summary">
      <p className="ui-loan-summary-label">סך החוב היום</p>
      <LoanBalance className="ui-loan-summary-total" minor={summary.totalBalanceMinor} currency={currency} />
      <div className="ui-loan-summary-monthly">
        <span className="ui-loan-summary-label">תשלומים בחודש</span>
        <LoanBalance minor={summary.monthlyMinor} currency={currency} />
      </div>
      <PartsBar parts={bars} label="תשלומים בחודש" height={8} gap={2} radius="block" legend={legend} />
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
