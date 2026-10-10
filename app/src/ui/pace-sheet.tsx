import type { Pace } from "@flow/shared";
import { useEffect, useRef, type RefObject } from "react";
import { useSheetHistory } from "./back";
import { PACE_LABEL, PACE_TITLE } from "./charge-switches";
import { RadioRow } from "./radio-row";
import { Sheet } from "./sheet";

/** Shortest first, as the owner listed them (FLOW-415, 08:40Z). */
export const PACE_CHOICES: readonly Pace[] = ["month", "2months", "quarter", "year"];

/**
 * FLOW-415 step D: "כל כמה זמן" for a recurring charge (decision 0175). Four radio rows that apply
 * on tap, like the basis and currency sheets: the tapped row spins while it saves, the others
 * wait, and a close during the save waits too. A tap on the current pace only closes the sheet.
 */
export function PaceSheet({
  open,
  onOpenChange,
  value,
  saving,
  onPick,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The pace in use, the owner's or the detected one. */
  value: Pace;
  /** The pace being written, or null. */
  saving: Pace | null;
  /** `close` closes the sheet once the save has settled. */
  onPick: (pace: Pace, close: () => void) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const closing = useRef(false);
  useEffect(() => {
    if (open) closing.current = false;
  }, [open]);
  const setOpen = useSheetHistory("payment-pace", open, onOpenChange, () => closing.current || saving == null);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && saving != null) return;
        setOpen(next);
      }}
      title={PACE_TITLE}
      returnFocusRef={returnFocusRef}
    >
      <div role="radiogroup" aria-label={PACE_TITLE}>
        {PACE_CHOICES.map((pace) => (
          <RadioRow
            key={pace}
            label={PACE_LABEL[pace]}
            value={pace}
            selected={saving == null && pace === value}
            busy={saving === pace}
            disabled={saving != null && saving !== pace}
            onSelect={() => {
              if (pace === value) {
                setOpen(false);
                return;
              }
              onPick(pace, () => {
                closing.current = true;
                setOpen(false);
              });
            }}
          />
        ))}
      </div>
    </Sheet>
  );
}
