import { Link } from "react-router-dom";
import { Card } from "../ui/card";
import { ChevronIcon } from "../ui/icons";
import { PartsBar, type BarPart, type BarLegendItem } from "../ui/parts-bar";
import { formatLoanMoney, type LoanCurrency } from "./loan-form";
import type { LoanListSummary } from "./loan-list-summary";

/**
 * FLOW-139. The loans list's summary card: the debt today, this month's parts, and the next payment,
 * then the link to the summary page (what was paid and what is left).
 */
export function LoanSummaryCard({ summary, currency, summaryHref }: { summary: LoanListSummary; currency: LoanCurrency; summaryHref: string }) {
  const money = (minor: bigint) => <bdi dir="ltr">{formatLoanMoney(minor, currency)}</bdi>;
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
    value: money(part.value),
  }));
  const next = summary.next;
  const takeaway = monthlyTakeaway(shown);
  return (
    <Card className="ui-loan-summary">
      <p className="ui-loan-summary-label">סך החוב היום</p>
      <span className="ui-loan-summary-total">{money(summary.totalBalanceMinor)}</span>
      <div className="ui-loan-summary-monthly">
        <span className="ui-loan-summary-label">תשלומים בחודש</span>
        {money(summary.monthlyMinor)}
      </div>
      {takeaway == null ? null : <p className="ui-loan-summary-takeaway">{takeaway}</p>}
      <PartsBar
        parts={bars}
        label={`תשלומים בחודש: ${shown.map((part) => `${part.label} ${formatLoanMoney(part.value, currency)}`).join(", ")}`}
        height={8}
        gap={2}
        radius="block"
        legend={legend}
      />
      {next == null ? null : (
        <>
          <div className="ui-loan-summary-next">
            <span className="ui-loan-summary-next-text">
              <span className="ui-loan-summary-label">התשלום הבא</span>
              <span className="ui-loan-summary-next-line">{next.lenderName} · <bdi dir="ltr">{dayMonth(next.dueDate)}</bdi></span>
            </span>
            {money(next.amountMinor)}
          </div>
          <p className="ui-loan-summary-caption">ב־12 החודשים הבאים {money(summary.twelveMonthsMinor)}</p>
        </>
      )}
      <Link className="ui-loan-summary-link" to={summaryHref}>
        <span>מה שולם עד היום, וכמה נשאר מהחוב</span>
        <ChevronIcon size={18} />
      </Link>
    </Card>
  );
}

const TAKEAWAY_PART: Record<string, string> = { principal: "לקרן", interest: "לריבית", escrow: "לנאמנות" };

/** FLOW-962: what the bar says, in words: the part that takes most of the month's payments (רוב only past half). */
export function monthlyTakeaway(parts: readonly { key: string; value: bigint }[]): string | null {
  let top: { key: string; value: bigint } | null = null;
  let total = 0n;
  for (const part of parts) {
    total += part.value;
    if (top == null || part.value > top.value) top = part;
  }
  if (top == null || parts.length < 2) return null;
  const where = TAKEAWAY_PART[top.key] ?? "";
  return top.value * 2n > total ? `רוב התשלום החודשי הולך ${where}` : `החלק הגדול בתשלום החודשי הולך ${where}`;
}

/** dd/mm from an ISO date, as the list shows it. */
function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}
