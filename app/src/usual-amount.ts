import type { RpcClient } from "./recurring-actions";
import type { ScheduleRow } from "./recurring-schedule";
import { assertNoError } from "./use-write";

/**
 * Decision 0189: the owner's usual amount for one recurring charge. The page writes it through the charge's
 * line (`set_payment_amount`); null goes back to the amount Flow computes from its months.
 */

/** One write: the line, the charge's project (a split line feeds several), the amount and the amount before. */
export type UsualAmountWrite = {
  lineId: string;
  projectId: string | null;
  /** Positive minor units; null clears the owner's amount. */
  next: number | null;
  /** The owner's amount before the write (null: none), which ביטול writes back. */
  before: number | null;
  name: string;
  undo: boolean;
};

/** The usual amount as the page shows it: unsigned minor units, and whether the owner set it. */
export function usualOf(row: Pick<ScheduleRow, "typical_amount_minor" | "typical_amount_source">): { minor: bigint; owner: boolean } {
  const minor = BigInt(row.typical_amount_minor);
  return { minor: minor < 0n ? -minor : minor, owner: row.typical_amount_source === "owner" };
}

/** The owner's amount on the charge before a write: the shown amount when the owner set it, else none. */
export function ownerBefore(row: Pick<ScheduleRow, "typical_amount_minor" | "typical_amount_source">): number | null {
  const usual = usualOf(row);
  return usual.owner ? Number(usual.minor) : null;
}

/** The toast after a write: a new amount, or back to Flow's own. */
export function usualToast(next: number | null, name: string): string {
  return next == null ? `הסכום הרגיל חזר לחישוב: ${name}` : `הסכום הרגיל עודכן: ${name}`;
}

/** The RPC of one write. A charge with a project names it, so a split line writes that project's charge. */
export async function runUsualAmount(client: RpcClient, write: Pick<UsualAmountWrite, "lineId" | "projectId" | "next">): Promise<void> {
  assertNoError(
    await client.rpc("set_payment_amount", {
      p_id: write.lineId,
      // The RPC takes null to clear the owner's amount.
      p_amount_minor: write.next as number,
      ...(write.projectId == null ? {} : { p_project_id: write.projectId }),
    }),
  );
}
