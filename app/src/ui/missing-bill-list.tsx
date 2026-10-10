import { formatAmountText } from "@flow/shared";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApproxAmount, approxAmountText } from "./approx-amount";
import { Button } from "./button";
import { cx } from "./cx";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { IconButton } from "./icon-button";
import { CheckIcon, ChevronIcon, CloseIcon } from "./icons";
import { SectionHead } from "./layout";
import { List } from "./list-row";
import type { ScreenPhase } from "./screen-phase";
import { ListSkeleton } from "./skeleton";
import { SwipeRemove } from "./swipe-remove";

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
 * One row with an optional "הסתרה": a muted 44px ✕ at the row's end, and a swipe toward the start
 * that does the same (FLOW-415, owner 08:41Z). The hide is this user's only. A row with nothing to
 * hide keeps the ✕'s place empty when its list can hide, so the amounts stay in one column.
 */
function HideableRow({ name, onHide, reserve = false, children }: { name: string; onHide?: () => void; reserve?: boolean; children: ReactNode }) {
  if (onHide == null) {
    return (
      <div className="ui-recurring-row">
        {children}
        {reserve ? <span className="ui-recurring-hide-space" aria-hidden="true" /> : null}
      </div>
    );
  }
  return (
    <SwipeRemove label="הסתרה" onRemove={onHide}>
      <div className="ui-recurring-row">
        {children}
        <IconButton className="ui-recurring-hide" label={`הסתרה, ${name}`} onClick={onHide}>
          <CloseIcon size={18} />
        </IconButton>
      </div>
    </SwipeRemove>
  );
}

/**
 * The place line (design lead, FLOW-420 item 3): one line, "project · category". Only the project
 * ends in an ellipsis; "· category" stays whole.
 */
function PlaceLine({ place }: { place: string }) {
  const [head, ...rest] = place.split(" · ");
  return (
    <span className="ui-row-hint ui-place-line">
      <span className="ui-place-head" data-clip-ok="">{head}</span>
      {rest.length > 0 ? <span className="ui-place-tail">{` · ${rest.join(" · ")}`}</span> : null}
    </span>
  );
}

/**
 * The pace line (FLOW-124): one line of whole parts. A part that does not fit drops with its "·"
 * ("אחרון dd/mm" first), so at 320 it reads "כל חודש ב־2".
 */
function PaceLine({ text }: { text: string }) {
  return (
    <span className="ui-row-hint">
      <span className="ui-hint-parts">
        {text.split(" · ").map((part, index) => (
          <span key={part} className="ui-hint-part" data-clip-ok="">
            {index > 0 ? " · " : null}
            {part}
          </span>
        ))}
      </span>
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
      <span className="ui-row-hint ui-missing-match-text">
        {"אולי זה: "}
        <bdi>{match.name}</bdi>
        {" · "}
        <bdi dir="ltr" className="ui-num ui-missing-match-whole">{match.amount}</bdi>
        {" · "}
        <bdi dir="ltr" className="ui-missing-match-whole">{match.date}</bdi>
      </span>
      <span className="ui-missing-match-actions">
        <Button variant="pill" aria-label={`${same}: ${match.name}`} onClick={() => { onAnswer(true); }}>{same}</Button>
        <Button variant="pill" aria-label={`לא, ${match.name} הוא לא אותו אחד`} onClick={() => { onAnswer(false); }}>לא</Button>
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
 * opens the payment). A late row and a change can be hidden for this user; a late row comes back
 * next month.
 */
export function MissingBillList({
  rows,
  arrived = [],
  phase = { kind: "ready" },
  onRetry,
  onHide,
  onMatch,
}: {
  rows: readonly MissingBillRow[];
  arrived?: readonly ArrivedRow[];
  phase?: ScreenPhase;
  onRetry?: () => void;
  onHide?: (kind: "missing" | "change", key: string, name: string) => void;
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
  return (
    <>
      {rows.length > 0 ? (
        <section id={SECTION_ID.late} aria-label="לא הגיעו" className="ui-recurring-section">
          <SectionHead title="לא הגיעו" />
          <List className="ui-missing-bills">
            {rows.map((row) => (
              <div key={row.id} className="ui-missing-item">
                <HideableRow name={row.name} onHide={hide("missing", row.alertKey, row.name)} reserve={onHide != null}>
                  <Link
                    to={row.href}
                    className="ui-row ui-hit"
                    aria-label={[row.name, row.place, row.usual, approxAmountText(row.minor, row.currency)].filter((part) => part != null).join(", ")}
                  >
                    <span className="ui-row-main">
                      <span className="ui-row-text">
                        <span className="ui-row-title">{row.name}</span>
                        {row.place != null ? <PlaceLine place={row.place} /> : null}
                        <PaceLine text={row.usual} />
                      </span>
                    </span>
                    <ApproxAmount minor={row.minor} currency={row.currency} income={row.income} />
                    <span className="ui-row-chevron" aria-hidden="true">
                      <ChevronIcon />
                    </span>
                  </Link>
                </HideableRow>
                {row.match != null && onMatch != null ? (
                  <MatchHint match={row.match} income={row.income} onAnswer={(same) => { onMatch(row.id, same); }} />
                ) : null}
              </div>
            ))}
          </List>
        </section>
      ) : null}
      {arrived.length > 0 ? (
        <section id={SECTION_ID.arrived} aria-label="הגיעו החודש" className="ui-recurring-section">
          <SectionHead title="הגיעו החודש" />
          <List className="ui-missing-bills">
            {arrived.map((row) => {
              const amount = formatAmountText(row.minor, row.currency);
              return (
                <HideableRow key={row.id} name={row.name} onHide={hide("change", row.alertKey, row.name)} reserve={onHide != null}>
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
                        {row.place != null ? <PlaceLine place={row.place} /> : null}
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
                    <span className="ui-row-chevron" aria-hidden="true">
                      <ChevronIcon />
                    </span>
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
