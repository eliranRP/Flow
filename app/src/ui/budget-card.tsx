import { formatAmount } from "./amount";
import { Card } from "./card";
import { TextLink } from "./text-link";

/**
 * The share of the budget spent, to the nearest whole percent (the card's "N%"). Under the budget it
 * stops at 99, so 100% only shows once the budget is reached.
 */
export function budgetUsedPercent(spentMinor: bigint, budgetMinor: bigint): number {
  if (budgetMinor <= 0n) return 0;
  const rounded = Number((spentMinor * 100n + budgetMinor / 2n) / budgetMinor);
  return spentMinor < budgetMinor ? Math.min(99, rounded) : rounded;
}

/**
 * FLOW-445: a project's budget on its page. "נוצל X מתוך Y", a thin bar that turns signal when the
 * spend passes the budget, and what is left (or the overspend). The edit link opens the project sheet.
 */
export function BudgetCard({ spentMinor, budgetMinor, currency = "ILS", onEdit }: { spentMinor: bigint; budgetMinor: bigint; currency?: string; onEdit?: () => void }) {
  const over = spentMinor > budgetMinor;
  const fill = budgetMinor <= 0n ? 0 : Math.min(100, Number((spentMinor * 10_000n) / budgetMinor) / 100);
  const percent = budgetUsedPercent(spentMinor, budgetMinor);
  return (
    <Card className="ui-budget-card" data-over={over ? "true" : undefined}>
      <div className="ui-budget-head">
        <h2>תקציב</h2>
        {onEdit == null ? null : (
          <TextLink tone="accent" chevron={false} onClick={onEdit}>עריכה</TextLink>
        )}
      </div>
      <p className="ui-budget-spent">
        נוצל <bdi dir="ltr">{formatAmount(spentMinor, "summary", currency)}</bdi>{" "}
        <span className="ui-muted">מתוך <bdi dir="ltr">{formatAmount(budgetMinor, "summary", currency)}</bdi></span>
      </p>
      <div className="ui-budget-bar" aria-hidden="true">
        <span className={over ? "ui-budget-fill ui-budget-fill-over" : "ui-budget-fill"} style={{ width: `${String(over ? 100 : fill)}%` }} />
      </div>
      <p className={over ? "ui-budget-note ui-budget-note-over" : "ui-budget-note"}>
        {over
          ? <>חריגה של <bdi dir="ltr">{formatAmount(spentMinor - budgetMinor, "summary", currency)}</bdi></>
          : <>נשארו <bdi dir="ltr">{formatAmount(budgetMinor - spentMinor, "summary", currency)}</bdi> · <bdi dir="ltr">{String(percent)}%</bdi></>}
      </p>
    </Card>
  );
}
