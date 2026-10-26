import { useId } from "react";
import { formatAmount } from "./amount";
import { Card } from "./card";
import { Button } from "./button";
import { AlertIcon } from "./icons";

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
 * FLOW-445: a project's budget on its page. "נוצל X מתוך Y", a bar, and what is left (or the overspend).
 * FLOW-961: the bar's empty part is an outline (3:1, not a faint fill); past the budget the bar runs on
 * beyond a tick in the error colour, and the note carries an icon, so the overrun is not colour alone.
 * The edit link opens the project sheet.
 */
export function BudgetCard({ spentMinor, budgetMinor, currency = "ILS", onEdit }: { spentMinor: bigint; budgetMinor: bigint; currency?: string; onEdit?: () => void }) {
  const over = spentMinor > budgetMinor;
  const percent = budgetUsedPercent(spentMinor, budgetMinor);
  const spent = formatAmount(spentMinor, "summary", currency);
  const budget = formatAmount(budgetMinor, "summary", currency);
  // Flex shares of the one bar: the used part, then what is left (outlined) or the overrun past the tick.
  const used = Number(over ? budgetMinor : spentMinor);
  const rest = Number(over ? spentMinor - budgetMinor : budgetMinor - spentMinor);
  return (
    <Card className="ui-budget-card" data-over={over ? "true" : undefined}>
      <div className="ui-budget-head">
        <h2>תקציב</h2>
        {onEdit == null ? null : (
          <Button variant="link" onClick={onEdit}>עריכה</Button>
        )}
      </div>
      <p className="ui-budget-spent">
        נוצל <bdi dir="ltr">{spent}</bdi>{" "}
        <span className="ui-muted">מתוך <bdi dir="ltr">{budget}</bdi></span>
      </p>
      <div className="ui-budget-bar" role="img" aria-label={`נוצל ${spent} מתוך ${budget} · ${String(percent)}%`}>
        {used > 0 ? <span className="ui-budget-fill" style={{ flexGrow: used }} /> : null}
        {over ? <span className="ui-budget-tick" /> : null}
        {rest > 0 ? <span className={over ? "ui-budget-over" : "ui-budget-left"} style={{ flexGrow: rest }} /> : null}
      </div>
      <p className={over ? "ui-budget-note ui-budget-note-over" : "ui-budget-note"}>
        {over ? <AlertIcon size={16} /> : null}
        <span>
          {over
            ? <>חריגה של <bdi dir="ltr">{formatAmount(spentMinor - budgetMinor, "summary", currency)}</bdi> · <bdi dir="ltr">{String(percent)}%</bdi> מהתקציב</>
            : <>נשארו <bdi dir="ltr">{formatAmount(budgetMinor - spentMinor, "summary", currency)}</bdi> · <bdi dir="ltr">{String(percent)}%</bdi></>}
        </span>
      </p>
    </Card>
  );
}

/**
 * FLOW-961: a project with no budget shows, in the budget's place, a dashed card that says what a
 * budget gives and opens the edit sheet at the budget field.
 */
export function BudgetEmptyCard({ onAdd }: { onAdd: () => void }) {
  const titleId = useId();
  return (
    <section className="ui-budget-empty" aria-labelledby={titleId}>
      <h2 id={titleId} className="ui-budget-empty-title">אין תקציב לפרויקט</h2>
      <p className="ui-budget-empty-body">עם תקציב נראה כמה נוצל, ונסמן כשעוברים אותו.</p>
      <Button variant="secondary" onClick={onAdd}>הוספת תקציב</Button>
    </section>
  );
}
