import type { ReactNode } from "react";
import { cx } from "./cx";

export type PartsBarPart = { key: string; label: string; weight: number; color: string; amount: ReactNode };

/**
 * FLOW-139. A stacked bar of a loan's parts (principal, interest, escrow) with one legend row
 * per part whose weight is above zero. Segments are sized by weight (the amount); the caller formats each amount.
 */
export function PartsBar({ parts, className }: { parts: readonly PartsBarPart[]; className?: string }) {
  const shown = parts.filter((part) => part.weight > 0);
  return (
    <div className={cx("ui-parts-bar", className)}>
      <div className="ui-parts-track" role="img" aria-label={shown.map((part) => part.label).join(", ")}>
        {shown.map((part) => (
          <span key={part.key} className="ui-parts-seg" style={{ flexGrow: part.weight, background: part.color }} />
        ))}
      </div>
      {shown.map((part) => (
        <div key={part.key} className="ui-parts-row">
          <span className="ui-parts-dot" style={{ background: part.color }} aria-hidden="true" />
          <span className="ui-parts-name">{part.label}</span>
          <span className="ui-parts-amount">{part.amount}</span>
        </div>
      ))}
    </div>
  );
}
