import { useEffect, useRef, type RefObject } from "react";
import { useSheetHistory } from "./back";
import { RadioRow } from "./radio-row";
import { Sheet } from "./sheet";

/** The company's one date for profit, the תזרים and the agent (FLOW-103, decision 0170). */
export const BASIS_CHOICES = [
  { value: "cash", label: "תאריך תשלום", description: "כשהכסף יצא או נכנס בבנק" },
  { value: "invoiced", label: "תאריך חשבונית", description: "לפי תאריך המסמך, גם לפני התשלום" },
] as const;

export type BasisChoice = (typeof BASIS_CHOICES)[number]["value"];

export const BASIS_TITLE = "רווח ותזרים לפי";
export const BASIS_SHEET_NOTE = "הרווח, התזרים והסוכן סופרים לפי התאריך הזה.";

/** "תאריך תשלום" for the cash basis, "תאריך חשבונית" for the invoiced one. */
export function basisChoiceLabel(basis: BasisChoice): string {
  return BASIS_CHOICES.find((choice) => choice.value === basis)?.label ?? basis;
}

/**
 * The basis sheet (FLOW-103): two radio rows that apply on tap, like the currency sheet.
 * The tapped row spins while it saves and the other row waits; a close during the save waits too.
 */
export function BasisSheet({
  open,
  onOpenChange,
  value,
  saving,
  onPick,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The company's stored basis. */
  value: BasisChoice;
  /** The basis being written, or null. */
  saving: BasisChoice | null;
  /** A tap on the current basis only closes the sheet. `close` closes it once the save has settled. */
  onPick: (basis: BasisChoice, close: () => void) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const closing = useRef(false);
  useEffect(() => {
    if (open) closing.current = false;
  }, [open]);
  const setOpen = useSheetHistory("company-basis", open, onOpenChange, () => closing.current || saving == null);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && saving != null) return;
        setOpen(next);
      }}
      title={BASIS_TITLE}
      returnFocusRef={returnFocusRef}
    >
      <div role="radiogroup" aria-label={BASIS_TITLE}>
        {BASIS_CHOICES.map((choice) => (
          <RadioRow
            key={choice.value}
            label={choice.label}
            description={choice.description}
            selected={saving == null && choice.value === value}
            busy={saving === choice.value}
            disabled={saving != null && saving !== choice.value}
            onSelect={() => {
              if (choice.value === value) {
                setOpen(false);
                return;
              }
              onPick(choice.value, () => {
                closing.current = true;
                setOpen(false);
              });
            }}
          />
        ))}
      </div>
      <p className="t-hint ui-pick-note">{BASIS_SHEET_NOTE}</p>
    </Sheet>
  );
}
