import type { ReactNode } from "react";
import { BigNumber } from "./big-number";

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="ui-stat-grid">{children}</div>;
}

export function Stat({
  label,
  amount,
  change,
  emphasis = false,
}: {
  label: string;
  amount: bigint;
  change?: { text: string; good: boolean } | null;
  emphasis?: boolean;
}) {
  return (
    <div className={emphasis ? "ui-stat ui-stat-em" : "ui-stat"}>
      <p className="t-hint">{label}</p>
      <p className="t-title-3">
        <BigNumber agorot={amount} />
      </p>
      {change ? <p className={change.good ? "ui-delta ui-delta-good" : "ui-delta ui-delta-bad"}>{change.text}</p> : null}
    </div>
  );
}
