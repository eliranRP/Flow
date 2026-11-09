import { formatAmountText, type SearchRow } from "@flow/shared";
import { useState } from "react";
import { EMPTY_FILTERS, searchRowTitle, uniqueSearchRows, useSearchQuery, type SearchFilters } from "../search";
import { Button } from "../ui/button";
import { israelToday } from "../ui/date-math";
import { List, ListRow } from "../ui/list-row";
import { Sheet } from "../ui/sheet";
import { ListSkeleton } from "../ui/skeleton";
import { useUtilityRefundsQuery, type UtilityBill } from "../utility-refunds";
import { dayMonth, openMeta, paymentsTaken } from "../utility-refund-view";

/**
 * A month before the bill: where a refund may start (decision 0265's window). The same day a month earlier,
 * clamped to that month's last day (31 March gives 28 February).
 * @forTests
 */
export function refundWindowStart(billDate: string): string {
  const [year = 0, month = 1, day = 1] = billDate.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 2, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

function filters(bill: UtilityBill, project: string): SearchFilters {
  return { ...EMPTY_FILTERS, direction: "income", project, period: { kind: "custom", from: refundWindowStart(bill.doc_date), to: israelToday() } };
}

/**
 * Money in that may be the bill's refund: on its property or on none, in its currency, from a month before it. A
 * payment that is already another bill's refund is left out, unless that bill is of the same property and month
 * (one payment may refund a month's bills together).
 */
function usePaymentChoices(bill: UtilityBill, active: boolean): { rows: SearchRow[]; loading: boolean; failed: boolean; retry: () => void } {
  const own = useSearchQuery(filters(bill, bill.project_id), active);
  const none = useSearchQuery(filters(bill, "none"), active);
  const every = useUtilityRefundsQuery(null, active, true);
  const taken = paymentsTaken(every.data?.bills ?? [], bill);
  const rows = uniqueSearchRows([...(own.data?.pages ?? []), ...(none.data?.pages ?? [])])
    .filter((row) => row.currency === bill.currency && row.id !== bill.bill_transaction_id && !taken.has(row.id))
    .sort((a, b) => b.doc_date.localeCompare(a.doc_date));
  return {
    rows,
    loading: own.isPending || none.isPending || every.isPending,
    failed: own.isError || none.isError || every.isError,
    retry: () => {
      if (own.isError) void own.refetch();
      if (none.isError) void none.refetch();
      if (every.isError) void every.refetch();
    },
  };
}

function PaymentChoices({ bill, onPick }: { bill: UtilityBill; onPick: (paymentId: string) => void }) {
  const choices = usePaymentChoices(bill, true);
  if (choices.failed) {
    return (
      <div className="ui-urf-sheet-state" role="alert">
        <p className="t-caption t-muted">התשלומים לא נטענו.</p>
        <Button variant="secondary" onClick={choices.retry}>ניסיון חוזר</Button>
      </div>
    );
  }
  if (choices.loading) return <ListSkeleton />;
  if (choices.rows.length === 0) return <p className="ui-urf-sheet-state t-caption t-muted">אין תשלומים שנכנסו מחודש לפני החשבון ועד היום.</p>;
  return (
    <List>
      {choices.rows.map((row) => (
        <ListRow
          key={row.id}
          variant="project"
          layout="flat"
          title={searchRowTitle(row)}
          hint={[row.category_name ?? "בלי קטגוריה", row.project_id == null ? "בלי פרויקט" : null, dayMonth(row.doc_date)].filter(Boolean).join(" · ")}
          agorot={row.amount_original ?? row.amount_net}
          currency={row.currency}
          signed
          onClick={() => { onPick(row.id); }}
        />
      ))}
    </List>
  );
}

/**
 * FLOW-1135 (V3-UtilityRefunds): a bill not refunded, opened from its row. ראיתי, אין צורך בטיפול first (it is
 * the answer most bills get, and the board's first for a month with no rent), then החברה משלמת תמיד for the
 * supplier, then הוחזר · בחירת התשלום, which lists the money in that may be its refund.
 */
export function UtilityBillSheet({ bill, onOpenChange, onSeen, onCompany, onPicked }: {
  bill: UtilityBill | null;
  onOpenChange: (open: boolean) => void;
  onSeen: (bill: UtilityBill) => void;
  onCompany: (bill: UtilityBill) => void;
  onPicked: (bill: UtilityBill, paymentId: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [shown, setShown] = useState<UtilityBill | null>(bill);
  const [open, setOpen] = useState(false);
  // The sheet keeps drawing the bill while it slides out. Each opening starts on the actions, never on a picker left open.
  if (bill != null && (bill !== shown || !open)) {
    setShown(bill);
    setPicking(false);
  }
  if (open !== (bill != null)) setOpen(bill != null);
  const current = bill ?? shown;
  const name = current?.supplier_name ?? "ספק";
  return (
    <Sheet
      open={bill != null}
      onOpenChange={onOpenChange}
      title={picking ? "איזה תשלום החזיר אותו?" : name}
      aside={current == null || picking ? undefined : (
        <bdi dir="ltr" className="ui-urf-sheet-amount">{formatAmountText(current.amount_minor, current.currency, { detail: true, direction: "expense" })}</bdi>
      )}
    >
      {current == null ? null : picking ? (
        <>
          <p className="t-caption t-muted">{`${name} · ${formatAmountText(current.amount_minor, current.currency, { detail: true })} · ${dayMonth(current.doc_date)}`}</p>
          <PaymentChoices bill={current} onPick={(paymentId) => { onPicked(current, paymentId); }} />
          <Button variant="link" onClick={() => { setPicking(false); }}>חזרה</Button>
        </>
      ) : (
        <>
          <p className="ui-urf-sheet-line">{`${current.project_name} · ${openMeta(current)}`}</p>
          {current.no_rent ? <span className="ui-urf-no-rent">חודש בלי שכירות בנכס</span> : null}
          <div className="ui-urf-sheet-actions">
            <Button full onClick={() => { onSeen(current); }}>ראיתי, אין צורך בטיפול</Button>
            <Button full variant="secondary" onClick={() => { onCompany(current); }}>{`החברה משלמת תמיד · ${name}`}</Button>
            <Button full variant="link" onClick={() => { setPicking(true); }}>הוחזר · בחירת התשלום</Button>
          </div>
        </>
      )}
    </Sheet>
  );
}
