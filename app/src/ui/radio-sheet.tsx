import { useEffect, useRef, type RefObject } from "react";
import { useSheetHistory } from "./back";
import { RadioRow } from "./radio-row";
import { Sheet } from "./sheet";

/** A radio sheet's own words: its history entry, title, note under the rows, and the rows. */
export type RadioSheetCopy<T extends string> = {
  historyKey: string;
  title: string;
  note: string;
  choices: ReadonlyArray<{ value: T; label: string; description?: string }>;
};

export type RadioSheetProps<T extends string, V extends string = T> = {
  copy: RadioSheetCopy<T>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The stored choice. */
  value: V;
  /** The choice being written, or null. */
  saving: T | null;
  /**
   * A tap on the current choice only closes the sheet. `close` closes it through the sheet's
   * history entry once the save has settled, so Back is not left on a dead step.
   */
  onPick: (choice: T, close: () => void) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * A sheet of radio rows that apply on tap (FLOW-103, FLOW-504). The tapped row spins while it
 * saves and the other row waits; a close during the save waits too.
 */
export function RadioSheet<T extends string, V extends string = T>({
  copy,
  open,
  onOpenChange,
  value,
  saving,
  onPick,
  returnFocusRef,
}: RadioSheetProps<T, V>) {
  // Set by `close`: the save has settled, so Back's popstate must not wait on a stale `saving`.
  const closing = useRef(false);
  useEffect(() => {
    if (open) closing.current = false;
  }, [open]);
  const stored: string = value;
  const setOpen = useSheetHistory(copy.historyKey, open, onOpenChange, () => closing.current || saving == null);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && saving != null) return;
        setOpen(next);
      }}
      title={copy.title}
      returnFocusRef={returnFocusRef}
    >
      <div role="radiogroup" aria-label={copy.title}>
        {copy.choices.map((choice) => (
          <RadioRow
            key={choice.value}
            label={choice.label}
            description={choice.description}
            selected={saving == null && choice.value === stored}
            busy={saving === choice.value}
            disabled={saving != null && saving !== choice.value}
            onSelect={() => {
              if (choice.value === stored) {
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
      <p className="t-hint ui-pick-note">{copy.note}</p>
    </Sheet>
  );
}
