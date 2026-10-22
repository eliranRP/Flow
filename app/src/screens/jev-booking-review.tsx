import { formatMoney } from "@flow/shared";
import { useRef } from "react";
import { dayMonth } from "../line-composer";
import { jevBookingFailure, jevBookingsKey, JEV_BOOKING_APPROVED, JEV_BOOKING_DELETED, JEV_BOOKING_UNDONE, liveJevBookingApi, type JevBooking, type JevBookingApi } from "../jev-bookings";
import { useHomePreview } from "../preview";
import { reviewListPath } from "./review-shared";
import { useLineMetaQuery } from "../use-books";
import { useHoldWrites, ViewerNote, ViewerScope } from "../use-is-viewer";
import { useWrite } from "../use-write";
import { ActionBar } from "../ui/action-bar";
import { BookingReviewCard } from "../ui/booking-review-card";
import { Button } from "../ui/button";
import { CheckIcon } from "../ui/icons";
import { ReviewCount, ReviewSegments, reviewCountDigits } from "../ui/review-count";
import { ScreenHeader } from "../ui/screen-header";
import { journalRows } from "./transaction-journal";

/** The bar's hint under אישור and ביטול (board LedgerReviewCard). */
export const JEV_BOOKING_HINT = "ביטול מסיר את הפקודה של Jev, והתנועה חוזרת לשיוך רגיל";
/** The hint when Jev made the line itself (book_line): ביטול deletes it. */
export const JEV_BOOKING_DELETE_HINT = "ביטול מוחק את התנועה ש־Jev יצר.";

type Next = { name: string; minor: bigint; currency: string } | null;

/**
 * FLOW-955 (board LedgerReviewCard). לאישור while Jev's bookings wait: they come first, one card at a time,
 * then the queue's own cards. אישור keeps the booking; ביטול takes it back (the line returns to its normal
 * assignment). Each answer leaves the list at once and the next card shows.
 */
export function JevBookingReview({
  bookings,
  queued,
  next,
  search,
  api = liveJevBookingApi,
  sample = false,
}: {
  bookings: readonly JevBooking[];
  /** The queue's own cards still waiting after Jev's bookings. */
  queued: number;
  /** The queue's first card, named under this one when this is Jev's last booking. */
  next: Next;
  search: string;
  api?: JevBookingApi;
  /** Stories: no bank details read. */
  sample?: boolean;
}) {
  const preview = useHomePreview();
  const holdWrites = useHoldWrites();
  const booking = bookings[0];
  /** The kind of the booking ביטול is taking back, for its toast. */
  const undoKind = useRef<JevBooking["kind"]>("line_split");
  const meta = useLineMetaQuery(booking?.transaction_id ?? null, !sample && booking != null);
  const drop = (transactionId: string) => [{
    key: jevBookingsKey(preview),
    update: (old: unknown) => (Array.isArray(old) ? (old as JevBooking[]).filter((item) => item.transaction_id !== transactionId) : old),
  }];
  const keys = ["jev-bookings", "txn", "review", "dashboard", "project", "project-category", "home", "breakdown", "breakdown-lines", "line-split"];
  const approve = useWrite<string>({
    place: "bar",
    keys,
    success: JEV_BOOKING_APPROVED,
    failure: jevBookingFailure,
    optimistic: drop,
    run: (transactionId) => api.approve(transactionId),
  });
  const undo = useWrite<string>({
    place: "bar",
    keys,
    success: () => (undoKind.current === "book_line" ? JEV_BOOKING_DELETED : JEV_BOOKING_UNDONE),
    failure: jevBookingFailure,
    optimistic: drop,
    run: (transactionId) => api.undo(transactionId),
  });
  if (booking == null || booking.journal == null) return null;
  const total = bookings.length + queued;
  const { debit, credit } = journalRows(booking.journal, meta.data?.account ?? null);
  const moneyIn = booking.amount_gross > 0n;
  const following: Next = bookings[1] != null
    ? { name: bookings[1].party, minor: bookings[1].amount_gross, currency: bookings[1].currency }
    : next;
  const busy = approve.isPending || undo.isPending;
  return (
    <ViewerScope>
      <div className="ui-review-queue" data-bar={holdWrites ? undefined : ""}>
        <ScreenHeader
          title="לאישור"
          backTo="/"
          backText="בית"
          trailing={<Button variant="link" to={reviewListPath(search)} className="ui-review-show-all">הצגת הכול</Button>}
        />
        <div className="ui-review-counts">
          <span className="t-caption t-muted ui-review-counter">
            {"פריט "}
            <ReviewCount value={1} digits={reviewCountDigits(total)} side="index" />
            {" מתוך "}
            <ReviewCount value={total} digits={reviewCountDigits(total)} side="total" />
          </span>
        </div>
        {holdWrites ? null : <ReviewSegments index={1} total={total} />}
        <div className="ui-review-motion" key={booking.write_id}>
          <BookingReviewCard
            party={booking.party}
            sourceLine={`${dayMonth(booking.doc_date)} · ${moneyIn ? "נכנס" : "יצא"} · ${booking.source === "mercury" ? "שורת בנק" : "תנועה ידנית"}`}
            amount={moneyIn ? booking.amount_gross : -booking.amount_gross}
            currency={booking.currency}
            moneyIn={moneyIn}
            income={booking.journal.legs.some((leg) => leg.in_pnl && leg.account_type === "income")}
            debit={debit}
            credit={credit}
            balanced={booking.journal.balanced}
            // from=review: the composer's ✕ and its save come back to לאישור.
            editTo={holdWrites ? undefined : `/transactions/${booking.transaction_id}/journal${search}${search === "" ? "?" : "&"}from=review`}
          />
        </div>
        {!holdWrites && following != null ? (
          <div className="ui-review-next t-caption t-muted">
            <span>{`הבא בתור: ${following.name}`}</span>
            <bdi className="ui-num" dir="ltr">{formatMoney(following.minor < 0n ? -following.minor : following.minor, following.currency)}</bdi>
          </div>
        ) : null}
        {holdWrites ? <ViewerNote className="t-caption t-muted ui-viewer-note" /> : (
          <ActionBar>
            <div className="ui-action-bar-row ui-review-actions ui-review-actions-two">
              <div className="ui-review-approve">
                <Button full icon={<CheckIcon />} disabled={busy} busy={approve.isPending} onClick={() => { approve.mutate(booking.transaction_id); }}>
                  אישור
                </Button>
              </div>
              <Button variant="secondary" disabled={busy} busy={undo.isPending} onClick={() => { undoKind.current = booking.kind; undo.mutate(booking.transaction_id); }}>ביטול</Button>
            </div>
            <p className="t-caption t-muted ui-review-bar-hint">{booking.kind === "book_line" ? JEV_BOOKING_DELETE_HINT : JEV_BOOKING_HINT}</p>
          </ActionBar>
        )}
      </div>
    </ViewerScope>
  );
}
