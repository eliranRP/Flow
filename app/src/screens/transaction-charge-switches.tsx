import type { PaymentRecurring, RecurringPace, TransactionDetail } from "@flow/shared";
import { useRef, useState } from "react";
import { usePaymentRecurringQuery } from "../forecast";
import { getSupabase } from "../lib/supabase";
import { loadReadSchemas } from "../load-read-schemas";
import { useHomePreview } from "../preview";
import { transactionQueryOptions } from "../use-books";
import { assertNoError, useWrite } from "../use-write";
import { ChargeSwitches, chargeSwitchToast, paceToast } from "../ui/charge-switches";
import { PaceSheet } from "../ui/pace-sheet";
import { useToast } from "../ui/toast";
import { useBlockedPreview } from "./screen-shared";

type CashChange = { id: string; party: string; next: boolean | null; previous: boolean | null; on: boolean; undo: boolean };
type RecurringChange = { id: string; party: string; next: boolean | null; previous: boolean | null; on: boolean; income: boolean; undo: boolean };
/** `previous` and `shown` come back from set_payment_pace: the owner's pace before, and the pace now in use. */
type PaceChange = { id: string; party: string; next: RecurringPace | null; previous: RecurringPace | null; shown: RecurringPace; undo: boolean; close?: () => void };

/** The keys a cash or recurring switch changes: the line, Home's cash and attention box, the lists. */
const CASH_KEYS = ["txn", "dashboard", "home", "breakdown-lines"];
const RECURRING_KEYS = ["payment-recurring", "missing-bills", "recurring-changes", "expected-months", "party-charges"];

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
  const preview = useHomePreview();
  const blocked = useBlockedPreview();
  const query = usePaymentRecurringQuery(sample === undefined ? txn.id : "", sample === undefined);
  const [sampleCash, setSampleCash] = useState<boolean | null | undefined>(undefined);
  const [sampleOverride, setSampleOverride] = useState<boolean | null | undefined>(undefined);
  const [samplePace, setSamplePace] = useState<RecurringPace | null | undefined>(undefined);
  const [paceOpen, setPaceOpen] = useState(false);
  const [paceSaving, setPaceSaving] = useState<RecurringPace | null>(null);
  const paceRow = useRef<HTMLElement | null>(null);
  // A sample screen with no recurring state of its own: the line's party, not recurring yet.
  const recurring = sample === undefined
    ? query.data
    : (sample ?? {
        transaction_id: txn.id,
        party: { direction: txn.direction === "income" ? "income" as const : "expense" as const, id: "sample", name: party, currency: "ILS" },
        recurring: false,
        override: null,
        detected: false,
        typical_day: null,
        typical_amount_minor: null,
      });

  // A switch flips at once and the server's answer only corrects it (decision 0180).
  const cash = useWrite<CashChange>({
    failure: (error) => (error.message.includes("forbidden") ? "אין הרשאה לעדכן את השורה." : "לא הצלחנו לעדכן את השורה."),
    keys: CASH_KEYS,
    optimistic: (change) => (sample !== undefined ? [] : [{
      key: transactionQueryOptions(preview, txn.id).queryKey,
      update: (old: unknown) => (old == null ? old : { ...(old), in_cash_override: change.next }),
    }]),
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
    optimistic: (change) => (sample !== undefined ? [] : [{
      key: ["payment-recurring", preview, txn.id],
      update: (old: unknown) => (old == null ? old : { ...(old), override: change.next }),
    }]),
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

  // FLOW-415 D: the pace is the party's, like the recurring switch (decision 0175).
  const pace = useWrite<PaceChange>({
    failure: (error) => (error.message.includes("forbidden") ? "אין הרשאה לעדכן את השורה." : "לא הצלחנו לעדכן את השורה."),
    keys: RECURRING_KEYS,
    onSuccess: (done) => {
      setPaceSaving(null);
      done.close?.();
      toast.show({
        message: paceToast(done.party, done.shown),
        ...(done.undo ? {} : {
          action: "ביטול",
          onAction: () => {
            pace.mutate({ id: done.id, party: done.party, next: done.previous, previous: done.next, shown: done.previous ?? done.shown, undo: true });
          },
        }),
      });
    },
    onError: () => {
      setPaceSaving(null);
    },
    run: async (change) => {
      if (sample !== undefined) {
        setSamplePace(change.next);
        change.previous = samplePace !== undefined ? samplePace : (recurring?.pace_override ?? null);
        change.shown = change.next ?? recurring?.detected_pace ?? "month";
        return;
      }
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      // null goes back to the detected pace; the generated types mark every argument non-null.
      const result = await supabase.rpc("set_payment_pace", { p_id: change.id, p_pace: change.next as string });
      assertNoError(result);
      const state = (await loadReadSchemas()).paymentRecurringSchema.safeParse(result.data);
      if (state.success) {
        change.previous = state.data.prior_pace ?? null;
        change.shown = state.data.pace ?? change.next ?? change.shown;
      }
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
  const currentPace: RecurringPace = (samplePace !== undefined ? samplePace ?? recurring?.detected_pace : recurring?.pace) ?? "month";

  return (
    <>
      <ChargeSwitches
        state={{ inCash, recurring: isRecurring, typicalDay: recurring?.typical_day ?? null, detected: override == null && detected, pace: currentPace }}
        income={income}
        cashMixed={cashOverride == null && cashState === "mixed"}
        noParty={recurring != null && recurring.party == null}
        disabled={holdWrites}
        recurringDisabled={sample === undefined && query.isError}
        busy={{ recurring: sample === undefined && query.isLoading }}
        onCash={(next) => {
          if (holdWrites || (sample === undefined && blocked())) return;
          cash.mutate({ id: txn.id, party, next, previous: cashOverride, on: next, undo: false });
        }}
        onRecurring={(next) => {
          // A preview says why it can't save before anything else, so the switch never does nothing.
          if (holdWrites || (sample === undefined && blocked()) || !writes) return;
          mark.mutate({ id: txn.id, party, next, previous: override, on: next, income, undo: false });
        }}
        onPace={() => {
          if (holdWrites || !writes || (sample === undefined && blocked())) return;
          paceRow.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setPaceOpen(true);
        }}
      />
      <PaceSheet
        open={paceOpen}
        onOpenChange={setPaceOpen}
        value={currentPace}
        saving={paceSaving}
        returnFocusRef={paceRow}
        onPick={(next, close) => {
          if (pace.isPending) return;
          setPaceSaving(next);
          pace.mutate({ id: txn.id, party, next, previous: null, shown: next, undo: false, close });
        }}
      />
    </>
  );
}
