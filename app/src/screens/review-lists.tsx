import { formatAmountText, type ProjectWaitingRow, type ReviewRow } from "@flow/shared";
import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { lineDayTitle } from "../cash-lines-groups";
import { useHeldOrder } from "../list-hold";
import { reviewFocusPath } from "../review-paths";
import { txnListState } from "../txn-nav";
import { reviewMinutes } from "../weekly-summary";
import type { JevBooking } from "../jev-bookings";
import { Avatar } from "../ui/avatar";
import { BandOfflineLine, PageLoadFailed, ReviewButton } from "../ui/band-states";
import { Button } from "../ui/button";
import { formatDayMonth, israelToday } from "../ui/date-math";
import { searchMonthTitle } from "../search";
import { groupByKey } from "../ui/month-groups";
import { GroupList } from "../ui/month-list";
import { lineCountHint } from "../line-count-hint";
import { AlertIcon, CheckIcon } from "../ui/icons";
import { KeptOutTag, rowSource } from "../ui/line-marks";
import { ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { KEPT_OUT } from "./screen-shared";

/** FLOW-971: a list's failed read or its offline moment, drawn under the page's head. */
export type ReviewListState = {
  /** The read failed: the page's card, with the retry. */
  failed?: { offline: boolean; onRetry: () => void };
  /** Offline with the last read on screen: the moment it is from. */
  offlineSince?: number | null;
};

/** The row opened from the full list. A later URL replace must not move this. */
export const reviewListReturn: { current: string | null } = { current: null };

/** Money in or out, signed, with its agorot: "−$1,284.50", "+$1,850.00". */
export function signedAmount(minor: bigint, currency: string): string {
  return formatAmountText(minor, currency, minor > 0n ? { detail: true, direction: "income", plus: true } : { detail: true });
}

/**
 * Rows' signed totals, one figure per currency, shekels first: "−$500.00", "+₪300". A row `amountOf`
 * returns null for (a line kept out of profit) adds nothing. Empty when no row counts.
 */
export function signedTotals<T>(rows: readonly T[], amountOf: (row: T) => { minor: bigint; currency: string } | null): string[] {
  const sums = new Map<string, bigint>();
  for (const row of rows) {
    const amount = amountOf(row);
    if (amount == null) continue;
    sums.set(amount.currency, (sums.get(amount.currency) ?? 0n) + amount.minor);
  }
  return [...sums.entries()]
    .sort(([a], [b]) => Number(b === "ILS") - Number(a === "ILS"))
    .map(([currency, minor]) => signedAmount(minor, currency));
}

/** A list's big total: each currency's figure, read as "סה״כ". */
export function ListTake({ figures }: { figures: readonly string[] }) {
  if (figures.length === 0) return null;
  return (
    <p className="ui-review-list-take">
      <span className="sr-only">סה״כ </span>
      {figures.map((figure) => <bdi key={figure} className="ui-num" dir="ltr">{figure}</bdi>)}
    </p>
  );
}

/** "היום • 11/10", "אתמול • 10/10", "09/10"; another year's day adds its year. */
function reviewDayTitle(date: string, today: string): string {
  return date.slice(0, 4) === today.slice(0, 4) ? lineDayTitle(date, today) : `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/** Rows under one head per key, in the order the keys first appear (the queue's order). */
function groupRows<T>(rows: readonly T[], keyOf: (row: T) => string): { key: string; rows: T[] }[] {
  const groups: { key: string; rows: T[] }[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.find((entry) => entry.key === key);
    if (group) group.rows.push(row);
    else groups.push({ key, rows: [row] });
  }
  return groups;
}

/** A group's head: its name, and its total per currency on the end side, tabular (board M6). */
function ReviewGroupHead({ id, title, totals }: { id: string; title: string; totals: readonly string[] }) {
  return (
    <div className="ui-review-group-head">
      <h2 className="ui-review-group-title" id={id}>{title}</h2>
      {totals.length > 0 ? (
        <p className="ui-review-group-meta">
          {totals.map((total) => <bdi key={total} className="ui-num" dir="ltr">{total}</bdi>)}
        </p>
      ) : null}
    </div>
  );
}

/** The lists' empty card: what is there, and one way on (board H2). */
export function ReviewListEmpty({ title, body, action, to }: { title: string; body: string; action: string; to: string }) {
  return (
    <section className="ui-card ui-page-failed ui-review-list-empty">
      <span className="ui-band-failed-icon" aria-hidden="true">
        <CheckIcon size={24} />
      </span>
      <h2 className="ui-band-failed-title">{title}</h2>
      <p className="ui-band-failed-body">{body}</p>
      <Button to={to}>{action}</Button>
    </section>
  );
}

/** The page's head under the title: the offline line, or the failed card in place of the list. */
function ListBody({ state, failTitle, children }: { state: ReviewListState; failTitle: string; children: ReactNode }) {
  return (
    <div className="ui-review-list-body">
      {state.failed == null && state.offlineSince != null ? <BandOfflineLine since={state.offlineSince} onPage /> : null}
      {state.failed != null ? <PageLoadFailed title={failTitle} offline={state.failed.offline} onRetry={state.failed.onRetry} /> : children}
    </div>
  );
}

/** "6 פריטים · 1 בלי פרויקט": the count and what is missing (board M5). */
export function reviewAllSubtitle(count: number, missing: number): string {
  const items = count === 1 ? "פריט אחד" : `${String(count)} פריטים`;
  return missing === 0 ? items : `${items} · ${String(missing)} בלי פרויקט`;
}

type AllEntry =
  | { kind: "booking"; key: string; date: string; booking: JevBooking }
  | { kind: "row"; key: string; date: string; row: ReviewRow };

function entryAmount(entry: AllEntry): { minor: bigint; currency: string } {
  if (entry.kind === "booking") return { minor: entry.booking.amount_gross, currency: entry.booking.currency };
  const abs = entry.row.amount_net < 0n ? -entry.row.amount_net : entry.row.amount_net;
  return { minor: entry.row.direction === "income" ? abs : -abs, currency: entry.row.currency ?? "ILS" };
}

/**
 * FLOW-971 (Review lists v2): every item waiting, under day heads with each day's total. Jev's bookings
 * come first (they come first in the queue). The filled button opens the queue's head; a row opens its card.
 */
export function ReviewAllList({
  rows,
  bookings = [],
  search,
  backTo,
  state = {},
  now,
}: {
  rows: ReviewRow[];
  /** FLOW-955: Jev's bookings waiting for review, listed first (they come first in the queue). */
  bookings?: readonly JevBooking[];
  search: string;
  backTo: string;
  state?: ReviewListState;
  /** Stories pin the day heads. */
  now?: Date;
}) {
  useEffect(() => {
    const id = reviewListReturn.current;
    if (id == null) return;
    const href = reviewFocusPath(search, id);
    const link = [...document.querySelectorAll("a[href]")].find((node) => node.getAttribute("href") === href);
    if (link instanceof HTMLElement) link.focus();
    const timer = window.setTimeout(() => {
      if (reviewListReturn.current === id) reviewListReturn.current = null;
    }, 0);
    return () => { window.clearTimeout(timer); };
  }, [search, rows]);
  const ordered = useHeldOrder(rows, (row) => row.id);
  const count = rows.length + bookings.length;
  const missing = rows.filter((row) => row.project_id == null).length;
  const today = israelToday(now);
  // Jev's bookings take their date's place; under one day they come first, as in the queue.
  const rowEntries: AllEntry[] = ordered.map((row) => ({ kind: "row" as const, key: row.id, date: row.doc_date, row }));
  const entries: AllEntry[] = [...rowEntries];
  for (const booking of bookings) {
    const entry: AllEntry = { kind: "booking", key: `b:${booking.transaction_id}`, date: booking.doc_date, booking };
    const day = booking.doc_date.slice(0, 10);
    const sameDay = entries.findIndex((other) => other.date.slice(0, 10) === day);
    // The queue sends rows oldest first: a booking goes before the first later day.
    const later = entries.findIndex((other) => other.date.slice(0, 10) > day);
    const at = sameDay >= 0 ? sameDay : later;
    if (at < 0) entries.push(entry);
    else entries.splice(at, 0, entry);
  }
  const groups = groupRows(entries, (entry) => entry.date.slice(0, 10));
  const failed = state.failed != null;
  return (
    <div className="ui-review-all-page">
      <ScreenHeader
        layout="stacked"
        title="כל הפריטים לאישור"
        subtitle={failed || count === 0 ? undefined : reviewAllSubtitle(count, missing)}
        backTo={backTo}
        backText="בית"
      />
      <ListBody state={state} failTitle="הפריטים לאישור לא נטענו">
        {count === 0 ? (
          <ReviewListEmpty title="אין פריטים לאישור" body="כל השורות אושרו. שורות חדשות יופיעו כאן כשיגיעו." action="לבית" to={`/${search}`} />
        ) : (
          <>
            <ReviewButton row={{ id: "review", to: `/review${search}`, title: "", button: { label: "לאישור הפריט הראשון", hint: `${reviewMinutes(count)} לכולם` } }} />
            {groups.map((group) => (
              <section key={group.key} className="ui-review-group" aria-labelledby={`review-day-${group.key}`}>
                <ReviewGroupHead id={`review-day-${group.key}`} title={reviewDayTitle(group.key, today)} totals={signedTotals(group.rows, entryAmount)} />
                <ul className="ui-review-all">
                  {group.rows.map((entry) => (
                    <li key={entry.key}>
                      {entry.kind === "booking"
                        ? <ReviewAllBookingRow booking={entry.booking} href={`/review${search}`} />
                        : <ReviewAllRow row={entry.row} href={reviewFocusPath(search, entry.row.id)} />}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </ListBody>
    </div>
  );
}

/** FLOW-955: Jev's booking as a list row: the party, "✦ פקודת יומן של Jev", the amount; it opens the queue's head. */
function ReviewAllBookingRow({ booking, href }: { booking: JevBooking; href: string }) {
  const income = booking.amount_gross > 0n;
  return (
    <Link className="ui-review-all-row ui-hit" to={href}>
      <Avatar name={booking.party} fallback="invoice" />
      <span className="ui-review-all-text">
        <span className="ui-review-all-title">{booking.party}</span>
        <span className="ui-review-all-meta"><span className="ui-review-all-meta-text">✦ פקודת יומן של Jev</span></span>
      </span>
      <bdi className={income ? "ui-review-all-amount ui-review-all-in ui-num" : "ui-review-all-amount ui-num"} dir="ltr">{signedAmount(booking.amount_gross, booking.currency)}</bdi>
    </Link>
  );
}

/**
 * A list row: the payee, then "project · category" (a row with no project reads "חסר פרויקט" with its
 * icon in the warning tone, FLOW-960), and the signed amount.
 */
function ReviewAllRow({ row, href }: { row: ReviewRow; href: string }) {
  const income = row.direction === "income";
  const { minor, currency } = entryAmount({ kind: "row", key: row.id, date: row.doc_date, row });
  const missing = row.project_id == null;
  const category = row.category_name ?? "";
  const project = missing ? "חסר פרויקט" : (row.project_name ?? "");
  const meta = [project, category].filter((part) => part !== "").join(" · ");
  const name = row.supplier_name ?? row.description;
  return (
    <Link className="ui-review-all-row ui-hit" to={href}>
      <Avatar name={name} fallback={row.source === "mercury" ? "bank" : "invoice"} />
      <span className="ui-review-all-text">
        <span className="ui-review-all-title">{name}</span>
        <span className={missing ? "ui-review-all-meta ui-review-all-missing" : "ui-review-all-meta"}>
          {missing ? <AlertIcon size={14} /> : null}
          <span className="ui-review-all-meta-text">{meta}</span>
        </span>
      </span>
      <bdi className={income ? "ui-review-all-amount ui-review-all-in ui-num" : "ui-review-all-amount ui-num"} dir="ltr">{formatAmountText(minor, currency, income ? { detail: true, direction: "income", plus: true } : { detail: true })}</bdi>
    </Link>
  );
}

/**
 * A project's waiting lines (/review?project=): the project's total waiting, the filled button that opens
 * the first, and the month heads with their count and total (board M4, M6).
 */
export function ProjectWaitingList({
  rows,
  search,
  backTo,
  backText,
  projectName,
  hrefFor,
  state = {},
}: {
  rows: ProjectWaitingRow[];
  search: string;
  backTo?: string;
  /** Back names the project it goes to. */
  backText?: string;
  projectName?: string;
  hrefFor?: (row: ProjectWaitingRow) => string;
  state?: ReviewListState;
}) {
  const ordered = useHeldOrder(rows, (row) => row.transaction_id);
  // FLOW-314: a card opened here walks the list's card rows; a row with a change to review opens its own screen.
  const location = useLocation();
  const listFrom = `${location.pathname}${location.search}`;
  const cardIds = ordered.filter((row) => row.review_id == null).map((row) => row.transaction_id);
  const hrefOf = (row: ProjectWaitingRow) => (hrefFor
    ? hrefFor(row)
    : row.review_id == null
      ? `/transactions/${row.transaction_id}${search}`
      : `/review/change${search}${search ? "&" : "?"}item=${row.review_id}`);
  const stateOf = (row: ProjectWaitingRow) => (hrefFor == null && row.review_id == null ? txnListState(cardIds, row.transaction_id, listFrom) : undefined);
  const amountOf = (row: ProjectWaitingRow) => {
    const abs = row.amount_net < 0n ? -row.amount_net : row.amount_net;
    return { minor: row.direction === "income" ? abs : -abs, currency: row.currency ?? "ILS" };
  };
  const totals = signedTotals(ordered, amountOf);
  const now = new Date();
  const months = groupByKey(ordered, (row) => ({ key: row.doc_date.slice(0, 7), title: searchMonthTitle(Number(row.doc_date.slice(0, 4)), Number(row.doc_date.slice(5, 7)) - 1, now) }), (row) => ({ minor: row.amount_net, currency: row.currency ?? "ILS", direction: "expense" }), true);
  const first = ordered[0];
  const count = ordered.length;
  const subtitle = `${projectName != null && projectName !== "" ? `${projectName} · ` : ""}${count === 1 ? "הוצאה אחת מחכה" : `${String(count)} הוצאות מחכות`}`;
  return (
    <div className="ui-review-waiting-page">
      <ScreenHeader layout="stacked" title="לאישור" subtitle={state.failed ? undefined : subtitle} backTo={backTo} backText={backText} />
      <ListBody state={state} failTitle="הפריטים לאישור לא נטענו">
        <ListTake figures={totals} />
        {first != null ? (
          <div className="ui-review-cta">
            <Button full to={hrefOf(first)} state={stateOf(first)} chevron>
              {count === 1 ? "לאישור הפריט" : `לאישור ${String(count)} הפריטים`}
              {" "}
              <span className="ui-review-cta-time">· {reviewMinutes(count)}</span>
            </Button>
          </div>
        ) : null}
        {/* One head per month, a lone month's too, with its count and total (board M6). */}
        <GroupList
          groups={months}
          keyOf={(row) => row.transaction_id}
          dateOf={(row) => row.doc_date}
          countOf={(lines) => lineCountHint(lines, false)}
          cents
          renderRow={(row) => (
            <ListRow
              variant="transaction"
              title={row.supplier_name ?? row.description}
              hint={[formatDayMonth(row.doc_date), row.category_name ?? ""].filter((part) => part !== "").join(" · ")}
              agorot={row.amount_net}
              currency={row.currency}
              sign="out"
              source={rowSource(row.source)}
              tag={row.kept_out === true ? <KeptOutTag label={KEPT_OUT} /> : undefined}
              href={hrefOf(row)}
              state={stateOf(row)}
            />
          )}
        />
      </ListBody>
    </div>
  );
}
