import { formatAmountText } from "@flow/shared";
import { Avatar } from "./avatar";
import { cx } from "./cx";
import { SectionHead } from "./layout";
import "./css/39-recurring.css";

/** One charge on the list, as the screen shows it: its amount is already formatted. */
export type RecurringListRow = {
  id: string;
  name: string;
  /** "project · category", or the one of them the charge has; null for neither. */
  place: string | null;
  income: boolean;
  /** Paid this month: the primary text. Not paid yet: grey. */
  paid: boolean;
  minor: bigint;
  /** "באיחור N ימים" for a late bill, or "▲ N%" for a change of 20% or more. */
  hint?: string;
  /** A bad-news hint, drawn in the danger colour. */
  alert?: boolean;
};

export type RecurringListGroup = {
  id: string;
  title: string;
  income: boolean;
  /** The group's monthly cost, shown on the head as "לחודש". */
  monthlyMinor: bigint;
  rows: RecurringListRow[];
};

export type RecurringListProps = {
  /** "אוקטובר 2026 • 15 קבועים". */
  subtitle: string;
  currency: string;
  outflow: { total: bigint; paid: bigint; toCome: bigint };
  /** The bills late for their month: their own section, above the groups. */
  late: RecurringListRow[];
  groups: RecurringListGroup[];
};

/**
 * FLOW-447: the קבועים list. The outflow card totals this month's expenses, the late bills come first,
 * then one group per category. The amounts are formatted here; the rows only say what they are.
 */
export function RecurringList({ subtitle, currency, outflow, late, groups }: RecurringListProps) {
  const money = (minor: bigint) => formatAmountText(minor, currency);
  return (
    <div className="ui-recurring">
      <header className="ui-recurring-head">
        <h1 className="t-display">קבועים</h1>
        <p className="t-label">{subtitle}</p>
      </header>
      <section className="ui-card ui-recurring-outflow" aria-label="יוצא החודש">
        <p className="t-label">יוצא החודש</p>
        <p className="t-display">{money(outflow.total)}</p>
        <div className="ui-recurring-bar" role="img" aria-label={`שולם ${money(outflow.paid)}`}>
          <span style={{ width: barWidth(outflow.paid, outflow.total) }} />
        </div>
        <p className="t-label">עוד {money(outflow.toCome)} עד סוף החודש</p>
      </section>
      {late.length > 0 && (
        <section>
          <SectionHead title="לא הגיעו">
            <span className="t-label">{late.length}</span>
          </SectionHead>
          <ul className="ui-recurring-rows">
            {late.map((row) => (
              <RowView key={row.id} row={row} money={money} />
            ))}
          </ul>
        </section>
      )}
      {groups.map((group) => (
        <section key={group.id}>
          <SectionHead title={group.title}>
            <span className="t-label">
              {group.income ? "+" : ""}
              {money(group.monthlyMinor)} לחודש
            </span>
          </SectionHead>
          <ul className="ui-recurring-rows">
            {group.rows.map((row) => (
              <RowView key={row.id} row={row} money={money} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function RowView({ row, money }: { row: RecurringListRow; money: (minor: bigint) => string }) {
  return (
    <li className={cx("ui-recurring-row", !row.paid && "ui-recurring-row-open")}>
      <Avatar name={row.name} fallback="person" />
      <span className="ui-recurring-name">
        <span className="ui-recurring-title">{row.name}</span>
        {row.place != null && <span className="t-label">{row.place}</span>}
      </span>
      <span className="ui-recurring-amount">
        <span className={cx(row.income && row.paid && "ui-recurring-income")}>
          {row.income ? "+" : ""}
          {money(row.minor)}
        </span>
        {row.hint != null && <span className={cx("t-label", row.alert && "ui-recurring-alert")}>{row.hint}</span>}
      </span>
    </li>
  );
}

/** The paid share of the month's outflow, as a width; an empty month shows an empty bar. */
function barWidth(paid: bigint, total: bigint): string {
  if (total <= 0n) return "0%";
  return `${String(Number((paid * 10000n) / total) / 100)}%`;
}
