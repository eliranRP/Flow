import { formatAmountText } from "@flow/shared";
import { Fragment, useId, type ReactNode } from "react";
import { List } from "./list-row";
import { groupByMonth, type MonthAmount, type MonthGroup, type MonthTotal } from "./month-groups";

type MonthListProps<T> = {
  rows: readonly T[];
  keyOf: (row: T) => string;
  /** The row's ISO date (doc_date). */
  dateOf: (row: T) => string;
  amountOf: (row: T) => MonthAmount;
  renderRow: (row: T) => ReactNode;
  /** False while more rows may load (paged or capped lists): the last month shows its name only. */
  complete?: boolean;
  className?: string;
};

/**
 * A transaction list with a sticky header per month: the month name, then income (+)
 * and expenses (−) per currency. Lists from a single month render as before. FLOW-302.
 */
export function MonthList<T>({ rows, keyOf, dateOf, amountOf, renderRow, complete = true, className }: MonthListProps<T>) {
  const baseId = useId();
  const groups = groupByMonth(rows, dateOf, amountOf);
  if (groups == null) {
    return <List className={className}>{rows.map((row) => <Fragment key={keyOf(row)}>{renderRow(row)}</Fragment>)}</List>;
  }
  return (
    <List className={className}>
      {groups.map((group, index) => (
        <MonthSection
          key={group.key}
          id={`${baseId}-${group.key}`}
          group={group}
          showTotals={complete || index < groups.length - 1}
          keyOf={keyOf}
          renderRow={renderRow}
        />
      ))}
    </List>
  );
}

function MonthSection<T>({
  id,
  group,
  showTotals,
  keyOf,
  renderRow,
}: {
  id: string;
  group: MonthGroup<T>;
  showTotals: boolean;
  keyOf: (row: T) => string;
  renderRow: (row: T) => ReactNode;
}) {
  return (
    <div className="ui-month" role="group" aria-labelledby={id}>
      <div className="ui-month-head">
        <h2 className="ui-month-title t-title-3" id={id}>{group.title}</h2>
        {showTotals ? (
          <p className="ui-month-totals t-label">
            {group.totals.map((total) => <MonthTotalLine key={total.currency} total={total} />)}
          </p>
        ) : null}
      </div>
      {group.rows.map((row) => <Fragment key={keyOf(row)}>{renderRow(row)}</Fragment>)}
    </div>
  );
}

function MonthTotalLine({ total }: { total: MonthTotal }) {
  const income = total.incomeMinor > 0n ? formatAmountText(total.incomeMinor, total.currency, { direction: "income", plus: true }) : null;
  const expense = total.expenseMinor > 0n ? formatAmountText(total.expenseMinor, total.currency, { direction: "expense" }) : null;
  if (income == null && expense == null) return null;
  return (
    <span className="ui-month-line">
      {income != null ? (
        <span>
          <span className="ui-vh">הכנסות </span>
          <bdi dir="ltr" className="ui-num">{income}</bdi>
        </span>
      ) : null}
      {expense != null ? (
        <span>
          <span className="ui-vh">הוצאות </span>
          <bdi dir="ltr" className="ui-num">{expense}</bdi>
        </span>
      ) : null}
    </span>
  );
}
