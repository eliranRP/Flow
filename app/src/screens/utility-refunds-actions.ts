import { useState } from "react";
import { LEDGER_KEYS } from "../ledger-keys";
import { useInvalidateBooks } from "../use-books";
import { useFold } from "../ui/fold";
import { useToast } from "../ui/toast";
import {
  answerUtilityRefund,
  markUtilityRefundsSeen,
  refileUtilityRefund,
  restoreUtilityPayer,
  setUtilityPayer,
  undoUtilityRefile,
  unmarkUtilityRefundsSeen,
  UTILITY_INCOME_KEY,
  UTILITY_MONTHS_KEY,
  UTILITY_PAYERS_KEY,
  UTILITY_REFUNDS_KEY,
  useUtilityRpc,
  type PayerPrior,
  type UtilityBill,
  type UtilityKey,
} from "../utility-refunds";
import type { RefundCard, RefundGroup } from "../utility-refund-view";

/** The reads an answer changes: the list, Home's count, the property's utilities and months, and a bill's income. */
export const UTILITY_KEYS = [UTILITY_REFUNDS_KEY, "utility-refund-count", UTILITY_PAYERS_KEY, UTILITY_MONTHS_KEY, UTILITY_INCOME_KEY] as const;

const FAILED = {
  answer: "התשובה לא נשמרה. אפשר לנסות שוב.",
  keep: "ההשארה לא נשמרה. אפשר לנסות שוב.",
  seen: "הסימון לא נשמר. אפשר לנסות שוב.",
  all: "סימון החשבונות לא נשמר. אפשר לנסות שוב.",
  payer: "השינוי של מי משלם לא נשמר. אפשר לנסות שוב.",
  refile: "ההעברה לא נשמרה. אפשר לנסות שוב.",
  undo: "הביטול לא נשמר. אפשר לנסות שוב.",
  changed: "השורה השתנתה מאז, אז אי אפשר לבטל את ההעברה.",
} as const;

function keyOf(bill: UtilityBill): UtilityKey {
  return { projectId: bill.project_id, supplierId: bill.supplier_id, currency: bill.currency };
}

function sameUtility(bill: UtilityBill, key: UtilityKey): boolean {
  return bill.project_id === key.projectId && bill.supplier_id === key.supplierId && bill.currency === key.currency;
}

/**
 * FLOW-1135 (V3-UtilityRefunds): every answer on the list. Each one folds its card or row away at once (FLOW-1141:
 * the v3 row-card fold, ui/fold.tsx; it stays in the list until the fold ends), writes, and shows a toast whose
 * ביטול calls the write's take-back path (answer null, unmark_utility_refunds_seen, undo_utility_refile,
 * set_utility_payer back to the prior) and brings it back. A failed write puts the card back and says so. The
 * reads refresh once the fold has ended, so the data drops a row only after it has folded.
 */
export function useUtilityRefundActions() {
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  // The cards and rows answered here: hidden until the next read drops them, or back on ביטול.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const { leaving, fold, cancel } = useFold();

  const mark = (keys: readonly string[], hide: boolean) => {
    setHidden((before) => {
      const next = new Set(before);
      for (const key of keys) {
        if (hide) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };


  const refresh = (ledger: boolean) => {
    void invalidate(ledger ? [...UTILITY_KEYS, ...LEDGER_KEYS] : [...UTILITY_KEYS]);
  };

  /** Runs a write; false after a failure, which the toast names. With `now`, the reads refresh at once. */
  async function write(run: () => Promise<unknown>, failure: string, ledger = false, now = true): Promise<boolean> {
    try {
      await run();
    } catch (error) {
      const changed = error instanceof Error && error.message.includes("line changed since");
      toast.show({ tone: "bad", message: changed ? FAILED.changed : failure });
      return false;
    }
    if (now) refresh(ledger);
    return true;
  }

  /** Folds `keys` away, writes, and offers ביטול, which brings them back. */
  async function answer({ keys, run, failure, message, undo, ledger = false }: {
    keys: readonly string[];
    run: () => Promise<unknown>;
    failure: string;
    message: string;
    undo: () => Promise<unknown>;
    ledger?: boolean;
  }) {
    // Each row is hidden as its own fold ends, unless a failure or ביטול stopped it.
    const folds = keys.map((key) => fold(key, () => { mark([key], true); }));
    if (!(await write(run, failure, ledger, false))) {
      for (const key of keys) cancel(key);
      return;
    }
    toast.show({
      message,
      action: "ביטול",
      onAction: () => {
        void (async () => {
          if (!(await write(undo, FAILED.undo, ledger))) return;
          for (const key of keys) cancel(key);
          mark(keys, false);
        })();
      },
    });
    await Promise.all(folds);
    refresh(ledger);
  }

  const rpc = useUtilityRpc();
  const each = (card: RefundCard, run: (bill: UtilityBill) => Promise<void>) => async () => {
    for (const bill of card.bills) await run(bill);
  };

  return {
    hidden,
    /** The cards and rows folding away now, by key (a card's key or a bill's id). */
    leaving,
    /** The one-tap fix: the payment (or the bills' part of it) moves to the bills' category. */
    refile(card: RefundCard, category: string) {
      const [first] = card.bills;
      if (first == null) return;
      const pay = card.payment.transaction_id;
      void answer({
        keys: [card.key],
        run: () => refileUtilityRefund(rpc(), first.bill_transaction_id, pay),
        failure: FAILED.refile,
        message: `נרשם כהחזר ב${category}`,
        undo: () => undoUtilityRefile(rpc(), first.bill_transaction_id, pay),
        ledger: true,
      });
    },
    /** להשאיר: the books stay as they are; the refund keeps its category, so the note goes. ביטול drops the keep. */
    keep(card: RefundCard) {
      const pay = card.payment.transaction_id;
      void answer({
        keys: [card.key],
        run: each(card, (bill) => answerUtilityRefund(rpc(), bill.bill_transaction_id, "matched", pay, true)),
        failure: FAILED.keep,
        message: "נשאר כמו שהוא",
        undo: each(card, (bill) => answerUtilityRefund(rpc(), bill.bill_transaction_id, "matched", pay, false)),
      });
    },
    /** ראיתי, אין צורך בטיפול: closes this bill. */
    seen(bill: UtilityBill) {
      void answer({
        keys: [bill.bill_transaction_id],
        run: () => answerUtilityRefund(rpc(), bill.bill_transaction_id, "seen", null),
        failure: FAILED.seen,
        message: `${bill.supplier_name ?? "החשבון"} · ראיתי`,
        undo: () => answerUtilityRefund(rpc(), bill.bill_transaction_id, null, null),
      });
    },
    /** הוחזר · בחירת התשלום: the owner names the payment. */
    picked(bill: UtilityBill, paymentId: string) {
      void answer({
        keys: [bill.bill_transaction_id],
        run: () => answerUtilityRefund(rpc(), bill.bill_transaction_id, "matched", paymentId),
        failure: FAILED.answer,
        message: `${bill.supplier_name ?? "החשבון"} · סומן כהוחזר`,
        undo: () => answerUtilityRefund(rpc(), bill.bill_transaction_id, null, paymentId),
      });
    },
    /** החברה משלמת תמיד: the utility turns company-paid, which closes all its open bills and its cards. */
    company(bill: UtilityBill, groups: readonly RefundGroup[]) {
      const key = keyOf(bill);
      const keys = groups.flatMap((group) => [
        ...group.open.filter((item) => sameUtility(item, key)).map((item) => item.bill_transaction_id),
        ...group.cards.filter((card) => card.bills.every((item) => sameUtility(item, key))).map((card) => card.key),
      ]);
      let prior: PayerPrior = null;
      void answer({
        keys,
        run: async () => { prior = await setUtilityPayer(rpc(), key, "company"); },
        failure: FAILED.payer,
        message: `${bill.supplier_name ?? "הספק"} ב${bill.project_name} · החברה משלמת`,
        undo: () => restoreUtilityPayer(rpc(), key, prior),
      });
    },
    /** סימון הכל כנראה: every open bill of the property, with one ביטול. A fix card stays. */
    markAll(group: RefundGroup) {
      let closed: string[] = group.open.map((bill) => bill.bill_transaction_id);
      void answer({
        keys: closed,
        run: async () => { closed = await markUtilityRefundsSeen(rpc(), group.projectId); },
        failure: FAILED.all,
        message: `${group.name} · ${String(group.open.length)} סומנו כנראה`,
        undo: () => unmarkUtilityRefundsSeen(rpc(), closed),
      });
    },
  };
}
