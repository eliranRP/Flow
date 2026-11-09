import { useState } from "react";
import { LEDGER_KEYS } from "../ledger-keys";
import { useInvalidateBooks } from "../use-books";
import { useToast } from "../ui/toast";
import {
  answerUtilityRefund,
  markUtilityRefundsSeen,
  refileUtilityRefund,
  restoreUtilityPayer,
  setUtilityPayer,
  undoUtilityRefile,
  unmarkUtilityRefundsSeen,
  UTILITY_PAYERS_KEY,
  UTILITY_REFUNDS_KEY,
  useUtilityRpc,
  type PayerPrior,
  type UtilityBill,
  type UtilityKey,
} from "../utility-refunds";
import { cardBillTitle, type LocalAnswer, type RefundCard, type RefundGroup } from "../utility-refund-view";

/** The reads an answer changes: the list, Home's count and the property's utilities. */
export const UTILITY_KEYS = [UTILITY_REFUNDS_KEY, "utility-refund-count", UTILITY_PAYERS_KEY] as const;

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
 * FLOW-1135 (V3-UtilityRefunds): every answer on the list. Each one takes its card or row away at once, writes,
 * and shows a toast whose ביטול calls the write's take-back path (answer null, unmark_utility_refunds_seen,
 * undo_utility_refile, set_utility_payer back to the prior). A failed write puts the card back and says so.
 */
export function useUtilityRefundActions() {
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const [local, setLocal] = useState<ReadonlyMap<string, LocalAnswer>>(new Map());

  const mark = (keys: readonly string[], value: LocalAnswer | null) => {
    setLocal((before) => {
      const next = new Map(before);
      for (const key of keys) {
        if (value == null) next.delete(key);
        else next.set(key, value);
      }
      return next;
    });
  };

  /** Runs a write; false after a failure, which the toast names. */
  async function write(run: () => Promise<unknown>, failure: string, ledger = false): Promise<boolean> {
    try {
      await run();
    } catch (error) {
      const changed = error instanceof Error && error.message.includes("line changed since");
      toast.show({ tone: "bad", message: changed ? FAILED.changed : failure });
      return false;
    }
    void invalidate(ledger ? [...UTILITY_KEYS, ...LEDGER_KEYS] : [...UTILITY_KEYS]);
    return true;
  }

  /** Hides `keys`, writes, and offers ביטול; `back` is what the keys show after the ביטול. */
  async function answer({ keys, run, failure, message, undo, back = null, ledger = false }: {
    keys: readonly string[];
    run: () => Promise<unknown>;
    failure: string;
    message: string;
    undo: () => Promise<unknown>;
    back?: LocalAnswer | null;
    ledger?: boolean;
  }) {
    mark(keys, "hidden");
    if (!(await write(run, failure, ledger))) {
      mark(keys, back);
      return;
    }
    toast.show({
      message,
      action: "ביטול",
      onAction: () => {
        void (async () => {
          if (await write(undo, FAILED.undo, ledger)) mark(keys, back);
        })();
      },
    });
  }

  const rpc = useUtilityRpc();
  const each = (card: RefundCard, run: (bill: UtilityBill) => Promise<void>) => async () => {
    for (const bill of card.bills) await run(bill);
  };

  return {
    local,
    /** כן, זה ההחזר: a payment filed elsewhere stays, with the note and its fix; otherwise the card goes. */
    yes(card: RefundCard) {
      const pay = card.payment.transaction_id;
      const run = each(card, (bill) => answerUtilityRefund(rpc(), bill.bill_transaction_id, "matched", pay));
      const message = `${cardBillTitle(card)} · סומן כהוחזר`;
      const undo = each(card, (bill) => answerUtilityRefund(rpc(), bill.bill_transaction_id, null, pay));
      if (!card.wrongCategory) {
        void answer({ keys: [card.key], run, failure: FAILED.answer, message, undo });
        return;
      }
      void (async () => {
        mark([card.key], "fix");
        if (!(await write(run, FAILED.answer))) {
          mark([card.key], null);
          return;
        }
        toast.show({
          message,
          action: "ביטול",
          onAction: () => {
            void (async () => {
              if (await write(undo, FAILED.undo)) mark([card.key], null);
            })();
          },
        });
      })();
    },
    /** לא: never suggested again for these bills. */
    no(card: RefundCard) {
      const pay = card.payment.transaction_id;
      void answer({
        keys: [card.key],
        run: each(card, (bill) => answerUtilityRefund(rpc(), bill.bill_transaction_id, "rejected", pay)),
        failure: FAILED.answer,
        message: "לא נציע את התשלום הזה שוב",
        undo: each(card, (bill) => answerUtilityRefund(rpc(), bill.bill_transaction_id, null, pay)),
      });
    },
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
        back: "fix",
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
        back: "fix",
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
    /** החברה משלמת תמיד: the utility turns company-paid, which closes all its open bills and suggestions. */
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
    /** סימון הכל כנראה: every open bill of the property, with one ביטול. Suggestions stay. */
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
