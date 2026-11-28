import type { RecurringPace } from "@flow/shared";
import { priorEnd, runEndDate } from "./end-date";
import type { RpcClient } from "./recurring-actions";
import { assertNoError } from "./use-write";
import type { PaceChoice } from "./ui/pace";

/**
 * The keys a recurring, pace or alert write changes: the schedule, the payment's switch, the late
 * bills and changes, the party's history and Home's rows. Shared by the list, the charge page and
 * the transaction page.
 */
export const RECURRING_KEYS = ["recurring-schedule", "payment-recurring", "missing-bills", "recurring-changes", "party-charges", "home"];

/** A pick on the pace sheet: the payment, the choice, and the state before it (the undo writes it back). */
export type PaceWrite = {
  id: string;
  next: PaceChoice;
  before: { recurring: boolean; pace: RecurringPace };
  /** The charge's project when the page names one (decision 0189): a split line can feed several charges. */
  projectId?: string | null;
  /** A ביטול: it puts back the charge as it was, its end date included (FLOW-865). */
  undo?: boolean;
  /** On a ביטול: the end date the undone write's switch cleared (null: none), which goes back after the switch. */
  clearedEnd?: string | null;
};

/**
 * The RPCs of one pace pick (FLOW-415, decision 0175). לא קבוע clears the switch and has no pace;
 * a pace on a payment that is not recurring turns the switch on first, then sets the pace.
 * FLOW-865: turning the switch on clears an end date that has passed. Returns that date (null: none),
 * which the pick's ביטול puts back with set_payment_end after the switch; a ביטול that turns the switch
 * on again puts back at once the end date its own switch clears.
 */
export async function runPaceChange(client: RpcClient, change: PaceWrite): Promise<string | null> {
  const project = change.projectId == null ? {} : { p_project_id: change.projectId };
  const restoreEnd = (endsOn: string) => runEndDate(client, { lineId: change.id, projectId: change.projectId ?? null, next: endsOn });
  if (change.next === "never") {
    assertNoError(await client.rpc("set_payment_recurring", { p_id: change.id, p_recurring: false, ...project }));
    if (change.undo && change.clearedEnd != null) await restoreEnd(change.clearedEnd);
    return null;
  }
  let cleared: string | null = null;
  if (!change.before.recurring) {
    const result = await client.rpc("set_payment_recurring", { p_id: change.id, p_recurring: true, ...project });
    assertNoError(result);
    cleared = priorEnd(result.data);
    if (change.undo && cleared != null) {
      await restoreEnd(cleared);
      cleared = null;
    }
  }
  assertNoError(await client.rpc("set_payment_pace", { p_id: change.id, p_pace: change.next, ...project }));
  return cleared;
}
