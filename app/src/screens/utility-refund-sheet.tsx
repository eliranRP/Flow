import { formatAmountText, type SearchRow } from "@flow/shared";
import { useState } from "react";
import { usePreviewSearch } from "../preview";
import { EMPTY_FILTERS, searchRowTitle, uniqueSearchRows, useSearchQuery, type SearchFilters } from "../search";
import { Button } from "../ui/button";
import { israelToday } from "../ui/date-math";
import { List, ListRow } from "../ui/list-row";
import { Sheet } from "../ui/sheet";
import { ListSkeleton } from "../ui/skeleton";
import { useUtilityRefundsQuery, type UtilityBill } from "../utility-refunds";
import { billStatusLine, isOpenBill, paymentsTaken, refundDate } from "../utility-refund-view";
import { BillContext } from "./utility-bill-context";

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
          hint={[row.category_name ?? "בלי קטגוריה", row.project_id == null ? "בלי פרויקט" : null, refundDate(row.doc_date)].filter(Boolean).join(" · ")}
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
 * FLOW-1135 (V3-UtilityRefunds), FLOW-1159 (V3-J-A3-Bill): a bill's drawer, opened from its row on the list or on the
 * property's bills by type. Its line and status, the type's pattern and history and the way into the income around it
 * (BillContext), then the answers: ראיתי, אין צורך בטיפול (the answer most bills get, and the board's first for a month
 * with no rent), החברה משלמת תמיד for the supplier, then הוחזר · בחירת התשלום, which lists the money in that may be its
 * refund. A refunded bill has no answers; a bill closed with ראיתי may still be matched. FLOW-1142: פתיחת התנועה opens
 * the bill's transaction page, to check it before answering.
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
  const search = usePreviewSearch();
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
          <p className="t-caption t-muted">{`${name} · ${formatAmountText(current.amount_minor, current.currency, { detail: true })} · ${refundDate(current.doc_date)}`}</p>
          <PaymentChoices bill={current} onPick={(paymentId) => { onPicked(current, paymentId); }} />
          <Button variant="link" onClick={() => { setPicking(false); }}>חזרה</Button>
        </>
      ) : (
        <>
          <p className="ui-urf-sheet-line">{[current.category_name, refundDate(current.doc_date), current.project_name].filter(Boolean).join(" · ")}</p>
          <p className="ui-urf-sheet-status" data-open={isOpenBill(current) || undefined}>{billStatusLine(current)}</p>
          {current.no_rent ? <span className="ui-urf-no-rent">חודש בלי שכירות בנכס</span> : null}
          <BillContext bill={current} />
          <div className="ui-urf-sheet-actions">
            {isOpenBill(current) ? <Button full onClick={() => { onSeen(current); }}>ראיתי, אין צורך בטיפול</Button> : null}
            {isOpenBill(current) ? <Button full variant="secondary" onClick={() => { onCompany(current); }}>{`החברה משלמת תמיד · ${name}`}</Button> : null}
            {current.state === "refunded" ? null : <Button full variant="link" onClick={() => { setPicking(true); }}>הוחזר · בחירת התשלום</Button>}
            <Button full variant="link" to={`/transactions/${current.bill_transaction_id}${search}`}>פתיחת התנועה</Button>
          </div>
        </>
      )}
    </Sheet>
  );
}
