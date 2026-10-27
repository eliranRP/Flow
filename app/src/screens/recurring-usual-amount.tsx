import { formatAmountText } from "@flow/shared";
import { useEffect, useRef, useState } from "react";
import { RECURRING_KEYS } from "../pace-write";
import { liveRpcClient } from "../recurring-actions";
import type { ScheduleRow } from "../recurring-schedule";
import { ownerBefore, runUsualAmount, usualOf, usualToast, type UsualAmountWrite } from "../usual-amount";
import { UsualAmountRow } from "../ui/recurring-charge-parts";
import { useToast } from "../ui/toast";
import { UsualAmountSheet } from "../ui/usual-amount-sheet";
import { useWrite } from "../use-write";
import { topToast } from "../ui/top-toast";

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
  // The server's amount before the last write (prior_amount): what ביטול writes back.
  const prior = useRef<number | null>(null);
  // A refetched row is the server's word: it replaces the amount kept after a write.
  useEffect(() => {
    if (live) setLocal(null);
  }, [row, live]);
  const usual = local ?? usualOf(row);
  const name = row.party_name;

  const write = useWrite<UsualAmountWrite>({
    failure: (error) => (error.message.includes("forbidden") ? "אין הרשאה לעדכן את השורה." : "לא הצלחנו לעדכן את השורה."),
    keys: RECURRING_KEYS,
    place: "top",
    onSuccess: (done) => {
      setOpen(false);
      if (done.undo) return;
      const back = prior.current;
      toast.show(topToast({
        message: usualToast(done.next, name),
        action: "ביטול",
        onAction: () => {
          write.mutate({ ...done, next: back, before: done.next, undo: true });
        },
      }));
    },
    run: async (change) => {
      prior.current = live ? await runUsualAmount(liveRpcClient(), change) : change.before;
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
