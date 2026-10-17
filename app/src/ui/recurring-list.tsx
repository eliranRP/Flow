import { formatAmountText } from "@flow/shared";
import { Link } from "react-router-dom";
import { Avatar } from "./avatar";
import { cx } from "./cx";
import { SectionHead } from "./layout";
import { SwipeRow } from "./swipe-row";
import "./css/39-recurring.css";

/** The suggested party a late bill may be (decision 0179), as the list shows it. */
export type RecurringListSuggestion = {
  name: string;
  partyId: string;
  /** The suggested bill's amount. */
  minor: bigint;
  /** The bill's day, "dd/mm". */
  date: string;
};

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
  /** FLOW-447b: the key an ignore takes, for a late bill that still alerts; null when unknown. */
  alertKey?: string | null;
  /** FLOW-447b: a late bill that may be another party under another name. */
  suggestion?: RecurringListSuggestion | null;
  /** FLOW-447c: where the row opens, the party's charge page. */
  href: string;
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
  /** The project the list is narrowed to, named under the title. */
  project?: string;
  /** "אוקטובר 2026 • 15 קבועים". */
  subtitle: string;
  currency: string;
  outflow: { total: bigint; paid: bigint; toCome: bigint };
  /** The bills late for their month: their own section, above the groups. */
  late: RecurringListRow[];
  groups: RecurringListGroup[];
  /** FLOW-447b: ignoring a late bill, by swipe or by its button. Without it the rows cannot be ignored. */
  onIgnore?: (row: RecurringListRow) => void;
  /** The row that opens over its action at first (the dev route's swiped row). */
  openId?: string;
};

/**
 * FLOW-447: the קבועים list. The outflow card totals this month's expenses, the late bills come first,
 * then one group per category. The amounts are formatted here; the rows only say what they are.
 */
export function RecurringList({ project, subtitle, currency, outflow, late, groups, onIgnore, openId }: RecurringListProps) {
  const money = (minor: bigint) => formatAmountText(minor, currency);
  const rowView = (row: RecurringListRow) => (
    <RowView key={row.id} row={row} money={money} onIgnore={onIgnore} defaultOpen={row.id === openId} />
  );
  return (
    <div className="ui-recurring">
      <header className="ui-recurring-head">
        <h1 className="t-display">קבועים</h1>
        {project != null && <p className="t-heading">{project}</p>}
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
          <ul className="ui-recurring-rows">{late.map(rowView)}</ul>
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
          <ul className="ui-recurring-rows">{group.rows.map(rowView)}</ul>
        </section>
      ))}
    </div>
  );
}

function RowView({
  row,
  money,
  onIgnore,
  defaultOpen,
}: {
  row: RecurringListRow;
  money: (minor: bigint) => string;
  onIgnore?: (row: RecurringListRow) => void;
  defaultOpen: boolean;
}) {
  // An active late bill can be ignored: by the swipe, and by a button that is hidden until it has focus.
  const ignorable = row.alertKey != null && onIgnore != null;
  // The whole row opens the charge's page (FLOW-447c); the ignore control stays outside that link.
  const className = cx("ui-recurring-row", !row.paid && "ui-recurring-row-open");
  const inner = (
    <>
      <Avatar name={row.name} fallback="person" single />
      <span className="ui-recurring-name">
        <RowName row={row} />
      </span>
      <span className="ui-recurring-amount">
        <span className={cx(row.income && row.paid && "ui-recurring-income")}>
          {row.income && row.paid ? "+" : ""}
          {money(row.minor)}
        </span>
        {row.hint != null && <span className={cx("t-label", row.alert && "ui-recurring-alert")}>{row.hint}</span>}
      </span>
    </>
  );
  const body = (
    <Link className={className} to={row.href}>
      {inner}
    </Link>
  );
  return (
    <li className="ui-recurring-item">
      {ignorable && (
        <button type="button" className="ui-recurring-ignore" aria-label={`התעלמות מההתראה: ${row.name}`} onClick={() => {
            onIgnore(row);
          }}>
          התעלמות מההתראה
        </button>
      )}
      {ignorable ? (
        <SwipeRow reveal={{ label: "התעלמות מההתראה", onAct: () => {
            onIgnore(row);
          } }} onRemove={noop} defaultOpen={defaultOpen}>
          {body}
        </SwipeRow>
      ) : (
        body
      )}
    </li>
  );
}

/** The name, and under it the project or the category; a late bill with a suggestion says so instead. */
function RowName({ row }: { row: RecurringListRow }) {
  return (
    <>
      <span className="ui-recurring-title">{row.name}</span>
      {row.suggestion != null ? (
        <span className="t-label ui-recurring-suggest">אולי הגיע בשם אחר</span>
      ) : (
        row.place != null && <span className="t-label">{row.place}</span>
      )}
    </>
  );
}

function noop() {
  // A reveal row is removed only by its action, never by a swipe.
}

/** The paid share of the month's outflow, as a width; an empty month shows an empty bar. */
function barWidth(paid: bigint, total: bigint): string {
  if (total <= 0n) return "0%";
  return `${String(Number((paid * 10000n) / total) / 100)}%`;
}
