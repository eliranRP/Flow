import { formatAmountText } from "@flow/shared";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApproxAmount, approxAmountText } from "./approx-amount";
import { cx } from "./cx";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { HintParts } from "./hint-parts";
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
};

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
 * that does the same (FLOW-415, owner 08:41Z). The hide is this user's only.
 */
function HideableRow({ name, onHide, children }: { name: string; onHide?: () => void; children: ReactNode }) {
  if (onHide == null) return <div className="ui-recurring-row">{children}</div>;
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
}: {
  rows: readonly MissingBillRow[];
  arrived?: readonly ArrivedRow[];
  phase?: ScreenPhase;
  onRetry?: () => void;
  onHide?: (kind: "missing" | "change", key: string, name: string) => void;
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
              <HideableRow key={row.id} name={row.name} onHide={hide("missing", row.alertKey, row.name)}>
                <Link
                  to={row.href}
                  className="ui-row ui-hit"
                  aria-label={[row.name, row.place, row.usual, approxAmountText(row.minor, row.currency)].filter((part) => part != null).join(", ")}
                >
                  <span className="ui-row-main">
                    <span className="ui-row-text">
                      <span className="ui-row-title">{row.name}</span>
                      {row.place != null ? <span className="ui-row-hint"><HintParts text={row.place} /></span> : null}
                      <span className="ui-row-hint"><HintParts text={row.usual} /></span>
                    </span>
                  </span>
                  <ApproxAmount minor={row.minor} currency={row.currency} income={row.income} />
                  <span className="ui-row-chevron" aria-hidden="true">
                    <ChevronIcon />
                  </span>
                </Link>
              </HideableRow>
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
                <HideableRow key={row.id} name={row.name} onHide={hide("change", row.alertKey, row.name)}>
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
                        {row.place != null ? <span className="ui-row-hint"><HintParts text={row.place} /></span> : null}
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
