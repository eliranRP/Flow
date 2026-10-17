import { useEffect, useId, useState } from "react";
import { PlusIcon, InfoIcon, PercentIcon, RefreshIcon } from "../ui/icons";
import { CompactBar } from "../ui/compact-bar";
import { EmptyState } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";
import { Button } from "../ui/button";
import { DelayedSkeleton } from "../ui/skeleton";
import { LoansSkeleton } from "../ui/screen-skeletons";
import { cx } from "../ui/cx";
import { LOAN_KIND_LIST_LABEL, LOAN_STATUS_LABEL } from "./loan-copy";
import { formatRatePpm } from "./loan-detail-data";
import { formatLoanMoney } from "./loan-form";
import { groupLoans, LoanBalance, LOANS_CLOSED_UNDER_EMPTY, type LoanListRow } from "./loan-list";
import { LoanSummaryCard } from "./loan-summary-card";
import { LOANS_EMPTY_OWNER, LOANS_EMPTY_TITLE, LOANS_EMPTY_VIEWER, LOANS_ERROR_TITLE, type LoansHostCtx } from "./loans-host";

/** The page scrolls past this many pixels: the compact bar slides down (the forecast's rule). */
const COMPACT_AFTER = 90;

/**
 * One row's meta line, in the board's order: project · rate · kind. A closed loan says how it
 * ended and when: project · kind · נפרעה MM/YYYY. A loan waiting for a check leads with ממתין לבדיקה.
 */
export function loanRowMeta(row: LoanListRow): string {
  const project = row.projectName ?? "ללא פרויקט";
  const kind = row.kind == null ? LOAN_KIND_LIST_LABEL.amortizing : LOAN_KIND_LIST_LABEL[row.kind];
  const closed = row.status != null && row.status !== "open";
  const parts = closed
    ? [project, kind, closedWhen(row)]
    : [project, row.ratePpm == null ? null : formatRatePpm(row.ratePpm), kind];
  const shown = parts.filter((part): part is string => part != null);
  return row.flaggedParts > 0 && !closed ? ["ממתין לבדיקה", ...shown].join(" · ") : shown.join(" · ");
}

/** נפרעה 08/2026: the status word and the month it ended. */
function closedWhen(row: LoanListRow): string {
  const label = row.status == null ? "" : LOAN_STATUS_LABEL[row.status];
  if (row.closedOn == null || row.closedOn === "") return label;
  return `${label} ${row.closedOn.slice(5, 7)}/${row.closedOn.slice(0, 4)}`;
}

function LoanRow({ row, muted, onOpen }: { row: LoanListRow; muted: boolean; onOpen: (id: string) => void }) {
  const meta = loanRowMeta(row);
  return (
    <li className="ui-loans-li">
      <button
        type="button"
        className={cx("ui-loans-row", muted && "ui-loans-row-closed")}
        onClick={() => { onOpen(row.id); }}
        aria-label={[row.name, formatLoanMoney(row.balanceMinor, row.currency === "USD" ? "USD" : "ILS"), meta].join(", ")}
      >
        <span className="ui-loans-initial" aria-hidden="true">{row.name.trim().slice(0, 1)}</span>
        <span className="ui-loans-text">
          <span className="ui-loans-name">{row.name}</span>
          <span className={cx("ui-loans-meta", row.flaggedParts > 0 && !muted && "ui-loans-meta-warn")}>{meta}</span>
        </span>
        <LoanBalance className="ui-loans-amount" minor={row.balanceMinor} currency={row.currency} />
      </button>
    </li>
  );
}

/** The list's body under the header: the states (skeleton, error, empty) or the summary, the open rows and the closed group. */
export function LoansList({ ctx, closedOpen = false }: { ctx: LoansHostCtx; closedOpen?: boolean }) {
  const [compact, setCompact] = useState(false);
  const [closedShown, setClosedShown] = useState(closedOpen);
  const closedId = useId();
  useEffect(() => {
    const onScroll = () => { setCompact(window.scrollY > COMPACT_AFTER); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); };
  }, []);

  const { open, closed } = groupLoans(ctx.rows);
  const ready = !ctx.loading && !ctx.failed;
  const total = ctx.summary != null && ctx.currency != null ? formatLoanMoney(ctx.summary.totalBalanceMinor, ctx.currency) : null;
  return (
    <div className="ui-loans-screen">
      <CompactBar
        title="הלוואות"
        figure={total == null ? undefined : <bdi dir="ltr">{total}</bdi>}
        shown={compact}
        actions={ctx.holdWrites ? undefined : (
          <IconButton label="הלוואה חדשה" onClick={ctx.openNew}>
            <PlusIcon />
          </IconButton>
        )}
      />
      {/* The empty state (States board) has its own primary action, so the header link and the count stay out. */}
      {ctx.holdWrites ? null : (
        <div className="ui-loans-add">
          {ctx.empty ? null : (
            <button type="button" className="ui-loans-add-btn" onClick={ctx.openNew} ref={ctx.newRef}>+ הלוואה חדשה</button>
          )}
        </div>
      )}
      <h1 className="ui-loans-title">הלוואות</h1>
      {ready && !ctx.empty ? <p className="ui-loans-count">{`${String(open.length)} פעילות`}</p> : null}
      {ctx.loading ? (
        <DelayedSkeleton>
          <LoansSkeleton />
        </DelayedSkeleton>
      ) : ctx.failed ? (
        <EmptyState
          icon={<InfoIcon size={36} />}
          title={LOANS_ERROR_TITLE}
          body="נסו שוב בעוד רגע"
          action={(
            // The tint action every empty and error state uses (DESIGN-RULES §2.8, FLOW-334), not a fill.
            <Button variant="pill" icon={<RefreshIcon />} busy={ctx.retrying} onClick={ctx.retry}>
              ניסיון חוזר
            </Button>
          )}
        />
      ) : (
        <>
          {ctx.empty ? (
            <EmptyState
              icon={<PercentIcon />}
              title={LOANS_EMPTY_TITLE}
              body={ctx.holdWrites ? LOANS_EMPTY_VIEWER : LOANS_EMPTY_OWNER}
              action={ctx.holdWrites ? undefined : (
                <Button buttonRef={ctx.emptyRef} onClick={ctx.openNew}>
                  הוספת הלוואה
                </Button>
              )}
            />
          ) : null}
          {ctx.summary != null && ctx.summary.openCount > 0 && ctx.currency != null ? (
            <div className="ui-loans-summary-wrap">
              <LoanSummaryCard summary={ctx.summary} currency={ctx.currency} />
            </div>
          ) : null}
          {open.length > 0 ? <h2 className="ui-loans-section-head">פעילות</h2> : null}
          {open.length > 0 ? (
            <ul className="ui-loans-list">
              {open.map((row) => <LoanRow key={row.id} row={row} muted={false} onOpen={ctx.openLoan} />)}
            </ul>
          ) : null}
          {closed.length > 0 ? (
            <>
              <button
                type="button"
                className="ui-loans-closed-toggle"
                aria-expanded={closedShown}
                aria-controls={closedId}
                onClick={() => { setClosedShown((value) => !value); }}
              >
                <span className="ui-loans-closed-title">{open.length === 0 ? LOANS_CLOSED_UNDER_EMPTY : `נסגרו · ${String(closed.length)}`}</span>
                <span className="ui-loans-closed-action">{closedShown ? "הסתר" : "הצג"}</span>
              </button>
              {closedShown ? (
                <ul className="ui-loans-list ui-loans-closed-list" id={closedId}>
                  {closed.map((row) => <LoanRow key={row.id} row={row} muted onOpen={ctx.openLoan} />)}
                </ul>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
