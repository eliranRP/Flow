import { formatMoney, type TransactionDetail } from "@flow/shared";
import { absAgorot } from "../agorot";
import { splitAccountLast4, type TxnMeta } from "../txn-meta";
import { Amount } from "../ui/amount";
import { StatusDot } from "../ui/status-dot";
import { formatDisplay } from "../ui/date-math";

/**
 * FLOW-366 (Lines.dc 101–106 and 147–153): the transaction page's header and footer. The header is
 * the status, supplier, amount and meta lines; the footer is Jev's note, the bank line and the raw
 * bank description. Method, counterparty and memo are not drawn here (MCP get_transaction keeps them).
 */

/** The status line's words: an open review, else approved with its payment. Null when neither is known. */
export function txnStatus(txn: NonNullable<TransactionDetail>): { text: string; open: boolean } | null {
  if (txn.review_status === "open") return { text: "ממתין לאישור", open: true };
  const paid = txn.paid === true && (txn.open_gross_agorot == null || txn.open_gross_agorot === 0n);
  if (txn.review_status == null) return paid ? { text: "שולם", open: false } : null;
  const approved = txn.review_status === "approved" || txn.review_status === "changed";
  const text = approved ? (paid ? "מאושר · שולם" : "מאושר") : paid ? "שולם" : "מאושר";
  return { text, open: false };
}

/** The source copy in the meta line. A SUMIT line with a bank line matched says both. */
export function txnSourceLabel(source: string, bankMatched: boolean): string {
  if (source === "mercury") return "שורת בנק";
  if (source === "sumit") return bankMatched ? "חשבונית + שורת בנק" : "חשבונית";
  if (source === "photo") return "חשבונית מצולמת";
  return "רשומה ידנית";
}

/** Jev's note under the footer: how the line was classified (decision 0041 and the review rules). */
export function jevNote(reviewStatus: string | null | undefined): string {
  if (reviewStatus === "open") return "הצעה, עוד לא אושרה.";
  if (reviewStatus === "approved" || reviewStatus === "changed") return "אושר ידנית.";
  return "שויך אוטומטית לפי חוק לספק הזה.";
}

/** The header block: the status, the supplier, the amount and the meta lines (date, direction, source). */
export function TxnHead({
  txn,
  party,
  moneyIn,
  meta,
  unsigned = false,
}: {
  txn: NonNullable<TransactionDetail>;
  party: string;
  moneyIn: boolean;
  meta: TxnMeta | undefined;
  /** The board's frames draw the header figure without its minus (a story or proof opt-in). */
  unsigned?: boolean;
}) {
  const status = txnStatus(txn);
  const direction = moneyIn ? "הכנסה" : "הוצאה";
  const bankMatched = meta?.account != null;
  const vatShown = (txn.currency ?? "ILS") === "ILS";
  return (
    <div className="ui-txn-head">
      {status == null ? null : (
        <div className="ui-txn-status">
          <StatusDot tone={status.open ? "accent" : undefined}>{status.text}</StatusDot>
        </div>
      )}
      <p className="t-name ui-txn-supplier ui-party">{party}</p>
      <p className="t-detail ui-txn-amount">
        <Amount agorot={absAgorot(txn.amount_net)} presentation="detail" currency={txn.currency} direction={unsigned ? undefined : moneyIn ? "income" : "expense"} income={moneyIn} size="display" />
      </p>
      <p className="t-meta ui-txn-meta">
        <span className="ui-nowrap"><bdi dir="ltr">{formatDisplay(txn.doc_date)}</bdi> · {direction} · {txnSourceLabel(txn.source, bankMatched)}</span>
      </p>
      {vatShown ? (
        <p className="t-meta ui-txn-meta">
          <span className="ui-nowrap">לפני מע״מ</span>
          {txn.vat_amount !== 0n ? (
            <span className="ui-nowrap">
              {" · "}
              {txn.vat_status === "assumed" ? "מע״מ (משוער) " : "מע״מ "}
              <bdi dir="ltr">{formatMoney(absAgorot(txn.vat_amount), txn.currency, { agorot: true })}</bdi>
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** The footer: Jev's note, the bank line (account and date), and the raw bank description. */
export function TxnFooter({ txn, meta }: { txn: NonNullable<TransactionDetail>; meta: TxnMeta | undefined }) {
  const account = meta?.account ?? null;
  const last4 = account == null ? null : splitAccountLast4(account).last4;
  const raw = meta?.bank_description ?? null;
  return (
    <footer className="ui-txn-footer t-caption">
      <p>
        <span className="ui-txn-jev">✦ Jev</span> · {jevNote(txn.review_status)}
      </p>
      {account == null ? null : (
        <p>
          <bdi dir="ltr">{splitAccountLast4(account).name}{last4 == null ? "" : ` ••${last4}`}</bdi> · <bdi dir="ltr">{formatDisplay(txn.doc_date)}</bdi>
        </p>
      )}
      {raw == null || raw === "" ? null : <p className="ui-txn-raw" dir="ltr">{raw}</p>}
    </footer>
  );
}
