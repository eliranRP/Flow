import { formatAmountText } from "@flow/shared";
import { Fragment, useId, type ReactNode } from "react";
import { withCents } from "./big-number";
import { List } from "./list-row";
import { groupByDay, groupByMonth, type MonthAmount, type MonthGroup, type MonthTotal } from "./month-groups";

type MonthListProps<T> = {
  rows: readonly T[];
  keyOf: (row: T) => string;
  /** The row's ISO date (doc_date). */
  dateOf: (row: T) => string;
  amountOf: (row: T) => MonthAmount;
  renderRow: (row: T) => ReactNode;
  /** False while more rows may load (paged or capped lists): the last month shows its name only. */
  complete?: boolean;
  /** Quiet day heads (היום, אתמול, יום ב׳ · 05/10) inside each month, and in a one-month list. FLOW-305. */
  days?: boolean;
  /** The rows show cents, so the month totals add exact minor units and show cents too. FLOW-305. */
  cents?: boolean;
  className?: string;
};

/**
 * A transaction list with a sticky header per month: the month name, then income (+)
 * and expenses (−) per currency. Lists from a single month render as before. FLOW-302.
 * With `days`, each month (or the single-month list) also gets quiet day heads. FLOW-305.
 */
export function MonthList<T>({
  rows,
  keyOf,
  dateOf,
  amountOf,
  renderRow,
  complete = true,
  days = false,
  cents = false,
  className,
}: MonthListProps<T>) {
  const baseId = useId();
  const groups = groupByMonth(rows, dateOf, amountOf, cents);
  if (groups == null) {
    return (
      <List className={className}>
        <Rows rows={rows} keyOf={keyOf} dateOf={dateOf} renderRow={renderRow} days={days} />
      </List>
    );
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
          dateOf={dateOf}
          renderRow={renderRow}
          days={days}
          cents={cents}
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
  dateOf,
  renderRow,
  days,
  cents,
}: {
  id: string;
  group: MonthGroup<T>;
  showTotals: boolean;
  keyOf: (row: T) => string;
  dateOf: (row: T) => string;
  renderRow: (row: T) => ReactNode;
  days: boolean;
  cents: boolean;
}) {
  return (
    <div className="ui-month" role="group" aria-labelledby={id}>
      <div className="ui-month-head">
        <h2 className="ui-month-title t-heading" id={id}>{group.title}</h2>
        {showTotals ? (
          <p className="ui-month-totals t-label">
            {group.totals.map((total) => <MonthTotalLine key={total.currency} total={total} cents={cents} />)}
          </p>
        ) : null}
      </div>
      <Rows rows={group.rows} keyOf={keyOf} dateOf={dateOf} renderRow={renderRow} days={days} />
    </div>
  );
}

/** The rows, under quiet day heads when `days` is set. Day heads are h3 under the month's h2. */
function Rows<T>({
  rows,
  keyOf,
  dateOf,
  renderRow,
  days,
}: {
  rows: readonly T[];
  keyOf: (row: T) => string;
  dateOf: (row: T) => string;
  renderRow: (row: T) => ReactNode;
  days: boolean;
}) {
  const dayGroups = days ? groupByDay(rows, dateOf) : null;
  if (dayGroups == null) return <>{rows.map((row) => <Fragment key={keyOf(row)}>{renderRow(row)}</Fragment>)}</>;
  return (
    <>
      {dayGroups.map((day) => (
        <Fragment key={day.key}>
          <h3 className="ui-day-head">{day.title}</h3>
          {day.rows.map((row) => <Fragment key={keyOf(row)}>{renderRow(row)}</Fragment>)}
        </Fragment>
      ))}
    </>
  );
}

function MonthTotalLine({ total, cents }: { total: MonthTotal; cents: boolean }) {
  const text = (minor: bigint, direction: "income" | "expense") => {
    const formatted = formatAmountText(minor, total.currency, { direction, detail: cents });
    return cents ? withCents(formatted) : formatted;
  };
  const income = total.incomeMinor > 0n ? text(total.incomeMinor, "income") : null;
  const expense = total.expenseMinor > 0n ? text(total.expenseMinor, "expense") : null;
  if (income == null && expense == null) return null;
  return (
    <span className="ui-month-line">
      {income != null ? (
        <span>
          <span className="sr-only">הכנסות </span>
          <bdi dir="ltr" className="ui-num ui-income">{income}</bdi>
        </span>
      ) : null}
      {expense != null ? (
        <span>
          <span className="sr-only">הוצאות </span>
          <bdi dir="ltr" className="ui-num">{expense}</bdi>
        </span>
      ) : null}
    </span>
  );
}
