import { dueDate, monthIndex, paceMonths } from "@flow/shared";
import type { RpcClient } from "./recurring-actions";
import type { ScheduleRow } from "./recurring-schedule";
import { formatDisplay } from "./ui/date-math";
import { assertNoError } from "./use-write";

/**
 * FLOW-1266: the owner's end date for one recurring charge. The page writes it through the charge's line
 * (`set_payment_end`); null removes it. A charge is not expected on a due day after it, and once it has passed
 * the charge leaves קבועים.
 */

/** One write: the line, the charge's project (a split line feeds several), the date and the date before. */
export type EndDateWrite = {
  lineId: string;
  projectId: string | null;
  /** yyyy-mm-dd; null removes the end date. */
  next: string | null;
  /** The end date before the write, which ביטול writes back: the server's prior_ends_on once it answers. */
  before: string | null;
  name: string;
  undo: boolean;
};

/** The sheet's preset choices, the exact date the owner picked ("custom") and no end. */
export type EndChoice = "next" | "3m" | "6m" | "year" | "custom" | "none";

/** A yyyy-mm key `months` months from `month`. */
function addMonths(month: string, months: number): string {
  const index = monthIndex(month) + months;
  return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The last day of a yyyy-mm month, yyyy-mm-dd. */
function monthEnd(month: string): string {
  return dueDate(month, 31);
}

/** `today` (yyyy-mm-dd) moved `months` months on, its day capped at that month's end. */
export function shiftDate(today: string, months: number): string {
  return dueDate(addMonths(today.slice(0, 7), months), Number(today.slice(8, 10)));
}

/**
 * The month the charge next comes in: its next due month, or this month while it is still due here (a late
 * charge's due month may be earlier). The month after the next one for a charge that already came this month is
 * its next due month, which the server gives.
 */
export function nextChargeMonth(row: Pick<ScheduleRow, "next_due_month" | "pace">, today: string): string {
  const thisMonth = today.slice(0, 7);
  const due = row.next_due_month.slice(0, 7);
  if (due === "" || due < thisMonth) {
    // A late charge counts from this month; step on to its cycle when its due month was earlier.
    const step = paceMonths(row.pace);
    if (due === "") return thisMonth;
    const behind = monthIndex(thisMonth) - monthIndex(due);
    return addMonths(due, Math.ceil(behind / step) * step);
  }
  return due;
}

/** The presets' dates, from today and the charge's next month. "after the next charge" ends with that month. */
export function endPresets(row: Pick<ScheduleRow, "next_due_month" | "pace">, today: string): Record<"next" | "3m" | "6m" | "year", string> {
  return {
    next: monthEnd(nextChargeMonth(row, today)),
    "3m": shiftDate(today, 3),
    "6m": shiftDate(today, 6),
    year: `${today.slice(0, 4)}-12-31`,
  };
}

/** Which choice an end date is: a preset with the same date (the first in order), else custom; none when null. */
export function endChoiceOf(endsOn: string | null, presets: Record<"next" | "3m" | "6m" | "year", string>): EndChoice {
  if (endsOn == null) return "none";
  const preset = (["next", "3m", "6m", "year"] as const).find((key) => presets[key] === endsOn);
  return preset ?? "custom";
}

/** The row's words: no end, or the date. */
export function endText(endsOn: string | null): string {
  return endsOn == null ? "ללא" : formatDisplay(endsOn);
}

/** The toast after a write. */
export function endToast(next: string | null, name: string): string {
  return next == null ? `תאריך הסיום הוסר: ${name}` : `מסתיים ב־${formatDisplay(next)}: ${name}`;
}

/** The end date before a write, as `set_payment_end` returns it (prior_ends_on); null: none. */
export function priorEnd(data: unknown): string | null {
  if (data == null || typeof data !== "object" || !("prior_ends_on" in data)) return null;
  return typeof data.prior_ends_on === "string" ? data.prior_ends_on : null;
}

/** The RPC of one write. A charge with a project names it. Returns the end date before, which ביטול writes back. */
export async function runEndDate(client: RpcClient, write: Pick<EndDateWrite, "lineId" | "projectId" | "next">): Promise<string | null> {
  const result = await client.rpc("set_payment_end", {
    p_id: write.lineId,
    // The RPC takes null to remove the end date.
    p_ends_on: write.next as string,
    ...(write.projectId == null ? {} : { p_project_id: write.projectId }),
  });
  assertNoError(result);
  return priorEnd(result.data);
}
