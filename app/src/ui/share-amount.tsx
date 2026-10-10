import type { ReactNode } from "react";

/**
 * FLOW-434: a row's amount with its share of the total before it ("68%  $13,450"), for a split
 * read part by part (the loan page's interest, taxes and insurance, principal). The percent is a
 * whole number in the muted colour; the amount keeps the row's own type.
 */
export function ShareAmount({ percent, children, label }: { percent: number | null; children: ReactNode; label?: string }) {
  return (
    <span className="ui-share-amount" aria-label={label}>
      {percent == null ? null : <bdi className="ui-num ui-share-pct t-meta" dir="ltr">{`${String(percent)}%`}</bdi>}
      <span className="t-amount">{children}</span>
    </span>
  );
}
