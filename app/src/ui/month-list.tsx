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
  /** The list is titled as a cost (a category's lines): expense totals carry no minus (DESIGN-RULES §3.7, FLOW-339). */
  cost?: boolean;
  /**
   * One labeled figure per month: "נטו ₪13,206" (income minus expenses, − only when negative), and
   * each other currency on a muted line under it ("ועוד −$429.90 בדולר"). Never converted (FLOW-504).
   * Real agorot only, no ".00". Search, option C (FLOW-339).
   */
  net?: boolean;
};

/**
 * A transaction list with a sticky header per month: the month name, then income (+)
 * and expenses (−) per currency. Lists from a single month render as before. FLOW-302.
 * With `days`, each month (or the single-month list) also gets quiet day heads. FLOW-305.
 * The flat list is one headless section keyed by its first month, so a second month loading
 * keeps the first month's rows (and a focused row) mounted (FLOW-313).
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
  cost = false,
  net = false,
}: MonthListProps<T>) {
  const baseId = useId();
  const groups = groupByMonth(rows, dateOf, amountOf, cents);
  if (groups == null) {
    const first = rows[0];
    const flat: MonthGroup<T> = { key: first == null ? "" : monthKey(dateOf(first)), title: "", rows: [...rows], totals: [] };
    return (
      <List>
        {[
          <MonthSection
            key={flat.key}
            id={`${baseId}-${flat.key}`}
            group={flat}
            head={false}
            showTotals={false}
            keyOf={keyOf}
            dateOf={dateOf}
            renderRow={renderRow}
            days={days}
            cents={cents}
          />,
        ]}
      </List>
    );
  }
  return (
    <List>
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
          cost={cost}
          net={net}
        />
      ))}
    </List>
  );
}

/**
 * A transaction list under one sticky head per group (FLOW-334: שויכו היום by project). The head is
 * the month head's shape: the group's name, then its line count and its income and expenses per
 * currency. The caller groups (`groupByKey`), so it can step through the rows in the order drawn.
 */
export function GroupList<T>({
  groups,
  keyOf,
  dateOf,
  renderRow,
  countOf,
  cents = false,
}: {
  groups: readonly MonthGroup<T>[];
  keyOf: (row: T) => string;
  dateOf: (row: T) => string;
  renderRow: (row: T) => ReactNode;
  /** The group's line count in words ("3 תנועות"). */
  countOf: (count: number) => string;
  cents?: boolean;
}) {
  const baseId = useId();
  return (
    <List>
      {groups.map((group, index) => (
        <MonthSection
          key={group.key}
          id={`${baseId}-${String(index)}`}
          group={group}
          count={countOf(group.rows.length)}
          showTotals
          keyOf={keyOf}
          dateOf={dateOf}
          renderRow={renderRow}
          days={false}
          cents={cents}
        />
      ))}
    </List>
  );
}

/** The month a row belongs to, as groupByMonth keys it; "" when the date can't be read. */
function monthKey(date: string): string {
  return /^\d{4}-\d{2}/.exec(date)?.[0] ?? "";
}

function MonthSection<T>({
  id,
  group,
  head = true,
  count,
  showTotals,
  keyOf,
  dateOf,
  renderRow,
  days,
  cents,
  cost = false,
  net = false,
}: {
  id: string;
  group: MonthGroup<T>;
  /** False for the flat list: no month name or totals, and no group role. */
  head?: boolean;
  /** A group head (GroupList) leads its figures with the line count, and its name may wrap. */
  count?: string;
  showTotals: boolean;
  keyOf: (row: T) => string;
  dateOf: (row: T) => string;
  renderRow: (row: T) => ReactNode;
  days: boolean;
  cents: boolean;
  cost?: boolean;
  net?: boolean;
}) {
  // A currency that rounds to zero draws no line, so it can't take the first slot.
  const shown = group.totals.filter((total) => total.incomeMinor > 0n || total.expenseMinor > 0n);
  return (
    <div className="ui-month" role={head ? "group" : undefined} aria-labelledby={head ? id : undefined}>
      {head ? (
        <div className={count == null ? "ui-month-head" : "ui-month-head ui-group-head"}>
          <h2 className={count == null ? "ui-month-title t-heading" : "ui-month-title ui-group-title t-heading"} id={id}>{group.title}</h2>
          {showTotals && net && shown.length > 0 ? <MonthNet totals={shown} /> : null}
          {showTotals && !net ? (
            <p className="ui-month-totals t-label">
              {count != null ? <span className="ui-group-count">{count}</span> : null}
              {shown.map((total, index) => <MonthTotalLine key={total.currency} total={total} cents={cents} cost={cost} first={index === 0 && count == null} />)}
            </p>
          ) : null}
        </div>
      ) : null}
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

const CURRENCY_WORD: Record<string, string> = { ILS: "בשקלים", USD: "בדולר", EUR: "באירו" };

function netText(total: MonthTotal): string {
  return formatAmountText(total.incomeMinor - total.expenseMinor, total.currency, { detail: true });
}

/** The month's net, labeled, in the first currency; each other currency on a muted line under it. */
function MonthNet({ totals }: { totals: readonly MonthTotal[] }) {
  const [first, ...rest] = totals;
  if (first == null) return null;
  return (
    <>
      <p className="ui-month-totals t-label">
        <span className="ui-month-line">
          נטו <bdi dir="ltr" className="ui-num">{netText(first)}</bdi>
        </span>
      </p>
      {rest.map((total) => (
        <p key={total.currency} className="ui-month-more t-hint">
          {"ועוד "}
          <bdi dir="ltr" className="ui-num">{netText(total)}</bdi>
          {` ${CURRENCY_WORD[total.currency] ?? `ב־${total.currency}`}`}
        </p>
      ))}
    </>
  );
}

/**
 * One currency's figures. A screen reader hears ", " before every figure but the first, so the
 * figures don't run together (FLOW-313). The pause leads the hidden label rather than trailing the
 * figure, so it adds no width past the figure's box.
 */
function MonthTotalLine({ total, cents, cost, first }: { total: MonthTotal; cents: boolean; cost: boolean; first: boolean }) {
  const text = (minor: bigint, direction: "income" | "expense") => {
    // In a cost list the expense figure is the list's own subject, so it needs no minus.
    const formatted = formatAmountText(minor, total.currency, { direction: cost && direction === "expense" ? undefined : direction, detail: cents });
    return cents ? withCents(formatted) : formatted;
  };
  const income = total.incomeMinor > 0n ? text(total.incomeMinor, "income") : null;
  const expense = total.expenseMinor > 0n ? text(total.expenseMinor, "expense") : null;
  if (income == null && expense == null) return null;
  return (
    <span className="ui-month-line">
      {income != null ? (
        <span>
          <span className="sr-only">{first ? "" : ", "}הכנסות </span>
          <bdi dir="ltr" className="ui-num ui-income">{income}</bdi>
        </span>
      ) : null}
      {expense != null ? (
        <span>
          <span className="sr-only">{first && income == null ? "" : ", "}הוצאות </span>
          <bdi dir="ltr" className="ui-num">{expense}</bdi>
        </span>
      ) : null}
    </span>
  );
}
