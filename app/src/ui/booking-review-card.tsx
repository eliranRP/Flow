import { formatAmountText } from "@flow/shared";
import type { CSSProperties } from "react";
import { Amount } from "./amount";
import { JournalCard, type JournalRow } from "./journal-card";

/**
 * FLOW-955 (board LedgerReviewCard). A booking Jev made through the MCP, as a card in לאישור: the
 * "✦ בדיקת פקודת יומן של Jev" badge, the party, the date line, the amount, and the entry it proposed
 * ("הפקודה שהוצעה", compact) with עריכה to the composer. The queue's אישור and ביטול sit outside it.
 */
export function BookingReviewCard({
  party,
  sourceLine,
  amount,
  currency,
  moneyIn,
  income,
  debit,
  credit,
  balanced,
  editTo,
}: {
  party: string;
  /** "16/10 · נכנס · שורת בנק". */
  sourceLine: string;
  /** The line's bank movement, positive. */
  amount: bigint;
  currency: string;
  moneyIn: boolean;
  /** Money in that counts as income: green. Other money in reads "+" in the text colour. */
  income: boolean;
  debit: readonly JournalRow[];
  credit: readonly JournalRow[];
  balanced: boolean;
  /** Left out for a viewer. */
  editTo?: string;
}) {
  // As the queue's card: money in signed "+", money out unsigned; a long figure steps down to fit.
  const text = formatAmountText(amount, currency, { detail: true, ...(moneyIn ? { direction: "income" as const, plus: true } : {}) });
  const fit = { "--figure-chars": text.length } as CSSProperties;
  return (
    <article className="ui-review ui-booking-review">
      <div className="ui-review-doc">
        <div className="ui-review-copy">
          <span className="ui-journal-badge ui-booking-badge">
            <span aria-hidden="true">✦</span>
            {" בדיקת פקודת יומן של Jev"}
          </span>
          <h2 className="ui-review-supplier t-btn">{party}</h2>
          <p className="t-caption t-muted">{sourceLine}</p>
        </div>
      </div>
      <p className="t-detail ui-review-figure" style={fit}>
        {moneyIn
          ? <Amount agorot={amount} presentation="detail" currency={currency} income={income} direction="income" />
          : <Amount agorot={amount} presentation="detail" currency={currency} />}
      </p>
      <JournalCard debit={debit} credit={credit} currency={currency} balanced={balanced} proposed editTo={editTo} />
    </article>
  );
}
