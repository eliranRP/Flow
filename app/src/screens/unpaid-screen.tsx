import "../ui/lazy.css";
import { formatAmountText } from "@flow/shared";
import { useMemo, useState } from "react";
import { absAgorot } from "../agorot";
import { israelToday } from "../ui/date-math";
import { Amount } from "../ui/amount";
import { Avatar } from "../ui/avatar";
import { BackButton } from "../ui/back";
import { BandOfflineLine, PageLoadFailed, useOnline } from "../ui/band-states";
import { Button } from "../ui/button";
import { CompactBar } from "../ui/compact-bar";
import { DockSlot, useDockedFilter } from "../ui/dock-filter";
import { EmptyState } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";
import { CheckIcon, RefreshIcon } from "../ui/icons";
import { ListRow } from "../ui/list-row";
import { useScrolledPast } from "../ui/screen-header";
import { SegmentedControl } from "../ui/segmented-control";
import { DelayedSkeleton, ListSkeleton } from "../ui/skeleton";
import { unpaidDaysOpen, unpaidIsMarked, unpaidOverdueMinor, unpaidTotals, UNPAID_OVERDUE_DAYS, type UnpaidInvoice, type UnpaidSummary } from "../unpaid";
import { usePreviewSearch } from "../preview";
import { UNPAID_MARKED, useUnpaidActions } from "./unpaid-actions";

/** The list bar's height (the compact bar at list size), the docking hook's `bar`. */
const LIST_BAR = 44;

/** כל הפתוחות, or only the ones open more than UNPAID_OVERDUE_DAYS days. */
export type UnpaidFilter = "all" | "late";

/** "לפני N דק׳" for the refresh line; a fresh sync says so without a number. */
function syncedAgo(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (Number.isNaN(minutes)) return "";
  return minutes < 1 ? "לפני רגע" : `לפני ${String(minutes)} דק׳`;
}

/** FLOW-1049: the rows a filter shows. A marked row is not late: it waits for the sync, not for the customer. */
export function unpaidFiltered(rows: readonly UnpaidInvoice[], filter: UnpaidFilter, today: string): UnpaidInvoice[] {
  if (filter === "all") return [...rows];
  return rows.filter((row) => !unpaidIsMarked(row) && unpaidDaysOpen(row.doc_date, today) > UNPAID_OVERDUE_DAYS);
}

/** The row's line under the name: its age (or the mark) and the invoice number. A bank match shows on the invoice. */
function rowHint(row: UnpaidInvoice, days: number): string {
  const marked = unpaidIsMarked(row);
  return [
    marked ? UNPAID_MARKED : `פתוחה ${String(days)} ימים`,
    row.doc_number ? `#${row.doc_number}` : null,
  ].filter((part): part is string => part != null).join(" · ");
}

/**
 * FLOW-367, FLOW-1049 (V3-Unpaid, the List pattern): Back to Home, the title, the count line, the open total,
 * the over-30 line, then the כל הפתוחות / באיחור 30+ segment, which docks into the compact bar. Each row opens
 * the invoice; its check button marks it paid (set_invoice_paid) with a ביטול toast. Over 30 days reads in the signal colour.
 */
export function UnpaidScreen({ sample, summary, offlineSince }: { sample?: UnpaidInvoice[]; summary?: UnpaidSummary; offlineSince?: number } = {}) {
  const search = usePreviewSearch();
  const actions = useUnpaidActions(sample, summary);
  const { rows, open, all, holdWrites, syncing } = actions;
  const online = useOnline();
  const [filter, setFilter] = useState<UnpaidFilter>("all");
  const [titleMark, setTitleMark] = useState<HTMLElement | null>(null);
  const barShown = useScrolledPast(titleMark, true, LIST_BAR);
  const { markRef, docked, scrollUnderBar } = useDockedFilter({ barShown, bar: LIST_BAR });
  const failed = actions.phase.kind === "error";
  const loading = actions.phase.kind === "loading";
  const ready = !failed && !loading;
  // Offline with invoices on screen: they are from the last read.
  const since = offlineSince ?? (online ? undefined : actions.readAt);
  const today = israelToday();
  // The totals of the currencies that are owed; the over-30 line speaks of the first one.
  const totals = unpaidTotals(all).filter((total) => total.minor !== 0n);
  const primaryCurrency = totals[0]?.currency ?? "ILS";
  const overdue = useMemo(() => unpaidOverdueMinor(all, primaryCurrency, today), [all, primaryCurrency, today]);
  const shown = unpaidFiltered(rows, filter, today);
  const back = `/${search}`;
  // FLOW-335: the SUMIT refresh, under the rows and on the all-paid page.
  const refresh = holdWrites ? null : (
    <button type="button" className="ui-inv-refresh" onClick={actions.startSync} disabled={syncing} aria-busy={syncing || undefined}>
      {syncing ? <span className="ui-spinner" aria-hidden="true" /> : <RefreshIcon size={14} />}
      <span>{syncing ? "מרענן…" : `רענון מ־SUMIT${actions.lastSyncAt ? ` · ${syncedAgo(actions.lastSyncAt)}` : ""}`}</span>
    </button>
  );
  const control = (
    <SegmentedControl<UnpaidFilter>
      label="סינון חשבוניות"
      showLabel={false}
      value={filter}
      options={[
        { value: "all", label: "כל הפתוחות" },
        { value: "late", label: `באיחור ${String(UNPAID_OVERDUE_DAYS)}+` },
      ]}
      onChange={(next) => {
        setFilter(next);
        scrollUnderBar();
      }}
    />
  );
  const hasRows = ready && all.length > 0;
  return (
    <div className="ui-inv-list-screen">
      <CompactBar
        title="חשבוניות פתוחות"
        figure={totals[0] == null ? undefined : <Amount agorot={totals[0].minor} currency={totals[0].currency} income signless />}
        label="בית"
        backTo={back}
        shown={barShown}
        dock={hasRows ? control : undefined}
        docked={docked}
      />
      <header className="ui-inv-list-head">
        <BackButton fallback={back} text="בית" />
        <h1 className="t-title">חשבוניות פתוחות</h1>
        {hasRows ? (
          <>
            <p className="ui-inv-list-sub t-meta">
              {[`${String(open.length)} חשבוניות`, actions.lastSyncAt ? `מעודכן מ־SUMIT ${syncedAgo(actions.lastSyncAt)}` : null].filter(Boolean).join(" · ")}
            </p>
            {totals.map((total) => (
              <p key={total.currency} className="ui-inv-total t-detail">
                <Amount agorot={total.minor} currency={total.currency} size="total" income signless />
              </p>
            ))}
            <p className="ui-inv-list-sub t-meta">
              {"לגבייה מלקוחות"}
              {overdue > 0n ? (
                <span className="ui-inv-overdue">
                  {" · "}
                  <bdi dir="ltr">{formatAmountText(overdue, primaryCurrency)}</bdi>
                  {` פתוחות יותר מ־${String(UNPAID_OVERDUE_DAYS)} ימים`}
                </span>
              ) : null}
            </p>
          </>
        ) : null}
        <span ref={setTitleMark} className="ui-compact-mark" aria-hidden="true" />
      </header>
      {loading ? (
        <DelayedSkeleton>
          <ListSkeleton />
        </DelayedSkeleton>
      ) : failed ? (
        <PageLoadFailed title="החשבוניות לא נטענו" offline={!online || (actions.phase.kind === "error" && actions.phase.offline)} onRetry={actions.retry} />
      ) : all.length === 0 ? (
        <div className="ui-inv-empty">
          <EmptyState
            icon={<CheckIcon size={40} stroke={2.2} />}
            title="הכל שולם"
            body={"אין חשבוניות פתוחות כרגע.\nחשבוניות שסימנת ייצאו מהרשימה אחרי הסנכרון עם SUMIT."}
            action={<Button full to={back}>חזרה לבית</Button>}
          />
          {refresh}
        </div>
      ) : (
        <>
          {since == null ? null : <BandOfflineLine since={since} onPage />}
          <div className="ui-inv-filter">
            <span ref={markRef} className="ui-compact-mark" aria-hidden="true" />
            <DockSlot docked={docked}>{control}</DockSlot>
          </div>
          {shown.length === 0 ? (
            <EmptyState title="אין חשבוניות באיחור" body={`אף חשבונית לא פתוחה יותר מ־${String(UNPAID_OVERDUE_DAYS)} ימים.`} />
          ) : (
            <ul className="ui-inv-list" aria-label="חשבוניות פתוחות">
              {shown.map((row) => {
                const marked = unpaidIsMarked(row);
                const days = unpaidDaysOpen(row.doc_date, today);
                const over = days > UNPAID_OVERDUE_DAYS && !marked;
                const name = row.customer_name ?? row.description;
                return (
                  <li key={row.id} className="ui-inv-item">
                    <ListRow
                      variant="project"
                      layout="flat"
                      title={name}
                      hint={<span className="ui-inv-age" data-over={over ? "true" : undefined}>{rowHint(row, days)}</span>}
                      href={`/unpaid/${encodeURIComponent(row.id)}${search}`}
                      icon={<Avatar name={name} fallback="invoice" />}
                      agorot={absAgorot(row.open_gross_agorot)}
                      currency={row.currency ?? "ILS"}
                      amountDirection="income"
                    />
                    {holdWrites ? null : marked ? (
                      <button type="button" className="ui-inv-undo" onClick={() => { actions.setPaid(row.id, false); }}>ביטול</button>
                    ) : (
                      <IconButton label={`סימון כשולם: ${name}`} className="ui-inv-check" onClick={() => { actions.setPaid(row.id, true); }}>
                        <span className="ui-inv-check-ring" aria-hidden="true"><CheckIcon size={14} stroke={2.6} /></span>
                      </IconButton>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {refresh == null ? null : <div className="ui-inv-sortrow">{refresh}</div>}
        </>
      )}
    </div>
  );
}
