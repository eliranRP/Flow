import { useUtilityRefundsQuery, type UtilityBill } from "../utility-refunds";
import { usePreviewSearch } from "../preview";
import { Button } from "../ui/button";
import { GroupHead } from "../ui/group-head";
import { HintParts } from "../ui/hint-parts";
import { List, ListRow } from "../ui/list-row";
import { ListSkeleton } from "../ui/skeleton";
import { StatusMark, type StatusMarkKind } from "../ui/status-mark";
import { billStatusLine, isOpenBill, refundDate, typeHistory, typePattern } from "../utility-refund-view";

/** The mark a bill's state draws: ✓ refunded, a neutral dot for ראיתי, the dashed late ring while it is owed. */
export function billMark(bill: UtilityBill): StatusMarkKind {
  return bill.state === "refunded" ? "paid" : bill.state === "seen" ? "once" : "late";
}

/**
 * FLOW-1159 (V3-J-A3-Bill): what the bill's drawer shows above its answers. The type's pattern at the property (a
 * boxed line), the type's bills there newest activity first (the open bill on the tint, each a link to its
 * transaction), and the way into the income around the bill. The history reads the property's whole list.
 */
export function BillContext({ bill }: { bill: UtilityBill }) {
  const search = usePreviewSearch();
  const query = useUtilityRefundsQuery(null, true, true);
  const category = bill.category_name ?? "בלי קטגוריה";
  const history = typeHistory(query.data?.bills ?? [], bill);
  return (
    <>
      {query.isError ? (
        <div className="ui-urf-sheet-state" role="alert">
          <p className="t-caption t-muted">ההיסטוריה לא נטענה.</p>
          <Button variant="secondary" onClick={() => void query.refetch()}>ניסיון חוזר</Button>
        </div>
      ) : query.isPending ? (
        <ListSkeleton />
      ) : (
        <>
          <p className="ui-urf-pattern">{typePattern(query.data.bills, bill)}</p>
          <section className="ui-urf-sheet-group" aria-labelledby="urf-history">
            <GroupHead id="urf-history" title={`כל חשבונות ה${category} בנכס`} summary="עדכון אחרון ראשון" />
            <List>
              {history.map((item) => (
                <div key={item.bill_transaction_id} className="ui-urf-hist" data-current={item.bill_transaction_id === bill.bill_transaction_id || undefined}>
                  <ListRow
                    variant="project"
                    layout="flat"
                    title={refundDate(item.doc_date)}
                    hint={<HintParts text={billStatusLine(item)} />}
                    wrapHint
                    tone={isOpenBill(item) ? "warning" : undefined}
                    icon={<StatusMark kind={billMark(item)} />}
                    agorot={-item.amount_minor}
                    currency={item.currency}
                    signed
                    href={`/transactions/${item.bill_transaction_id}${search}`}
                  />
                </div>
              ))}
            </List>
          </section>
        </>
      )}
      <List>
        <ListRow
          variant="item"
          layout="flat"
          title="מה נכנס סביב החשבון הזה"
          hint={`תנועות נכנס של ${bill.project_name} · חודשיים לפני ואחרי ${refundDate(bill.doc_date)}`}
          wrapHint
          href={`/projects/${bill.project_id}/utilities/bills/${bill.bill_transaction_id}/income${search}`}
          chevron
        />
      </List>
    </>
  );
}
