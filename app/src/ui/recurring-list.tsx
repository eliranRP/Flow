import { formatAmountText } from "@flow/shared";
import { useId } from "react";
import { Link } from "react-router-dom";
import { usePreviewSearch } from "../preview";
import { Avatar } from "./avatar";
import { BackButton } from "./back";
import { ClockIcon } from "./icons";
import { cx } from "./cx";
import { SectionHead } from "./layout";
import { BandOfflineLine } from "./band-states";
import { SwipeRow } from "./swipe-row";
import "./css/39-recurring.css";
import "./css/49-recurring-answers.css";

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
  /** A late charge with no suggested match asks whether it still recurs: "לא שולם ב־03/10. עדיין קבוע?". */
  ask?: string;
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
  /** The month's recurring income: what came in and what is still to come. */
  inflow: { total: bigint; got: bigint; toCome: bigint };
  /** The bills late for their month: their own section, above the groups. */
  late: RecurringListRow[];
  groups: RecurringListGroup[];
  /** FLOW-447b: ignoring a late bill, by swipe or by its button. Without it the rows cannot be ignored. */
  onIgnore?: (row: RecurringListRow) => void;
  /** The ask's answers: still recurring (the late alert is set aside), or ended (no longer recurring). */
  onStill?: (row: RecurringListRow) => void;
  onEnded?: (row: RecurringListRow) => void;
  /** The row that opens over its action at first (the dev route's swiped row). */
  openId?: string;
  /** FLOW-963: offline, the moment the rows on screen are from; undefined when online. */
  offlineSince?: number;
};

/** FLOW-986: קבועים is no longer a tab; it opens from Home, so Back goes there ("‹ בית"). */
export function RecurringBack() {
  const search = usePreviewSearch();
  return <BackButton fallback={`/${search}`} text="בית" />;
}

/**
 * FLOW-447: the קבועים list. The card totals this month's income and expenses side by side; the late
 * bills come first, in a tinted box that asks for a decision; then the income groups under "הכנסות
 * קבועות" and the expense groups under "הוצאות קבועות", one group per category. The amounts are
 * formatted here; the rows only say what they are.
 */
export function RecurringList({ project, subtitle, currency, outflow, inflow, late, groups, onIgnore, onStill, onEnded, openId, offlineSince }: RecurringListProps) {
  const money = (minor: bigint) => formatAmountText(minor, currency);
  const lateHead = useId();
  const rowView = (row: RecurringListRow) => (
    <RowView key={row.id} row={row} money={money} onIgnore={onIgnore} onStill={onStill} onEnded={onEnded} defaultOpen={row.id === openId} />
  );
  return (
    <div className="ui-recurring">
      <header className="ui-recurring-head">
        <RecurringBack />
        <h1 className="t-title">קבועים</h1>
        {project != null && <p className="t-sheet">{project}</p>}
        <p className="t-line2">{subtitle}</p>
      </header>
      {offlineSince == null ? null : <BandOfflineLine since={offlineSince} onPage />}
      <section className="ui-card ui-recurring-sums" aria-label="החודש">
        <MonthTakeaway outflow={outflow} inflow={inflow} money={money} />
        <MonthSum label="נכנס החודש" total={`+${money(inflow.total)}`} income done={inflow.got} whole={inflow.total} doneText={`התקבל ${money(inflow.got)}`} leftText={`עוד ${money(inflow.toCome)}`} />
        <MonthSum label="יוצא החודש" total={money(outflow.total)} done={outflow.paid} whole={outflow.total} doneText={`שולם ${money(outflow.paid)}`} leftText={`עוד ${money(outflow.toCome)}`} />
      </section>
      {late.length > 0 && (
        <section className="ui-recurring-late" aria-labelledby={lateHead}>
          <div className="ui-recurring-late-head">
            <span className="ui-recurring-late-icon" aria-hidden="true"><ClockIcon size={18} /></span>
            <div className="ui-recurring-late-text">
              <h2 id={lateHead} className="ui-recurring-late-title">לא הגיעו · {late.length}</h2>
              <span className="ui-recurring-late-lead">היה אמור להגיע עד היום ומחכה להחלטה שלך.</span>
            </div>
          </div>
          <ul className="ui-recurring-rows">{late.map(rowView)}</ul>
        </section>
      )}
      {groups.map((group, index) => (
        <section key={group.id}>
          {index === 0 || groups[index - 1]?.income !== group.income ? (
            <div className={cx("ui-recurring-side", group.income && "ui-recurring-side-income")}>
              <span className="ui-recurring-side-title"><span className="ui-recurring-side-dot" aria-hidden="true" />{group.income ? "הכנסות קבועות" : "הוצאות קבועות"}</span>
              <span className="ui-recurring-side-note">צפוי <bdi dir="ltr">{group.income ? `+${money(inflow.total)}` : money(outflow.total)}</bdi></span>
            </div>
          ) : null}
          <SectionHead title={group.title}>
            <span className="t-line2">
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

/**
 * FLOW-963: the month card leads with what is still to come, "עד סוף החודש: לשלם עוד $962, לקבל עוד
 * $1,650" (data-viz § 9). A side with nothing recurring this month is left out; with neither, no line.
 */
function MonthTakeaway({ outflow, inflow, money }: Pick<RecurringListProps, "outflow" | "inflow"> & { money: (minor: bigint) => string }) {
  const parts = [
    outflow.total > 0n ? { key: "out", words: "לשלם עוד", minor: outflow.toCome } : null,
    inflow.total > 0n ? { key: "in", words: "לקבל עוד", minor: inflow.toCome } : null,
  ].filter((part) => part != null);
  if (parts.length === 0) return null;
  return (
    <p className="ui-recurring-takeaway">
      עד סוף החודש:{" "}
      {parts.map((part, index) => (
        <span key={part.key}>
          {index > 0 ? ", " : null}
          {part.words} <bdi dir="ltr">{money(part.minor)}</bdi>
        </span>
      ))}
    </p>
  );
}

/** One side of the month card: its total, a bar of what is done, and what is done and still to come. */
function MonthSum({ label, total, income = false, done, whole, doneText, leftText }: {
  label: string;
  total: string;
  income?: boolean;
  done: bigint;
  whole: bigint;
  doneText: string;
  leftText: string;
}) {
  return (
    <div className="ui-recurring-sum">
      <p className="ui-recurring-sum-label">{label}</p>
      <bdi dir="ltr" className={cx("ui-recurring-sum-total", income && "ui-recurring-income")}>{total}</bdi>
      <div className="ui-recurring-bar" role="img" aria-label={`${doneText} מתוך ${total.replace(/^\+/, "")}`}>
        <span style={{ width: barWidth(done, whole) }} />
      </div>
      <p className="ui-recurring-sum-note"><span>{doneText}</span><span>{leftText}</span></p>
    </div>
  );
}

function RowView({
  row,
  money,
  onIgnore,
  onStill,
  onEnded,
  defaultOpen,
}: {
  row: RecurringListRow;
  money: (minor: bigint) => string;
  onIgnore?: (row: RecurringListRow) => void;
  onStill?: (row: RecurringListRow) => void;
  onEnded?: (row: RecurringListRow) => void;
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
          {row.income ? "+" : ""}
          {money(row.minor)}
        </span>
        {row.hint != null && <span className={cx("t-line2", row.alert && "ui-recurring-alert")}>{row.hint}</span>}
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
      {row.ask != null && onStill != null && onEnded != null ? (
        <div className="ui-recurring-ask">
          <p className="ui-recurring-ask-text">{row.ask}</p>
          <div className="ui-recurring-match-actions">
            <button type="button" className="ui-recurring-match-yes ui-hit" onClick={() => { onStill(row); }}>כן, עדיין קבוע</button>
            <button type="button" className="ui-recurring-match-no ui-hit" onClick={() => { onEnded(row); }}>הסתיים</button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** The name, and under it the project or the category; a late bill with a suggestion says so instead. */
function RowName({ row }: { row: RecurringListRow }) {
  return (
    <>
      <span className="ui-recurring-title">{row.name}</span>
      {row.suggestion != null ? (
        <span className="t-line2 ui-recurring-suggest">אולי הגיע בשם אחר</span>
      ) : (
        row.place != null && <span className="t-line2">{row.place}</span>
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
