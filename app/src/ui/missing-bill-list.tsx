import { formatAmountText } from "@flow/shared";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApproxAmount, approxAmountText } from "./approx-amount";
import { Button } from "./button";
import { cx } from "./cx";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { CheckIcon, ChevronIcon } from "./icons";
import { SectionHead } from "./layout";
import { List } from "./list-row";
import type { ScreenPhase } from "./screen-phase";
import { ListSkeleton } from "./skeleton";
import { SwipeRemove } from "./swipe-remove";
import { TextLink } from "./text-link";
import "./css/39-missing-bills.css";

export type MissingBillRow = {
  id: string;
  name: string;
  /** FLOW-415 (b-2): late income, drawn in income green. */
  income?: boolean;
  /** FLOW-415: "project · category", or null when the bill files to neither. */
  place: string | null;
  /** FLOW-415: "כל חודש ב־2 · אחרון 02/09". */
  usual: string;
  /** The typical amount, unsigned. */
  minor: bigint;
  currency: string;
  /** Search, filtered to the party. */
  href: string;
  /** FLOW-415 (owner, 08:41Z): set when this user can hide the row. */
  alertKey?: string | null;
  /** FLOW-430: a supplier (or customer) that may be this one under another name. */
  match?: MissingBillMatchHint | null;
};

/** FLOW-430: the suggested name, its newest line's amount ("$57.79") and date ("06/10"). */
export type MissingBillMatchHint = { name: string; amount: string; date: string };

export type ArrivedRow = {
  id: string;
  name: string;
  income?: boolean;
  place: string | null;
  /** This month's amount, unsigned. */
  minor: bigint;
  currency: string;
  /** Signed whole percent off the usual amount; null when there is no change to show. */
  changePercent: number | null;
  /** The change is bad news (an expense up, or income down): red, else green. */
  worse: boolean;
  alertKey?: string | null;
  /** The payment's page. */
  href: string;
};

export type RecurringSection = "late" | "arrived";

/** The section's anchor, for Home's rows (`/missing-bills#arrived`). */
export const SECTION_ID: Record<RecurringSection, string> = { late: "late", arrived: "arrived" };

/**
 * One row the user can close for themselves (FLOW-415, owner 08:41Z; FLOW-913, owner 16:05Z: it is a
 * dismiss, so "סגירה"): a swipe toward the start over "סגירה", and, while the list is in "עריכה", an
 * accent "סגירה" (44px) in place of the chevron. `peek` slides the row once to show the swipe.
 */
function HideableRow({ name, onHide, editing, peek, children }: { name: string; onHide?: () => void; editing: boolean; peek: boolean; children: ReactNode }) {
  if (onHide == null) return <div className="ui-recurring-row">{children}</div>;
  return (
    <SwipeRemove label="סגירה" onRemove={onHide} peek={peek}>
      <div className="ui-recurring-row">
        {children}
        {editing ? (
          <TextLink className="ui-recurring-hide" chevron={false} label={`סגירה, ${name}`} onClick={onHide}>
            סגירה
          </TextLink>
        ) : null}
      </div>
    </SwipeRemove>
  );
}

function RowChevron({ hidden }: { hidden: boolean }) {
  if (hidden) return null;
  return (
    <span className="ui-row-chevron" aria-hidden="true">
      <ChevronIcon />
    </span>
  );
}

/**
 * FLOW-430 (owner, 2026-10-10): "אולי זה: <name> · <amount> · dd/mm" under a late row, and the user
 * decides. Nothing merges by itself: "כן" counts that party's bills as this one's, "לא" stops the hint.
 */
function MatchHint({ match, income, onAnswer }: { match: MissingBillMatchHint; income?: boolean; onAnswer: (same: boolean) => void }) {
  const same = income ? "כן, אותו לקוח" : "כן, אותו ספק";
  return (
    <div className="ui-missing-match" role="group" aria-label={`אולי זה: ${match.name}`}>
      {/* One line of whole parts: the date drops first, then the amount; a long name ends in "…". */}
      <span className="ui-row-hint ui-missing-match-text">
        <span className="ui-hint-parts">
          <span className="ui-hint-part" data-clip-ok="">
            {"אולי זה: "}
            <bdi>{match.name}</bdi>
          </span>
          <span className="ui-hint-part ui-missing-match-whole">
            {" · "}
            <bdi dir="ltr" className="ui-num">{match.amount}</bdi>
          </span>
          <span className="ui-hint-part ui-missing-match-whole">
            {" · "}
            <bdi dir="ltr">{match.date}</bdi>
          </span>
        </span>
      </span>
      <span className="ui-missing-match-actions">
        <Button variant="pill" aria-label={`${same}: ${match.name}`} onClick={() => { onAnswer(true); }}>{same}</Button>
        <Button variant="pill" className="ui-missing-match-no" aria-label={`לא, ${match.name} הוא לא אותו אחד`} onClick={() => { onAnswer(false); }}>לא</Button>
      </span>
    </div>
  );
}

function changeText(percent: number): string {
  return `${String(Math.abs(percent))}% ${percent < 0 ? "▼" : "▲"}`;
}

function changeWords(percent: number): string {
  return `${percent < 0 ? "ירידה" : "עלייה"} של ${String(Math.abs(percent))}%`;
}

/**
 * FLOW-415 (owner 08:43Z, frame b-2): the קבועים screen's list. "לא הגיעו", the recurring suppliers
 * and customers whose payment for the month is late (a tap opens Search on the party), then
 * "הגיעו החודש", every recurring party seen this month, with ▲/▼ % on a change of 20% or more (a tap
 * opens the payment, or Search when several lines make the amount). FLOW-913 (owner 16:03Z, layout
 * A): one line per row, the name and the amount, no hint lines. A late row and a change can be
 * hidden for this user, by swipe or by "סגירה" while `editing`; a late row comes back next month.
 */
export function MissingBillList({
  rows,
  arrived = [],
  phase = { kind: "ready" },
  onRetry,
  onHide,
  editing = false,
  peek = false,
  onMatch,
}: {
  rows: readonly MissingBillRow[];
  arrived?: readonly ArrivedRow[];
  phase?: ScreenPhase;
  onRetry?: () => void;
  onHide?: (kind: "missing" | "change", key: string, name: string) => void;
  /** "עריכה" is on: each row that can close ends in "סגירה" instead of the chevron. */
  editing?: boolean;
  /** The first row that can close slides once to show its swipe (the screen's first visit). */
  peek?: boolean;
  /** FLOW-430: the user's answer to a row's suggestion. */
  onMatch?: (rowId: string, same: boolean) => void;
}) {
  if (phase.kind === "loading") return <ListSkeleton />;
  if (phase.kind === "error") return <ErrorState offline={phase.offline} onRetry={() => { onRetry?.(); }} />;
  if (phase.kind === "empty" || (rows.length === 0 && arrived.length === 0)) {
    return <EmptyState icon={<CheckIcon />} title="הכל הגיע" body="אין תשלומים קבועים שמאחרים החודש." />;
  }
  const hide = (kind: "missing" | "change", key: string | null | undefined, name: string) =>
    onHide == null || key == null ? undefined : () => { onHide(kind, key, name); };
  const peekId = peek && onHide != null ? [...rows, ...arrived].find((row) => row.alertKey != null)?.id : undefined;
  return (
    <>
      {rows.length > 0 ? (
        <section id={SECTION_ID.late} aria-label="לא הגיעו" className="ui-recurring-section">
          <SectionHead title="לא הגיעו" />
          <List className="ui-missing-bills">
            {rows.map((row) => {
              const onRowHide = hide("missing", row.alertKey, row.name);
              return (
                <div key={row.id} className="ui-missing-item">
                <HideableRow name={row.name} onHide={onRowHide} editing={editing} peek={row.id === peekId}>
                  <Link
                    to={row.href}
                    className="ui-row ui-hit"
                    aria-label={[row.name, row.place, row.usual, approxAmountText(row.minor, row.currency)].filter((part) => part != null).join(", ")}
                  >
                    <span className="ui-row-main">
                      <span className="ui-row-text">
                        <span className="ui-row-title">{row.name}</span>
                      </span>
                    </span>
                    <ApproxAmount minor={row.minor} currency={row.currency} income={row.income} />
                    <RowChevron hidden={editing && onRowHide != null} />
                  </Link>
                </HideableRow>
                {row.match != null && onMatch != null ? (
                  <MatchHint match={row.match} income={row.income} onAnswer={(same) => { onMatch(row.id, same); }} />
                ) : null}
                </div>
              );
            })}
          </List>
        </section>
      ) : null}
      {arrived.length > 0 ? (
        <section id={SECTION_ID.arrived} aria-label="הגיעו החודש" className="ui-recurring-section">
          <SectionHead title="הגיעו החודש" />
          <List className="ui-missing-bills">
            {arrived.map((row) => {
              const amount = formatAmountText(row.minor, row.currency);
              const onRowHide = hide("change", row.alertKey, row.name);
              return (
                <HideableRow key={row.id} name={row.name} onHide={onRowHide} editing={editing} peek={row.id === peekId}>
                  <Link
                    to={row.href}
                    className="ui-row ui-hit"
                    aria-label={[row.name, row.place, row.income ? `הכנסה ${amount}` : amount, row.changePercent == null ? null : changeWords(row.changePercent)]
                      .filter((part) => part != null)
                      .join(", ")}
                  >
                    <span className="ui-row-main">
                      <span className="ui-row-text">
                        <span className="ui-row-title">{row.name}</span>
                      </span>
                    </span>
                    <span className="ui-recurring-amount">
                      <bdi dir="ltr" className={cx("t-amount ui-num", row.income && "ui-approx-income")}>{amount}</bdi>
                      {row.changePercent == null ? null : (
                        <span className={cx("t-label ui-recurring-change", row.worse ? "ui-delta-bad" : "ui-delta-good")}>
                          <bdi dir="ltr">{changeText(row.changePercent)}</bdi>
                        </span>
                      )}
                    </span>
                    <RowChevron hidden={editing && onRowHide != null} />
                  </Link>
                </HideableRow>
              );
            })}
          </List>
        </section>
      ) : null}
    </>
  );
}

/** FLOW-913: true when any row can be hidden, so the screen offers "עריכה". */
export function canHideAny(rows: readonly MissingBillRow[], arrived: readonly ArrivedRow[]): boolean {
  return rows.some((row) => row.alertKey != null) || arrived.some((row) => row.alertKey != null);
}
