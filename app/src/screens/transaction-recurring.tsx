import type { PartyCharges, PaymentRecurring, RecurringPace, TransactionDetail } from "@flow/shared";
import { useRef, useState } from "react";
import { usePaymentRecurringQuery } from "../forecast";
import { getSupabase } from "../lib/supabase";
import { usePartyChargesQuery } from "../party-charges";
import { usePreviewSearch } from "../preview";
import { assertNoError, useWrite } from "../use-write";
import { ChoiceSheet } from "../ui/choice-sheet";
import { RepeatIcon } from "../ui/icons";
import { IconRow } from "../ui/icon-row";
import { PACE_LABEL, paceSheetCopy, paceToast, type PaceChoice } from "../ui/pace";
import { PartyChargesHistory, PartyChargesSheet } from "../ui/related-charges";
import { useToast } from "../ui/toast";
import { useBlockedPreview } from "./screen-shared";

/** The keys a recurring or pace write changes: the party's payments, the missing bills, the lists. */
const RECURRING_KEYS = ["payment-recurring", "missing-bills", "recurring-changes", "expected-months", "party-charges"];

/** What a pick changes: the choice, and the state before it, so the undo is the same write back. */
type PaceChange = {
  id: string;
  next: PaceChoice;
  before: { recurring: boolean; pace: RecurringPace };
  undo: boolean;
  /** Closes the sheet once the save has settled (a close during the save waits for it). */
  close?: () => void;
};

/** The pace the row shows for a payment the owner has not set a pace for: every month. */
const DEFAULT_PACE: RecurringPace = "month";

/**
 * FLOW-366 (Lines.dc 113–140): the recurring row under the counted-in row, its pace sheet
 * (כל כמה זמן, with לא קבוע), and the party's history under it. The writes are the same as before:
 * set_payment_recurring, then set_payment_pace, each with an undo toast.
 */
export function TxnRecurring({
  txn,
  holdWrites,
  sample,
  sampleCharges,
  openSheet,
  context,
}: {
  txn: NonNullable<TransactionDetail>;
  holdWrites: boolean;
  /** A story's recurring state; set, the row writes locally. */
  sample?: PaymentRecurring | null;
  /** A story's party charges, in place of the party_charges read. */
  sampleCharges?: PartyCharges | null;
  /** A story's open sheet: the all-charges list or the pace choices. */
  openSheet?: "all" | "pace";
  /** The line's project and category, for the all-charges sheet's context line. */
  context: string;
}) {
  const search = usePreviewSearch();
  const toast = useToast();
  const blocked = useBlockedPreview();
  const recurringQuery = usePaymentRecurringQuery(sample === undefined ? txn.id : "", sample === undefined);
  const chargesQuery = usePartyChargesQuery(sample === undefined ? txn.id : "", sample === undefined);
  const charges = sample === undefined ? chargesQuery.data : sampleCharges;
  const [sampleState, setSampleState] = useState<{ recurring: boolean; pace: RecurringPace } | undefined>(undefined);
  const [paceOpen, setPaceOpen] = useState(openSheet === "pace");
  const [allOpen, setAllOpen] = useState(openSheet === "all");
  const [saving, setSaving] = useState<PaceChoice | null>(null);
  const paceRow = useRef<HTMLButtonElement>(null);
  const allRef = useRef<HTMLButtonElement>(null);
  // A sample without its own recurring state: the line's party, not recurring yet.
  const recurring = sample === undefined
    ? recurringQuery.data
    : (sample ?? {
        transaction_id: txn.id,
        party: { direction: txn.direction === "income" ? "income" as const : "expense" as const, id: "sample", name: txn.description, currency: txn.currency ?? "ILS" },
        recurring: false,
        override: null,
        detected: false,
        typical_day: null,
        typical_amount_minor: null,
      });
  const isRecurring = sampleState !== undefined ? sampleState.recurring : (recurring?.override ?? recurring?.detected ?? false);
  const pace: RecurringPace = sampleState !== undefined ? sampleState.pace : (recurring?.pace ?? recurring?.detected_pace ?? DEFAULT_PACE);
  const income = recurring?.party?.direction === "income" || (recurring?.party == null && txn.direction === "income");
  const overridden = sampleState !== undefined ? true : recurring?.override != null;
  const detectedPace = recurring?.detected_pace ?? null;

  const write = useWrite<PaceChange>({
    failure: (error) => (error.message.includes("forbidden") ? "אין הרשאה לעדכן את השורה." : "לא הצלחנו לעדכן את השורה."),
    keys: RECURRING_KEYS,
    onSuccess: (done) => {
      setSaving(null);
      done.close?.();
      if (done.undo) return;
      toast.show({
        message: done.next === "never" ? "סומן כלא קבוע" : paceToast(done.next),
        action: "ביטול",
        onAction: () => {
          write.mutate({
            id: done.id,
            next: done.before.recurring ? done.before.pace : "never",
            before: { recurring: done.next !== "never", pace },
            undo: true,
          });
        },
      });
    },
    onError: () => {
      setSaving(null);
    },
    run: async (change) => {
      if (sample !== undefined) {
        setSampleState(change.next === "never" ? { recurring: false, pace: change.before.pace } : { recurring: true, pace: change.next });
        return;
      }
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      if (change.next === "never") {
        assertNoError(await supabase.rpc("set_payment_recurring", { p_id: change.id, p_recurring: false }));
        return;
      }
      // A payment that is not recurring turns on first, then takes the pace (decision 0175).
      if (!change.before.recurring) assertNoError(await supabase.rpc("set_payment_recurring", { p_id: change.id, p_recurring: true }));
      assertNoError(await supabase.rpc("set_payment_pace", { p_id: change.id, p_pace: change.next }));
    },
  });

  // FLOW-366: a recurring rule needs a party to follow, so a line with no supplier or customer is locked.
  const noParty = recurring != null && recurring.party == null;
  const hint = noParty ? "אין ספק או לקוח בשורה" : isRecurring
    ? [
        recurring?.typical_day == null ? null : `בערך ב־${String(recurring.typical_day)} לחודש`,
        overridden ? "סימנת" : "זוהה לבד",
      ].filter((part): part is string => part != null).join(" · ")
    : "סמנו אם השורה חוזרת, ונזהיר כשהיא לא מגיעה";
  const valueWord = isRecurring ? (income ? "הכנסה קבועה" : "תשלום קבוע") : "לא קבוע";
  const tag = isRecurring ? PACE_LABEL[pace] : "לא קבוע";
  const choice: PaceChoice = isRecurring ? pace : "never";
  const showHistory = isRecurring && charges != null;

  return (
    <section className="ui-recurring-card">
      <IconRow
        icon={<RepeatIcon />}
        label="קבוע"
        value={valueWord}
        hint={hint}
        tag={<span className={isRecurring ? "ui-recurring-tag" : "ui-recurring-tag ui-recurring-tag-off"}>{tag}</span>}
        disabled={holdWrites || noParty || (sample === undefined && recurringQuery.isError)}
        busy={sample === undefined && recurringQuery.isLoading}
        buttonRef={paceRow}
        onClick={() => {
          if (holdWrites || noParty || (sample === undefined && blocked())) return;
          setPaceOpen(true);
        }}
      />
      {showHistory ? (
        <div className="ui-recurring-history">
          <PartyChargesHistory
            data={charges}
            search={search}
            showAllRef={allRef}
            onShowAll={() => {
              setAllOpen(true);
            }}
          />
        </div>
      ) : null}
      {charges != null && showHistory ? (
        <PartyChargesSheet open={allOpen} onOpenChange={setAllOpen} data={charges} search={search} context={context} returnFocusRef={allRef} />
      ) : null}
      <ChoiceSheet
        copy={paceSheetCopy(detectedPace, recurring?.party?.name ?? txn.description)}
        open={paceOpen}
        onOpenChange={setPaceOpen}
        value={choice}
        saving={saving}
        returnFocusRef={paceRow}
        onPick={(next, close) => {
          if (write.isPending || (sample === undefined && blocked())) return;
          if (next === choice) {
            close();
            return;
          }
          setSaving(next);
          write.mutate({ id: txn.id, next, before: { recurring: isRecurring, pace }, undo: false, close });
        }}
      />
    </section>
  );
}
