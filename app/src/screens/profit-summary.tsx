import type { ReactNode } from "react";
import { Amount } from "../ui/amount";
import { Card } from "../ui/card";
import type { SummaryLine } from "../company-profit-rows";

/** One row of a profit page's summary card: a label and its figure, a hairline between rows (board `sum`). */
export function SummaryRow({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className={strong ? "ui-pp-row ui-pp-row-strong" : "ui-pp-row"}>
      <span className="ui-pp-label">{label}</span>
      <span>{value}</span>
    </div>
  );
}

/**
 * The company profit page's summary card (canvas note spec-fcwide, item 0): the same rows with dividers as a
 * project's profit card, from companySummaryRows. Income is green with "+"; a profit row has a "+", a loss
 * the signal colour with its minus.
 */
export function CompanySummaryCard({ rows, currency }: { rows: readonly SummaryLine[]; currency: string }) {
  return (
    <Card className="ui-pp-card ui-cp-card">
      {rows.map((row) => (
        <SummaryRow
          key={row.id}
          label={row.label}
          strong={row.strong}
          value={row.id === "income"
            ? <Amount agorot={row.minor} currency={currency} income />
            : row.id === "expense"
              ? <Amount agorot={row.minor} currency={currency} />
              : <Amount agorot={row.minor} currency={currency} loss={row.minor < 0n} direction={row.minor > 0n ? "income" : undefined} />}
        />
      ))}
    </Card>
  );
}
