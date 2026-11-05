import { useState } from "react";
import { Link } from "react-router-dom";
import { Amount } from "../ui/amount";
import { AttentionCards } from "../ui/attention-cards";
import { BandOfflineLine, PageLoadFailed } from "../ui/band-states";
import type { BannerRow } from "../ui/banner";
import { Button } from "../ui/button";
import { CompactBar } from "../ui/compact-bar";
import { israelToday } from "../ui/date-math";
import { DockSlot, useDockedFilter } from "../ui/dock-filter";
import { EmptyState } from "../ui/empty-state";
import { GroupHead } from "../ui/group-head";
import { IconButton } from "../ui/icon-button";
import { AlertIcon, CalendarIcon, ChevronIcon, PercentIcon, PlusIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { PartsBar } from "../ui/parts-bar";
import { useScrolledPast } from "../ui/screen-header";
import { SegmentedControl } from "../ui/segmented-control";
import { DelayedSkeleton, Skeleton } from "../ui/skeleton";
import { LoansSkeleton } from "../ui/screen-skeletons";
import { StatusMark } from "../ui/status-mark";
import { TopBand } from "../ui/top-band";
import { LOAN_STATUS_LABEL } from "./loan-copy";
import { formatLoanMoney, type LoanCurrency } from "./loan-form";
import { dayMonth, monthYear, wholeMoney } from "./loan-detail-view-data";
import { groupLoans, groupLoansByKind, isClosedLoan, type LoanKindGroup, type LoanListRow } from "./loan-list";
import { LOANS_EMPTY_OWNER, LOANS_EMPTY_TITLE, LOANS_EMPTY_VIEWER, LOANS_ERROR_TITLE, type LoansHostCtx } from "./loans-host";
import { percentOf } from "./loans-paid";

/** FLOW-1046: the band bar's height (6 + 52 + 6), the docking hook's `bar`. */
const BAND_BAR = 64;

/** A payment due within this many days shows as a דורש טיפול card. */
const SOON_DAYS = 10;

export type LoansFilter = "open" | "closed";

function money(minor: bigint, currency: string): string {
  return wholeMoney(minor, currency === "USD" ? "USD" : "ILS");
}

/** Whole days from `today` to `iso` (both yyyy-mm-dd). */
function daysUntil(iso: string, today: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/**
 * FLOW-1046: one row's line under its name. Open: ממתין לבדיקה first when payments wait, then the next payment
 * ("הבא 20/11 · $5,240", or בלי תשלום קבוע for a loan with no schedule), then the project. Closed: how and when
 * it ended ("נפרעה 08/2026"), then the project. The kind is the group's head, so the row leaves it out.
 */
export function loanRowHint(row: LoanListRow): string {
  const project = row.projectName ?? "בלי פרויקט";
  if (isClosedLoan(row)) {
    const label = row.status == null ? "" : LOAN_STATUS_LABEL[row.status];
    const when = row.closedOn == null || row.closedOn === "" ? label : `${label} ${monthYear(row.closedOn)}`;
    return [when, project].join(" · ");
  }
  const next = row.next == null ? "בלי תשלום קבוע" : `הבא ${dayMonth(row.next.dueDate)} · ${money(row.next.amountMinor, row.currency)}`;
  return [row.flaggedParts > 0 ? "ממתין לבדיקה" : null, next, project].filter((part): part is string => part != null).join(" · ");
}

/**
 * FLOW-1046: the list's דורש טיפול cards. A loan whose payments wait for a check (the loan Jev filled from the
 * bank, or a payment it split), then a payment due within SOON_DAYS. Each is keyed by what it counts, so a
 * hidden card comes back when the count or the date changes.
 */
export function loansAttention(rows: readonly LoanListRow[], today: string, loanHref: (id: string) => string): BannerRow[] {
  const open = groupLoans(rows).open;
  const checks: BannerRow[] = open.filter((row) => row.flaggedParts > 0).map((row) => ({
    id: `check:${row.id}`,
    to: loanHref(row.id),
    title: `${row.flaggedParts === 1 ? "תשלום אחד ממתין" : `${String(row.flaggedParts)} תשלומים ממתינים`} לבדיקה · ${row.name}`,
    icon: <AlertIcon size={20} />,
    dismissKey: `check:${String(row.flaggedParts)}`,
  }));
  const soon: BannerRow[] = open.flatMap((row) => {
    if (row.next == null) return [];
    const days = daysUntil(row.next.dueDate, today);
    if (days < 0 || days > SOON_DAYS) return [];
    const when = days === 0 ? "היום" : days === 1 ? "מחר" : `בעוד ${String(days)} ימים`;
    return [{
      id: `soon:${row.id}`,
      to: loanHref(row.id),
      title: `תשלום ${row.name} ${when} · ${money(row.next.amountMinor, row.currency)}`,
      icon: <CalendarIcon size={20} />,
      dismissKey: `soon:${row.next.dueDate}`,
    }];
  });
  return [...checks, ...soon];
}

/** A group head's summary: the count, and the balances (one per currency). */
function groupSummary(group: LoanKindGroup): string {
  return [String(group.rows.length), ...group.totals.map((total) => money(total.minor, total.currency))].join(" · ");
}

/** The band's figures: the open loans' balance in the company's currency, the next payment and the month's payments. */
type BandFigures = {
  count: number;
  leftMinor: bigint;
  /** The open loans' principal at the start; null for a sample without a summary. */
  principalMinor: bigint | null;
  monthlyMinor: bigint | null;
  next: { name: string; dueDate: string; amountMinor: bigint } | null;
};

function bandFigures(ctx: LoansHostCtx, open: readonly LoanListRow[], currency: LoanCurrency): BandFigures {
  if (ctx.summary != null) {
    const next = ctx.summary.next;
    return {
      count: ctx.summary.openCount,
      leftMinor: ctx.summary.totalBalanceMinor,
      principalMinor: ctx.summary.principalMinor,
      monthlyMinor: ctx.summary.monthlyMinor,
      next: next == null ? null : { name: next.lenderName, dueDate: next.dueDate, amountMinor: next.amountMinor },
    };
  }
  // A sample without a summary: the rows' own balances and next payments.
  const mine = open.filter((row) => row.currency === currency);
  const first = mine.filter((row) => row.next != null).sort((a, b) => ((a.next?.dueDate ?? "") < (b.next?.dueDate ?? "") ? -1 : 1))[0];
  return {
    count: mine.length,
    leftMinor: mine.reduce((sum, row) => sum + row.balanceMinor, 0n),
    principalMinor: null,
    monthlyMinor: null,
    next: first?.next == null ? null : { name: first.name, dueDate: first.next.dueDate, amountMinor: first.next.amountMinor },
  };
}

/**
 * FLOW-1055 (V3-Loans): the band's paid line under the figure, as the loan page draws it: the principal's progress
 * (8px) and "נפרע 12% · $68,591 מתוך $590,000".
 */
export function BandPaid({ principalMinor, leftMinor, currency }: { principalMinor: bigint; leftMinor: bigint; currency: string }) {
  const paid = principalMinor > leftMinor ? principalMinor - leftMinor : 0n;
  return (
    <div className="ui-loans-band-paid">
      <PartsBar parts={[{ key: "paid", value: paid, tone: "band-past" }]} total={principalMinor} height={8} label="נפרע מהקרן" />
      <p className="ui-loan-band-caption">
        {`נפרע ${String(percentOf(paid, principalMinor))}% · `}
        <bdi dir="ltr">{money(paid, currency)}</bdi>
        {" מתוך "}
        <bdi dir="ltr">{money(principalMinor, currency)}</bdi>
      </p>
    </div>
  );
}

function LoanRow({ row, onOpen, today }: { row: LoanListRow; onOpen: (id: string) => void; today: string }) {
  const hint = loanRowHint(row);
  const closed = isClosedLoan(row);
  const late = row.next != null && row.next.dueDate < today;
  return (
    <ListRow
      variant="project"
      layout="flat"
      title={row.name}
      hintParts={hint.split(" · ")}
      tone={row.flaggedParts > 0 && !closed ? "warning" : undefined}
      icon={closed ? <StatusMark kind="paid" /> : row.next == null ? undefined : <StatusMark kind={late ? "late" : "due"} />}
      agorot={row.balanceMinor}
      currency={row.currency}
      label={[row.name, formatLoanMoney(row.balanceMinor, row.currency === "USD" ? "USD" : "ILS"), hint].join(", ")}
      onClick={() => { onOpen(row.id); }}
    />
  );
}

/**
 * FLOW-1046 (V3-Loans, the Overview pattern): the violet band with what is left to pay (it opens the summary)
 * and + for a new loan; דורש טיפול; the פעילות / נסגרו segment, which docks into the band bar; then the rows in
 * groups by kind under one-line sticky heads. `closedOpen` opens on נסגרו (the dev fixture's ?closed=1).
 */
export function LoansList({ ctx, closedOpen = false, today = israelToday() }: { ctx: LoansHostCtx; closedOpen?: boolean; today?: string }) {
  const [filter, setFilter] = useState<LoansFilter>(closedOpen ? "closed" : "open");
  const [bandMark, setBandMark] = useState<HTMLElement | null>(null);
  const barShown = useScrolledPast(bandMark, true, BAND_BAR);
  const { markRef, docked, scrollUnderBar } = useDockedFilter({ barShown, bar: BAND_BAR });
  const { open, closed } = groupLoans(ctx.rows);
  const ready = !ctx.loading && !ctx.failed;
  const currency = ctx.currency ?? "ILS";
  const figures = bandFigures(ctx, open, currency);
  const shownRows = filter === "open" ? open : closed;
  const groups = groupLoansByKind(shownRows);
  const left = <Amount agorot={figures.leftMinor} currency={currency} presentation="detail" />;
  const control = (onBand: boolean) => (
    <SegmentedControl<LoansFilter>
      label="סינון הלוואות"
      showLabel={false}
      tone={onBand ? "band" : "page"}
      value={filter}
      options={[
        { value: "open", label: `פעילות · ${String(open.length)}` },
        { value: "closed", label: `נסגרו · ${String(closed.length)}` },
      ]}
      onChange={(next) => {
        setFilter(next);
        scrollUnderBar();
      }}
    />
  );
  // A failed read is not a page with a live primary action (CHECKLIST): + hides there.
  const add = ctx.holdWrites || ctx.failed ? null : (
    <IconButton label="הלוואה חדשה" onBand onClick={ctx.openNew} ref={ctx.newRef}>
      <PlusIcon />
    </IconButton>
  );
  const hasRows = ctx.rows.length > 0;
  return (
    <div className="ui-loans-screen">
      <TopBand
        wordmark={false}
        leading={<h1 className="ui-loans-band-title t-sheet">הלוואות</h1>}
        trailing={add}
        hero={ctx.loading ? (
          <div className="ui-loans-band-skel" aria-hidden="true">
            <Skeleton tone="band" width="md" />
            <Skeleton tone="band" className="ui-skel-project-num" />
          </div>
        ) : ready && hasRows && ctx.currency != null ? (
          <div className="ui-loans-band ui-band-fade">
            <Link className="ui-loans-band-link m-press" to={ctx.summaryHref}>
              <span className="ui-loans-band-label">
                {`נשאר לשלם · ${String(figures.count)} הלוואות`}
                <ChevronIcon size={16} />
              </span>
              <span className="ui-loans-band-figure">
                <Amount agorot={figures.leftMinor} currency={currency} size="hero" />
              </span>
            </Link>
            {figures.principalMinor == null || figures.principalMinor <= 0n ? null : (
              <BandPaid principalMinor={figures.principalMinor} leftMinor={figures.leftMinor} currency={currency} />
            )}
            <div className="ui-loans-band-rows">
              {figures.next == null ? null : (
                <p className="ui-loans-band-row">
                  <span className="ui-loans-band-row-label" data-clip-ok="">{`התשלום הבא · ${figures.next.name} · ${dayMonth(figures.next.dueDate)}`}</span>
                  <bdi dir="ltr">{money(figures.next.amountMinor, currency)}</bdi>
                </p>
              )}
              {figures.monthlyMinor == null ? null : (
                <p className="ui-loans-band-row">
                  <span className="ui-loans-band-row-label" data-clip-ok="">תשלומים בחודש</span>
                  <bdi dir="ltr">{money(figures.monthlyMinor, currency)}</bdi>
                </p>
              )}
            </div>
            <span ref={setBandMark} className="ui-compact-mark" aria-hidden="true" />
          </div>
        ) : null}
      />
      <CompactBar
        title="הלוואות"
        shown={barShown}
        tone="band"
        start={<span className="ui-loans-bar-slot" aria-hidden="true" />}
        centre={(
          <Link className="ui-compact-bar-centre" to={ctx.summaryHref}>
            <span className="ui-compact-bar-centre-title">הלוואות · נשאר לשלם</span>
            <span className="ui-compact-bar-centre-net">{left}</span>
          </Link>
        )}
        end={add ?? <span className="ui-loans-bar-slot" aria-hidden="true" />}
        dock={hasRows ? control(true) : undefined}
        docked={docked}
      />
      <div className="ui-loans-body">
        {ctx.loading ? (
          <DelayedSkeleton>
            <LoansSkeleton />
          </DelayedSkeleton>
        ) : ctx.failed ? (
          // FLOW-962: Home v2's failure (what happened, נסו שוב, צריך עזרה?), as a card.
          <PageLoadFailed title={LOANS_ERROR_TITLE} offline={ctx.offline} onRetry={ctx.retry} />
        ) : (
          <>
            {ctx.offlineSince == null ? null : <BandOfflineLine since={ctx.offlineSince} onPage />}
            <AttentionCards rows={loansAttention(ctx.rows, today, ctx.loanHref)} storageKey="loans" />
            {hasRows ? (
              <>
                <span ref={markRef} className="ui-compact-mark" aria-hidden="true" />
                <DockSlot docked={docked}>{control(false)}</DockSlot>
              </>
            ) : null}
            {filter === "open" && ctx.empty ? (
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
            {filter === "closed" && closed.length === 0 ? (
              <EmptyState icon={<PercentIcon />} title="אין הלוואות שנסגרו" body="הלוואה שתיסגר תעבור לכאן, עם איך ומתי נסגרה." />
            ) : null}
            {groups.map((group) => (
              <section key={group.kind} className="ui-month ui-loans-group" aria-labelledby={`loans-${filter}-${group.kind}`}>
                <GroupHead id={`loans-${filter}-${group.kind}`} title={group.title} summary={groupSummary(group)} />
                <List layout="flat">
                  {group.rows.map((row) => <LoanRow key={row.id} row={row} onOpen={ctx.openLoan} today={today} />)}
                </List>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
