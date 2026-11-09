import { formatAmountText } from "@flow/shared";
import { Link } from "react-router-dom";
import { usePreviewSearch } from "../preview";
import { Button } from "../ui/button";
import { FoldItem } from "../ui/fold";
import { IconButton } from "../ui/icon-button";
import { CheckIcon, ChevronIcon } from "../ui/icons";
import { ListRow } from "../ui/list-row";
import { StatusMark } from "../ui/status-mark";
import type { UtilityBill } from "../utility-refunds";
import { billMeta, cardBillTitle, cardWhy, fixCopy, openMeta, paymentMeta, paymentTitle, type RefundCard } from "../utility-refund-view";

/**
 * One leg of a card: a name and its line at the start, the amount at the end. FLOW-1142: the leg opens its
 * transaction's page, so the owner can check the bill or the payment before answering.
 */
function Leg({ title, meta, amount, to }: { title: string; meta: string; amount: string; to: string }) {
  return (
    <li className="ui-urf-leg">
      <Link className="ui-urf-leg-link" to={to} aria-label={`${title} · ${amount} · פתיחת התנועה`}>
        <span className="ui-urf-leg-text">
          <span className="ui-urf-leg-title" data-clip-ok="">{title}</span>
          <span className="ui-urf-leg-meta">{meta}</span>
        </span>
        <bdi dir="ltr" className="ui-urf-leg-amount" data-income={amount.startsWith("+") ? "true" : undefined}>{amount}</bdi>
        <span className="ui-urf-leg-chevron" aria-hidden="true"><ChevronIcon size={16} /></span>
      </Link>
    </li>
  );
}

/**
 * FLOW-1135 (V3-UtilityRefunds): a suggested refund. The bill (or the month's bills) and the payment as two rows,
 * why Flow pairs them, then "זה ההחזר?" with כן / לא. After a yes on a payment filed elsewhere it shows הוחזר, the
 * "ייתכן שסווג לא נכון" note and its one button, with להשאיר. A viewer sees the card with no answers.
 */
export function RefundCardView({ card, readOnly, leaving, onYes, onNo, onRefile, onKeep }: {
  card: RefundCard;
  /** FLOW-1141: answered, the card folds away (ui/fold.tsx). */
  leaving: boolean;
  readOnly: boolean;
  onYes: () => void;
  onNo: () => void;
  onRefile: (category: string) => void;
  onKeep: () => void;
}) {
  const search = usePreviewSearch();
  const currency = card.payment.currency;
  const fix = fixCopy(card);
  return (
    <FoldItem as="div" leaving={leaving}>
      <section className="ui-urf-card m-page-enter" aria-label={`החזר אפשרי: ${cardBillTitle(card)}`}>
        <ul className="ui-urf-legs">
          {card.bills.map((bill) => (
            <Leg
              key={bill.bill_transaction_id}
              title={bill.supplier_name ?? "ספק"}
              meta={billMeta(bill)}
              amount={formatAmountText(bill.amount_minor, currency, { detail: true, direction: "expense" })}
              to={`/transactions/${bill.bill_transaction_id}${search}`}
            />
          ))}
          <Leg
            title={paymentTitle(card.payment)}
            meta={paymentMeta(card)}
            amount={formatAmountText(card.payment.amount_minor, currency, { detail: true, direction: "income", plus: true })}
            to={`/transactions/${card.payment.transaction_id}${search}`}
          />
        </ul>
        <p className="ui-urf-why">{cardWhy(card)}</p>
        {card.fix ? (
          <div className="ui-urf-fix">
            <span className="ui-urf-fix-done"><CheckIcon size={16} stroke={2.4} />הוחזר</span>
            <span className="ui-urf-fix-title">ייתכן שסווג לא נכון</span>
            <span className="ui-urf-fix-hint">{fix.hint}</span>
            {readOnly ? null : (
              <div className="ui-urf-actions">
                <Button onClick={() => { onRefile(card.bills[0]?.category_name ?? "החשבונות"); }}>{fix.label}</Button>
                <Button variant="secondary" className="ui-urf-keep" onClick={onKeep}>להשאיר</Button>
              </div>
            )}
          </div>
        ) : readOnly ? null : (
          <div className="ui-urf-ask">
            <h3 className="ui-urf-ask-title">זה ההחזר?</h3>
            <div className="ui-urf-actions">
              <Button onClick={onYes}>כן, זה ההחזר</Button>
              <Button variant="secondary" onClick={onNo}>לא</Button>
            </div>
          </div>
        )}
      </section>
    </FoldItem>
  );
}

/**
 * A bill not refunded: the dashed ring in the signal colour, the supplier, "לא הוחזר · N ימים · dd/mm", the amount.
 * The row opens the bill's sheet; the ✓ beside it is ראיתי. A viewer's row opens the bill's transaction and has no ✓. FLOW-1141:
 * closed, it slides toward its ✓ and folds away.
 */
export function OpenBillRow({ bill, readOnly, leaving, onOpen, onSeen }: { bill: UtilityBill; readOnly: boolean; leaving: boolean; onOpen: () => void; onSeen: () => void }) {
  const name = bill.supplier_name ?? "ספק";
  const search = usePreviewSearch();
  return (
    <FoldItem leaving={leaving} className="ui-urf-item m-page-enter">
      <ListRow
        variant="project"
        layout="flat"
        title={name}
        hint={openMeta(bill)}
        tone="warning"
        icon={<StatusMark kind="late" />}
        agorot={-bill.amount_minor}
        currency={bill.currency}
        signed
        href={readOnly ? `/transactions/${bill.bill_transaction_id}${search}` : undefined}
        onClick={readOnly ? undefined : onOpen}
      />
      {readOnly ? null : (
        <IconButton label={`ראיתי: ${name}`} className="ui-urf-seen" onClick={onSeen}>
          <CheckIcon size={20} stroke={2.2} />
        </IconButton>
      )}
    </FoldItem>
  );
}
