import type { PaymentRecurring, TransactionDetail } from "@flow/shared";
import { useState } from "react";
import { usePaymentRecurringQuery } from "../forecast";
import { getSupabase } from "../lib/supabase";
import { assertNoError, useWrite } from "../use-write";
import { ChargeSwitches, chargeSwitchToast } from "../ui/charge-switches";
import { useToast } from "../ui/toast";
import { useBlockedPreview } from "./screen-shared";

type CashChange = { id: string; party: string; next: boolean | null; previous: boolean | null; on: boolean; undo: boolean };
type RecurringChange = { id: string; party: string; next: boolean | null; previous: boolean | null; on: boolean; income: boolean; undo: boolean };

/** The keys a cash or recurring switch changes: the line, Home's cash and attention box, the lists. */
const CASH_KEYS = ["txn", "dashboard", "home", "breakdown-lines"];
const RECURRING_KEYS = ["payment-recurring", "missing-bills", "recurring-changes", "expected-months"];

/**
 * FLOW-415 (layout A, a-3): נספר בתזרים and חיוב קבוע under נספר ברווח, each with an undo toast.
 * The cash switch writes the line's own override (decision 0168); the recurring switch writes the
 * party's, so it covers all of that party's payments in the currency (decision 0172).
 */
export function TxnChargeSwitches({
  txn,
  party,
  holdWrites,
  sample,
}: {
  txn: NonNullable<TransactionDetail>;
  party: string;
  holdWrites: boolean;
  /** A story's recurring state; set, the switches write locally. */
  sample?: PaymentRecurring | null;
}) {
  const toast = useToast();
  const blocked = useBlockedPreview();
  const query = usePaymentRecurringQuery(sample === undefined ? txn.id : "", sample === undefined);
  const [sampleCash, setSampleCash] = useState<boolean | null | undefined>(undefined);
  const [sampleOverride, setSampleOverride] = useState<boolean | null | undefined>(undefined);
  const recurring = sample === undefined ? query.data : sample;

  const cash = useWrite<CashChange>({
    failure: (error) => (error.message.includes("forbidden") ? "אין הרשאה לעדכן את השורה." : "לא הצלחנו לעדכן את השורה."),
    keys: CASH_KEYS,
    onSuccess: (done) => {
      toast.show({
        message: chargeSwitchToast(done.party, "cash", done.on),
        ...(done.undo ? {} : {
          action: "ביטול",
          onAction: () => {
            cash.mutate({ ...done, next: done.previous, previous: done.next, on: !done.on, undo: true });
          },
        }),
      });
    },
    run: async (change) => {
      if (sample !== undefined) {
        setSampleCash(change.next);
        return;
      }
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      // null clears the override; the generated types mark every argument non-null.
      assertNoError(await supabase.rpc("set_transaction_cash", { p_id: change.id, p_in_cash: change.next as boolean }));
    },
  });

  const mark = useWrite<RecurringChange>({
    failure: (error) => (error.message.includes("forbidden") ? "אין הרשאה לעדכן את השורה." : "לא הצלחנו לעדכן את השורה."),
    keys: RECURRING_KEYS,
    onSuccess: (done) => {
      toast.show({
        message: chargeSwitchToast(done.party, done.income ? "income" : "recurring", done.on),
        ...(done.undo ? {} : {
          action: "ביטול",
          onAction: () => {
            mark.mutate({ ...done, next: done.previous, previous: done.next, on: !done.on, undo: true });
          },
        }),
      });
    },
    run: async (change) => {
      if (sample !== undefined) {
        setSampleOverride(change.next);
        return;
      }
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("set_payment_recurring", { p_id: change.id, p_recurring: change.next as boolean }));
    },
  });

  // The cash view reads the line's override first, then its categories (decision 0168).
  const cashOverride = sampleCash !== undefined ? sampleCash : (txn.in_cash_override ?? null);
  const cashState = sampleCash !== undefined ? (sampleCash === false ? "out" : "in") : (txn.cash_state ?? "in");
  const inCash = cashOverride != null ? cashOverride : cashState !== "out";
  const override = sampleOverride !== undefined ? sampleOverride : (recurring?.override ?? null);
  const detected = recurring?.detected ?? false;
  const isRecurring = override ?? detected;
  const income = recurring?.party?.direction === "income" || (recurring?.party == null && txn.direction === "income");
  const writes = !holdWrites && recurring != null;

  return (
    <ChargeSwitches
      state={{ inCash, recurring: isRecurring, typicalDay: recurring?.typical_day ?? null, detected: override == null && detected }}
      income={income}
      cashMixed={cashOverride == null && cashState === "mixed"}
      noParty={recurring != null && recurring.party == null}
      disabled={holdWrites}
      busy={{ cash: cash.isPending, recurring: mark.isPending || (sample === undefined && query.isLoading) }}
      onCash={(next) => {
        if (holdWrites || cash.isPending || (sample === undefined && blocked())) return;
        cash.mutate({ id: txn.id, party, next, previous: cashOverride, on: next, undo: false });
      }}
      onRecurring={(next) => {
        if (!writes || mark.isPending || (sample === undefined && blocked())) return;
        mark.mutate({ id: txn.id, party, next, previous: override, on: next, income, undo: false });
      }}
    />
  );
}
