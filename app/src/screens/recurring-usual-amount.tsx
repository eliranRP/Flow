import { formatAmountText } from "@flow/shared";
import { useRef, useState } from "react";
import { RECURRING_KEYS } from "../pace-write";
import { liveRpcClient } from "../recurring-actions";
import type { ScheduleRow } from "../recurring-schedule";
import { ownerBefore, runUsualAmount, usualOf, usualToast, type UsualAmountWrite } from "../usual-amount";
import { UsualAmountRow } from "../ui/recurring-charge-parts";
import { useToast } from "../ui/toast";
import { UsualAmountSheet } from "../ui/usual-amount-sheet";
import { useWrite } from "../use-write";

/**
 * Decision 0189: the charge page's usual amount, its row and its sheet. Save writes the owner's amount for the
 * charge (its line and project), "חזרה לחישוב" clears it, and the toast's ביטול writes back the amount before.
 * A dev sample keeps the amount local.
 */
export function ChargeUsualAmount({
  row,
  lineId,
  live,
  disabled,
  blocked,
  openSheet = false,
}: {
  row: ScheduleRow;
  lineId: string | null;
  live: boolean;
  /** A viewer, or a live page with no line to write through. */
  disabled: boolean;
  /** A preview: the write is refused with its own toast. */
  blocked: () => boolean;
  openSheet?: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(openSheet);
  // The amount after a write, until the reads catch up (and the only amount in a dev sample).
  const [local, setLocal] = useState<{ minor: bigint; owner: boolean } | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const usual = local ?? usualOf(row);
  const name = row.party_name;

  const write = useWrite<UsualAmountWrite>({
    failure: (error) => (error.message.includes("forbidden") ? "אין הרשאה לעדכן את השורה." : "לא הצלחנו לעדכן את השורה."),
    keys: RECURRING_KEYS,
    onSuccess: (done) => {
      setOpen(false);
      if (done.undo) return;
      toast.show({
        message: usualToast(done.next, name),
        action: "ביטול",
        onAction: () => {
          write.mutate({ ...done, next: done.before, before: done.next, undo: true });
        },
      });
    },
    run: async (change) => {
      if (live) await runUsualAmount(liveRpcClient(), change);
      // Cleared: the computed amount comes back with the reads; until then the page keeps the one it had.
      setLocal(change.next == null ? (live ? null : { minor: usualOf(row).minor, owner: false }) : { minor: BigInt(change.next), owner: true });
    },
  });

  function send(next: number | null) {
    if (write.isPending || (live && blocked()) || (live && lineId == null)) return;
    const before = local == null ? ownerBefore(row) : local.owner ? Number(local.minor) : null;
    write.mutate({ lineId: lineId ?? "", projectId: row.project_id, next, before, name, undo: false });
  }

  return (
    <>
      <UsualAmountRow
        amount={formatAmountText(usual.minor, row.currency)}
        owner={usual.owner}
        disabled={disabled}
        buttonRef={opener}
        onOpen={() => {
          if (write.isPending || (live && blocked())) return;
          setOpen(true);
        }}
      />
      <UsualAmountSheet
        open={open}
        onOpenChange={setOpen}
        name={name}
        currency={row.currency}
        income={row.direction === "income"}
        usual={usual.minor}
        owner={usual.owner}
        busy={write.isPending}
        returnFocusRef={opener}
        onSave={(minor) => {
          send(minor);
        }}
        onReset={() => {
          send(null);
        }}
      />
    </>
  );
}
