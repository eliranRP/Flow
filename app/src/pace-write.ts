import type { RecurringPace } from "@flow/shared";
import type { RpcClient } from "./recurring-actions";
import { assertNoError } from "./use-write";
import type { PaceChoice } from "./ui/pace";

/**
 * The keys a recurring, pace or alert write changes: the schedule, the payment's switch, the late
 * bills and changes, the party's history and Home's rows. Shared by the list, the charge page and
 * the transaction page.
 */
export const RECURRING_KEYS = ["recurring-schedule", "payment-recurring", "missing-bills", "recurring-changes", "expected-months", "party-charges", "home"];

/** A pick on the pace sheet: the payment, the choice, and the state before it (the undo writes it back). */
export type PaceWrite = {
  id: string;
  next: PaceChoice;
  before: { recurring: boolean; pace: RecurringPace };
};

/**
 * The RPCs of one pace pick (FLOW-415, decision 0175). לא קבוע clears the switch and has no pace;
 * a pace on a payment that is not recurring turns the switch on first, then sets the pace.
 */
export async function runPaceChange(client: RpcClient, change: PaceWrite): Promise<void> {
  if (change.next === "never") {
    assertNoError(await client.rpc("set_payment_recurring", { p_id: change.id, p_recurring: false }));
    return;
  }
  if (!change.before.recurring) assertNoError(await client.rpc("set_payment_recurring", { p_id: change.id, p_recurring: true }));
  assertNoError(await client.rpc("set_payment_pace", { p_id: change.id, p_pace: change.next }));
}
